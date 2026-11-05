import { randomUUID } from 'node:crypto';
import { and, asc, eq, lt } from 'drizzle-orm';
import {
  addMinutes,
  type BusinessConfig,
  type DueReminder,
  nowIn,
  type ReminderOutcome,
  splitDateTime,
  type ToolArgs,
  ToolFailure,
  type ToolOutput,
} from '@myna/shared';
import type { StoredAppointment } from '../adapters/types.js';
import { reminderAttempts, waitlist } from '../db/schema.js';
import { insideWindow } from './hours.js';
import { nameKey, phoneKey } from './identity.js';
import { isDoNotCall } from './reminders.js';
import { findResource, findService } from './slots.js';
import { assertNotKilled, type ToolContext } from './tool-context.js';

/**
 * Waitlist and the "a table opened" callback (restaurants).
 *
 * A full day is not a dead end: the guest joins the waitlist. When a booking is cancelled or
 * moved, the first waiting guest whose party size and time window fit gets that table HELD as a
 * pending booking, and is called. Yes confirms it. No, a wrong number, or the hold running out
 * releases it to the next guest. Nobody is called while outbound calls are switched off.
 */

/** Outcomes after which the offer is dropped and the table moves on. */
const DECLINED: readonly ReminderOutcome[] = [
  'cancelled',
  'opted_out',
  'wrong_number',
  'not_verified',
];
/** Outcomes after which we simply try again until the hold runs out. */
const RETRYABLE: readonly ReminderOutcome[] = ['no_answer', 'voicemail', 'reached_family'];

const MAX_WAITING_PER_PHONE = 3;

const localNow = (ctx: { config: BusinessConfig; clock: () => Date }) =>
  nowIn(ctx.config.timezone, ctx.clock());

export async function joinWaitlist(
  ctx: ToolContext,
  args: ToolArgs<'join_waitlist'>,
): Promise<ToolOutput<'join_waitlist'>> {
  assertNotKilled(ctx.config);
  const phone = phoneKey(args.phone);
  if (!phone) throw new ToolFailure('VALIDATION', 'phone must be a 10-digit Indian mobile number');
  findService(ctx.config, args.serviceId);
  const today = splitDateTime(localNow(ctx)).date;
  if (args.date < today) throw new ToolFailure('VALIDATION', 'that date has passed');
  if (args.from && args.to && args.from > args.to) {
    throw new ToolFailure('VALIDATION', 'the window must start before it ends');
  }
  if (await isDoNotCall(ctx.db, ctx.config.tenantId, phone)) {
    throw new ToolFailure('VALIDATION', 'this number asked not to be called');
  }

  // Same name + same number is the same guest; otherwise a new record.
  const known = (await ctx.adapter.findPatients({ phone })).find(
    (p) => nameKey(p.name) === nameKey(args.name),
  );
  const guest = known ?? (await ctx.adapter.createPatient({ name: args.name, phone }));

  const tenantId = ctx.config.tenantId;
  const mine = await ctx.db
    .select({ id: waitlist.id })
    .from(waitlist)
    .where(
      and(
        eq(waitlist.tenantId, tenantId),
        eq(waitlist.patientId, guest.id),
        eq(waitlist.status, 'waiting'),
      ),
    );
  if (mine.length >= MAX_WAITING_PER_PHONE) {
    throw new ToolFailure('VALIDATION', 'this guest is already on the waitlist several times');
  }

  const sameDay = await ctx.db
    .select({ id: waitlist.id })
    .from(waitlist)
    .where(
      and(
        eq(waitlist.tenantId, tenantId),
        eq(waitlist.status, 'waiting'),
        eq(waitlist.date, args.date),
        eq(waitlist.serviceId, args.serviceId),
      ),
    );
  const id = `wl_${randomUUID()}`;
  await ctx.db.insert(waitlist).values({
    id,
    tenantId,
    patientId: guest.id,
    serviceId: args.serviceId,
    date: args.date,
    fromTime: args.from ?? null,
    toTime: args.to ?? null,
  });
  return { waitlistId: id, ahead: sameDay.length };
}

/**
 * A table was freed. Hold it for the first waiting guest it fits, if outbound calls are on.
 * Returns the guest's waitlist id, or null when nobody was waiting for it.
 */
export async function offerFreedSlot(
  ctx: ToolContext,
  freed: Pick<StoredAppointment, 'id' | 'resourceId' | 'start'>,
): Promise<string | null> {
  const rules = ctx.config.outboundReminders;
  if (!rules.enabled || ctx.config.killSwitch) return null;
  const now = localNow(ctx);
  if (freed.start <= now) return null;
  const { date, time } = splitDateTime(freed.start);
  const resource = findResource(ctx.config, freed.resourceId);

  const waiting = await ctx.db
    .select()
    .from(waitlist)
    .where(
      and(
        eq(waitlist.tenantId, ctx.config.tenantId),
        eq(waitlist.status, 'waiting'),
        eq(waitlist.date, date),
      ),
    )
    .orderBy(asc(waitlist.createdAt));

  for (const entry of waiting) {
    if (!resource.services.includes(entry.serviceId)) continue;
    if (entry.fromTime && time < entry.fromTime) continue;
    if (entry.toTime && time > entry.toTime) continue;
    const guest = await ctx.adapter.getPatient(entry.patientId);
    if (!guest || (await isDoNotCall(ctx.db, ctx.config.tenantId, guest.phone))) continue;
    const service = findService(ctx.config, entry.serviceId);
    let held: StoredAppointment;
    try {
      held = await ctx.adapter.book({
        idempotencyKey: `wl-${entry.id}-${freed.id}`,
        patientId: guest.id,
        resourceId: freed.resourceId,
        serviceId: entry.serviceId,
        start: freed.start,
        end: addMinutes(freed.start, service.durationMin),
        source: 'waitlist',
        status: 'pending',
      });
    } catch (e) {
      // This guest's party doesn't fit the gap (it would run into the next booking): next guest.
      if (e instanceof ToolFailure && e.code === 'SLOT_UNAVAILABLE') continue;
      throw e;
    }
    await ctx.db
      .update(waitlist)
      .set({
        status: 'held',
        appointmentId: held.id,
        holdUntil: new Date(ctx.clock().getTime() + rules.waitlistHoldMin * 60_000).toISOString(),
      })
      .where(eq(waitlist.id, entry.id));
    return entry.id;
  }
  return null;
}

async function heldFor(ctx: ToolContext, appointmentId: string) {
  const [entry] = await ctx.db
    .select()
    .from(waitlist)
    .where(
      and(
        eq(waitlist.tenantId, ctx.config.tenantId),
        eq(waitlist.appointmentId, appointmentId),
        eq(waitlist.status, 'held'),
      ),
    );
  return entry ?? null;
}

/** The called guest's answer. Confirms the held table, releases it to the next guest, or waits. */
export async function settleOffer(
  ctx: ToolContext,
  appointment: StoredAppointment,
  outcome: ReminderOutcome,
): Promise<void> {
  const entry = await heldFor(ctx, appointment.id);
  if (!entry) return;
  if (outcome === 'confirmed') {
    await ctx.adapter.decidePending(appointment.id, 'confirmed');
    await ctx.db.update(waitlist).set({ status: 'booked' }).where(eq(waitlist.id, entry.id));
  } else if (DECLINED.includes(outcome)) {
    await releaseHeld(ctx, entry.id, appointment);
  }
  // No answer, voicemail, a family member: keep the hold, the next poll tries again until it
  // expires.
}

async function releaseHeld(
  ctx: ToolContext,
  entryId: string,
  appointment: StoredAppointment,
): Promise<void> {
  await ctx.adapter.decidePending(appointment.id, 'cancelled');
  await ctx.db.update(waitlist).set({ status: 'released' }).where(eq(waitlist.id, entryId));
  await offerFreedSlot(ctx, appointment);
}

/** Holds whose time ran out go to the next guest. Cheap enough to run before every poll. */
export async function expireHolds(ctx: ToolContext): Promise<number> {
  const expired = await ctx.db
    .select()
    .from(waitlist)
    .where(
      and(
        eq(waitlist.tenantId, ctx.config.tenantId),
        eq(waitlist.status, 'held'),
        lt(waitlist.holdUntil, ctx.clock().toISOString()),
      ),
    );
  for (const entry of expired) {
    const appt = entry.appointmentId ? await ctx.adapter.getAppointment(entry.appointmentId) : null;
    if (appt && appt.status === 'pending') await releaseHeld(ctx, entry.id, appt);
    else await ctx.db.update(waitlist).set({ status: 'released' }).where(eq(waitlist.id, entry.id));
  }
  return expired.length;
}

/** Held tables whose guest should be called now: inside the call window, attempts left. */
export async function dueWaitlistOffers(ctx: ToolContext): Promise<DueReminder[]> {
  const rules = ctx.config.outboundReminders;
  if (!rules.enabled || ctx.config.killSwitch) return [];
  await expireHolds(ctx);
  const now = ctx.clock();
  if (!insideWindow(localNow(ctx), rules.callWindow)) return [];

  const held = await ctx.db
    .select()
    .from(waitlist)
    .where(and(eq(waitlist.tenantId, ctx.config.tenantId), eq(waitlist.status, 'held')));
  // A hold lasts minutes, so retries come minutes apart (not the reminder's 90).
  const gapMs = Math.max(2, Math.floor(rules.waitlistHoldMin / 3)) * 60_000;
  const due: DueReminder[] = [];
  for (const entry of held) {
    if (!entry.appointmentId || !entry.holdUntil || entry.holdUntil <= now.toISOString()) continue;
    // Staff may have approved or rejected the held table on the dashboard meanwhile.
    const held = await ctx.adapter.getAppointment(entry.appointmentId);
    if (!held || held.status !== 'pending') {
      await ctx.db
        .update(waitlist)
        .set({ status: held?.status === 'confirmed' ? 'booked' : 'released' })
        .where(eq(waitlist.id, entry.id));
      continue;
    }
    const attempts = await ctx.db
      .select()
      .from(reminderAttempts)
      .where(
        and(
          eq(reminderAttempts.tenantId, ctx.config.tenantId),
          eq(reminderAttempts.appointmentId, entry.appointmentId),
        ),
      );
    if (attempts.some((a) => !RETRYABLE.includes(a.outcome as ReminderOutcome))) continue;
    if (attempts.length >= rules.maxAttempts) continue;
    const last = attempts
      .map((a) => a.attemptedAt)
      .sort()
      .at(-1);
    if (last && now.getTime() - new Date(last).getTime() < gapMs) continue;
    const guest = await ctx.adapter.getPatient(entry.patientId);
    if (!guest || (await isDoNotCall(ctx.db, ctx.config.tenantId, guest.phone))) continue;
    due.push({
      appointmentId: entry.appointmentId,
      patientId: guest.id,
      patientName: guest.name,
      phone: guest.phone,
      attempts: attempts.length,
      kind: 'waitlist_offer',
    });
  }
  return due;
}
