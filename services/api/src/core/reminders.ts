import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import {
  addDays,
  type BusinessConfig,
  type DueReminder,
  nowIn,
  type ReminderOutcome,
  splitDateTime,
  type ToolArgs,
  ToolFailure,
  type ToolOutput,
} from '@myna/shared';
import type { SchedulingAdapter } from '../adapters/types.js';
import { type Db, writeTransaction } from '../db/client.js';
import { contactPreferences, reminderAttempts } from '../db/schema.js';
import { insideWindow } from './hours.js';
import type { ToolContext } from './tool-context.js';

/** Outcomes after which we try again later. Everything else closes the reminder. */
const RETRYABLE: readonly ReminderOutcome[] = ['no_answer', 'voicemail', 'reached_family'];

export async function isDoNotCall(db: Db, tenantId: string, phone: string): Promise<boolean> {
  const [row] = await db
    .select({ dnc: contactPreferences.doNotCall })
    .from(contactPreferences)
    .where(and(eq(contactPreferences.tenantId, tenantId), eq(contactPreferences.phone, phone)));
  return row?.dnc ?? false;
}

/**
 * Who to call right now. Empty unless the clinic turned reminders on AND we are inside the
 * call window. Skips opted-out numbers, closed reminders, used-up attempts, and anyone tried
 * within the retry gap.
 */
export async function dueReminders(
  db: Db,
  adapter: SchedulingAdapter,
  config: BusinessConfig,
  now: Date,
): Promise<DueReminder[]> {
  const rules = config.outboundReminders;
  if (!rules.enabled || config.killSwitch) return [];
  const local = nowIn(config.timezone, now);
  if (!insideWindow(local, rules.callWindow)) return [];

  const day = addDays(splitDateTime(local).date, rules.daysBefore);
  const appts = (
    await adapter.listAppointmentsBetween(`${day}T00:00`, `${addDays(day, 1)}T00:00`)
  ).filter((a) => a.status === 'confirmed');

  const due: DueReminder[] = [];
  for (const appt of appts) {
    const attempts = await db
      .select()
      .from(reminderAttempts)
      .where(
        and(
          eq(reminderAttempts.tenantId, config.tenantId),
          eq(reminderAttempts.appointmentId, appt.id),
        ),
      );
    if (attempts.some((a) => !RETRYABLE.includes(a.outcome as ReminderOutcome))) continue;
    if (attempts.length >= rules.maxAttempts) continue;
    const last = attempts
      .map((a) => a.attemptedAt)
      .sort()
      .at(-1);
    if (last && now.getTime() - new Date(last).getTime() < rules.retryGapMin * 60_000) continue;

    const patient = await adapter.getPatient(appt.patientId);
    if (!patient) continue;
    if (await isDoNotCall(db, config.tenantId, patient.phone)) continue;
    due.push({
      appointmentId: appt.id,
      patientId: patient.id,
      patientName: patient.name,
      phone: patient.phone,
      attempts: attempts.length,
    });
  }
  return due;
}

/** Records one reminder call's outcome. An opt-out marks the number do-not-call. */
export async function markReminderOutcome(
  ctx: ToolContext,
  args: ToolArgs<'mark_reminder_outcome'>,
): Promise<ToolOutput<'mark_reminder_outcome'>> {
  const appt = await ctx.adapter.getAppointment(args.appointmentId);
  if (!appt) throw new ToolFailure('NOT_FOUND', 'no such appointment');
  const patient = await ctx.adapter.getPatient(appt.patientId);
  const tenantId = ctx.config.tenantId;
  await writeTransaction(ctx.db, async (tx) => {
    await tx.insert(reminderAttempts).values({
      id: `rem_${randomUUID()}`,
      tenantId,
      appointmentId: appt.id,
      callId: args.callId,
      outcome: args.outcome,
      attemptedAt: ctx.clock().toISOString(),
    });
    if (args.outcome === 'opted_out' && patient) {
      await tx
        .insert(contactPreferences)
        .values({ tenantId, phone: patient.phone, doNotCall: true })
        .onConflictDoUpdate({
          target: [contactPreferences.tenantId, contactPreferences.phone],
          set: { doNotCall: true, updatedAt: new Date().toISOString() },
        });
    }
  });
  return { recorded: true };
}

export async function reminderAttemptsFor(db: Db, tenantId: string) {
  return db.select().from(reminderAttempts).where(eq(reminderAttempts.tenantId, tenantId));
}
