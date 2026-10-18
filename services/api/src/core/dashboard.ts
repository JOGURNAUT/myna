import { and, desc, eq, gte, inArray, isNull, lt } from 'drizzle-orm';
import { addDays, type BusinessConfig, nowIn, splitDateTime, ToolFailure } from '@myna/shared';
import type { SchedulingAdapter } from '../adapters/types.js';
import type { Db } from '../db/client.js';
import { callEvents, callLabels, calls, reminderAttempts } from '../db/schema.js';

/**
 * Read models for the clinic dashboard. Everything is scoped to one tenant; phone numbers are
 * already masked in the call log, and staff never see a full number except on a task they must
 * call back.
 */

export const FAILURE_TYPES = [
  'wrong_date_or_time',
  'wrong_patient_or_doctor',
  'misheard',
  'should_have_handed_off',
  'disclosed_too_much',
  'tool_or_booking_error',
  'too_slow_or_talked_over',
  'other',
] as const;
export type FailureType = (typeof FAILURE_TYPES)[number];

interface Turn {
  type: 'turn';
  speaker: 'agent' | 'caller';
  text: string;
  language?: string;
  state: string;
}
type Event = Turn | { type: string; [k: string]: unknown };

const isTurn = (e: Event): e is Turn => e.type === 'turn';

/** UTC instant → business-local `YYYY-MM-DDTHH:mm`. */
const local = (config: BusinessConfig, iso: string) => nowIn(config.timezone, new Date(iso));

/** The UTC instants bounding a business-local date range [fromDate, toDate]. */
function utcBounds(config: BusinessConfig, fromDate: string, toDate: string) {
  // IST has no DST: one fixed offset. Compute it from the zone rather than hard-coding +05:30.
  const probe = new Date(`${fromDate}T12:00:00Z`);
  const shownAsLocal = new Date(`${nowIn(config.timezone, probe)}:00Z`);
  const offsetMs = shownAsLocal.getTime() - probe.getTime();
  const start = new Date(new Date(`${fromDate}T00:00:00Z`).getTime() - offsetMs).toISOString();
  const end = new Date(
    new Date(`${addDays(toDate, 1)}T00:00:00Z`).getTime() - offsetMs,
  ).toISOString();
  return { start, end };
}

export interface CallSummary {
  id: string;
  startedAt: string; // business-local
  direction: string;
  source: string;
  callerPhoneMasked: string | null;
  language: string | null;
  firstRequest: string | null;
  outcome: string | null;
  handoffReason: string | null;
  durationSec: number | null;
  label: { correct: boolean; failureType: string | null } | null;
}

export async function listCalls(
  db: Db,
  config: BusinessConfig,
  range: { from: string; to: string },
): Promise<CallSummary[]> {
  const { start, end } = utcBounds(config, range.from, range.to);
  const rows = await db
    .select()
    .from(calls)
    .where(
      and(
        eq(calls.tenantId, config.tenantId),
        gte(calls.startedAt, start),
        lt(calls.startedAt, end),
      ),
    )
    .orderBy(desc(calls.startedAt));
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const events = await db
    .select()
    .from(callEvents)
    .where(and(eq(callEvents.tenantId, config.tenantId), inArray(callEvents.callId, ids)))
    .orderBy(callEvents.id);
  const labels = await db
    .select()
    .from(callLabels)
    .where(and(eq(callLabels.tenantId, config.tenantId), inArray(callLabels.callId, ids)));
  const byCall = new Map<string, Event[]>();
  for (const e of events) {
    byCall.set(e.callId, [...(byCall.get(e.callId) ?? []), JSON.parse(e.payloadJson) as Event]);
  }
  const labelOf = new Map(labels.map((l) => [l.callId, l]));
  return rows.map((r) => {
    const turns = (byCall.get(r.id) ?? []).filter(isTurn);
    const callerTurns = turns.filter((t) => t.speaker === 'caller');
    const label = labelOf.get(r.id);
    return {
      id: r.id,
      startedAt: local(config, r.startedAt),
      direction: r.direction,
      source: r.source,
      callerPhoneMasked: r.callerPhoneMasked,
      language: callerTurns.at(-1)?.language ?? null,
      firstRequest: callerTurns[0]?.text.slice(0, 120) ?? null,
      outcome: r.outcome,
      handoffReason: r.handoffReason,
      durationSec: r.endedAt
        ? Math.round((new Date(r.endedAt).getTime() - new Date(r.startedAt).getTime()) / 1000)
        : null,
      label: label ? { correct: label.correct, failureType: label.failureType } : null,
    };
  });
}

export async function callDetail(db: Db, config: BusinessConfig, callId: string) {
  const [call] = await db
    .select()
    .from(calls)
    .where(and(eq(calls.tenantId, config.tenantId), eq(calls.id, callId)));
  if (!call) throw new ToolFailure('NOT_FOUND', 'unknown call');
  const events = await db
    .select()
    .from(callEvents)
    .where(and(eq(callEvents.tenantId, config.tenantId), eq(callEvents.callId, callId)))
    .orderBy(callEvents.id);
  const [label] = await db
    .select()
    .from(callLabels)
    .where(and(eq(callLabels.tenantId, config.tenantId), eq(callLabels.callId, callId)));
  return {
    id: call.id,
    startedAt: local(config, call.startedAt),
    endedAt: call.endedAt ? local(config, call.endedAt) : null,
    direction: call.direction,
    source: call.source,
    callerPhoneMasked: call.callerPhoneMasked,
    outcome: call.outcome,
    handoffReason: call.handoffReason,
    events: events.map((e) => ({ ...(JSON.parse(e.payloadJson) as Event), at: e.createdAt })),
    label: label
      ? {
          correct: label.correct,
          failureType: label.failureType,
          notes: label.notes,
          labeledAt: label.labeledAt,
        }
      : null,
  };
}

export async function setLabel(
  db: Db,
  config: BusinessConfig,
  callId: string,
  label: { correct: boolean; failureType?: FailureType | undefined; notes?: string | undefined },
): Promise<void> {
  await callDetail(db, config, callId); // 404 for another tenant's call
  if (!label.correct && !label.failureType) {
    throw new ToolFailure('VALIDATION', 'a wrong call needs a failure type');
  }
  const values = {
    callId,
    tenantId: config.tenantId,
    correct: label.correct,
    failureType: label.correct ? null : (label.failureType ?? null),
    notes: label.notes?.trim() ?? null,
    labeledAt: new Date().toISOString(),
  };
  await db
    .insert(callLabels)
    .values(values)
    .onConflictDoUpdate({ target: callLabels.callId, set: values });
}

/** Unacknowledged handoffs from today: the dashboard's alert strip. */
export async function handoffAlerts(db: Db, config: BusinessConfig, now: Date) {
  const today = splitDateTime(nowIn(config.timezone, now)).date;
  const todays = await listCalls(db, config, { from: today, to: today });
  const unseen = new Set(
    (
      await db
        .select({ id: calls.id })
        .from(calls)
        .where(and(eq(calls.tenantId, config.tenantId), isNull(calls.handoffSeenAt)))
    ).map((r) => r.id),
  );
  return todays.filter((c) => c.handoffReason && unseen.has(c.id) && c.source !== 'hawk');
}

export async function markHandoffSeen(db: Db, config: BusinessConfig, callId: string, now: Date) {
  await callDetail(db, config, callId);
  await db
    .update(calls)
    .set({ handoffSeenAt: now.toISOString() })
    .where(and(eq(calls.tenantId, config.tenantId), eq(calls.id, callId)));
}

export interface Metric {
  id: string;
  label: string;
  value: number | null;
  unit: '%' | 'calls' | 'hours' | 'count';
  formula: string;
}

/**
 * Top-line metrics over the last `days` days. Each comes with its formula, shown on hover.
 * Hawk runs and the builder's own test calls are excluded.
 */
export async function metrics(
  db: Db,
  config: BusinessConfig,
  now: Date,
  days = 7,
): Promise<{ from: string; to: string; metrics: Metric[]; reminders: Record<string, number> }> {
  const to = splitDateTime(nowIn(config.timezone, now)).date;
  const from = addDays(to, -(days - 1));
  const all = await listCalls(db, config, { from, to });
  const real = all.filter((c) => c.source === 'patient');
  const inbound = real.filter((c) => c.direction === 'inbound');
  const answered = inbound.filter((c) => c.firstRequest !== null);
  const handled = answered.filter(
    (c) => !c.handoffReason && !(c.outcome ?? '').includes('message_taken'),
  );
  const missed = inbound.filter((c) => c.firstRequest === null && c.outcome !== null);

  const { start, end } = utcBounds(config, from, to);
  const attempts = await db
    .select()
    .from(reminderAttempts)
    .where(
      and(
        eq(reminderAttempts.tenantId, config.tenantId),
        gte(reminderAttempts.attemptedAt, start),
        lt(reminderAttempts.attemptedAt, end),
      ),
    );
  const reminders: Record<string, number> = {};
  for (const a of attempts) reminders[a.outcome] = (reminders[a.outcome] ?? 0) + 1;
  const completedReminders = attempts.filter((a) =>
    ['confirmed', 'rescheduled', 'cancelled'].includes(a.outcome),
  ).length;

  const m = config.metrics;
  const hours =
    (handled.length * m.receptionistCallMinutes + completedReminders * m.reminderCallMinutes) / 60;
  return {
    from,
    to,
    reminders,
    metrics: [
      {
        id: 'handled_without_staff',
        label: 'Handled without staff',
        value: answered.length ? Math.round((handled.length / answered.length) * 100) : null,
        unit: '%',
        formula:
          'Calls Myna finished on her own (no handoff, no message for staff) ÷ all calls she answered. Test calls excluded.',
      },
      {
        id: 'missed_calls',
        label: 'Missed calls',
        value: missed.length,
        unit: 'calls',
        formula: 'Calls that ended before the caller said anything.',
      },
      {
        id: 'no_show_rate',
        label: 'No-show rate',
        value: null,
        unit: '%',
        formula:
          'Patients who neither came nor cancelled ÷ appointments. Not tracked yet: needs staff to mark arrivals.',
      },
      {
        id: 'staff_hours_saved',
        label: 'Staff hours saved',
        value: Math.round(hours * 10) / 10,
        unit: 'hours',
        formula: `Calls handled alone × ${m.receptionistCallMinutes} min + completed reminder calls × ${m.reminderCallMinutes} min (the clinic's own estimates of a receptionist call).`,
      },
    ],
  };
}

/** After-hours bookings waiting for staff. */
export async function pendingBookings(adapter: SchedulingAdapter, now: Date) {
  const config = adapter.config;
  const today = splitDateTime(nowIn(config.timezone, now)).date;
  const upcoming = await adapter.listAppointmentsBetween(
    `${today}T00:00`,
    `${addDays(today, config.booking.maxDaysAhead + 1)}T00:00`,
  );
  const pending = upcoming.filter((a) => a.status === 'pending');
  return Promise.all(
    pending.map(async (a) => {
      const patient = await adapter.getPatient(a.patientId);
      return {
        ...a,
        patientName: patient?.name ?? '?',
        resourceName: config.resources.find((r) => r.id === a.resourceId)?.name ?? a.resourceId,
        serviceName: config.services.find((s) => s.id === a.serviceId)?.name ?? a.serviceId,
      };
    }),
  );
}
