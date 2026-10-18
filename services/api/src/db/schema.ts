import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

/**
 * Every table carries `tenant_id`, and every query filters on it (see `TenantDb`).
 * Schedule times are business-local `YYYY-MM-DDTHH:mm` strings; audit timestamps are UTC ISO.
 */

const utcNow = (column: string) =>
  text(column)
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`);

export const clinics = sqliteTable('clinics', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  name: text('name').notNull(),
  createdAt: utcNow('created_at'),
});

export const patients = sqliteTable(
  'patients',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    name: text('name').notNull(),
    /** Normalised name used for matching (lower-case, no honorifics or punctuation). */
    nameKey: text('name_key').notNull(),
    /** Last 10 digits. Stored in full because it's needed to verify; masked everywhere else. */
    phone: text('phone').notNull(),
    dob: text('dob'),
    createdAt: utcNow('created_at'),
  },
  (t) => [
    index('patients_tenant_phone').on(t.tenantId, t.phone),
    index('patients_tenant_dob').on(t.tenantId, t.dob),
  ],
);

export const appointments = sqliteTable(
  'appointments',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    patientId: text('patient_id')
      .notNull()
      .references(() => patients.id),
    resourceId: text('resource_id').notNull(),
    serviceId: text('service_id').notNull(),
    start: text('start').notNull(),
    end: text('end').notNull(),
    status: text('status', { enum: ['confirmed', 'pending', 'cancelled'] }).notNull(),
    source: text('source').notNull().default('agent'),
    createdAt: utcNow('created_at'),
    updatedAt: utcNow('updated_at'),
  },
  (t) => [
    index('appointments_tenant_resource_start').on(t.tenantId, t.resourceId, t.start),
    index('appointments_tenant_patient').on(t.tenantId, t.patientId),
    // Backstop against double booking, even if application checks are bypassed.
    uniqueIndex('appointments_no_double_start')
      .on(t.tenantId, t.resourceId, t.start)
      .where(sql`status <> 'cancelled'`),
  ],
);

export const idempotencyKeys = sqliteTable(
  'idempotency_keys',
  {
    tenantId: text('tenant_id').notNull(),
    key: text('key').notNull(),
    operation: text('operation').notNull(),
    requestHash: text('request_hash').notNull(),
    responseJson: text('response_json').notNull(),
    createdAt: utcNow('created_at'),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.key] })],
);

export const verifications = sqliteTable('verifications', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  patientId: text('patient_id')
    .notNull()
    .references(() => patients.id),
  callId: text('call_id').notNull(),
  /** UTC ISO instant. */
  expiresAt: text('expires_at').notNull(),
  createdAt: utcNow('created_at'),
});

export const calls = sqliteTable(
  'calls',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    direction: text('direction', { enum: ['inbound', 'outbound'] }).notNull(),
    source: text('source', { enum: ['patient', 'manual_test', 'hawk'] }).notNull(),
    /** Masked (`98xxxxx210`). Full numbers never reach the call log. */
    callerPhoneMasked: text('caller_phone_masked'),
    startedAt: utcNow('started_at'),
    endedAt: text('ended_at'),
    outcome: text('outcome'),
    handoffReason: text('handoff_reason'),
    /** When staff acknowledged the handoff alert on the dashboard (UTC ISO). */
    handoffSeenAt: text('handoff_seen_at'),
  },
  (t) => [index('calls_tenant_started').on(t.tenantId, t.startedAt)],
);

export const callEvents = sqliteTable(
  'call_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tenantId: text('tenant_id').notNull(),
    callId: text('call_id')
      .notNull()
      .references(() => calls.id),
    type: text('type').notNull(),
    payloadJson: text('payload_json').notNull(),
    createdAt: utcNow('created_at'),
  },
  (t) => [index('call_events_call').on(t.tenantId, t.callId, t.id)],
);

export const smsOutbox = sqliteTable('sms_outbox', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  appointmentId: text('appointment_id')
    .notNull()
    .references(() => appointments.id),
  language: text('language').notNull(),
  status: text('status', { enum: ['queued', 'sent', 'failed'] })
    .notNull()
    .default('queued'),
  createdAt: utcNow('created_at'),
});

/** Flow (b): messages for staff. The callback number is stored in full (staff must dial it). */
export const staffTasks = sqliteTable(
  'staff_tasks',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    callId: text('call_id').notNull(),
    patientId: text('patient_id').references(() => patients.id),
    callerName: text('caller_name'),
    category: text('category').notNull(),
    summary: text('summary').notNull(),
    urgency: text('urgency', { enum: ['urgent', 'today', 'routine'] }).notNull(),
    callbackNumber: text('callback_number').notNull(),
    /** Business-local `YYYY-MM-DDTHH:mm`, counted in opening hours. */
    callbackBy: text('callback_by').notNull(),
    status: text('status', { enum: ['open', 'done'] })
      .notNull()
      .default('open'),
    createdAt: utcNow('created_at'),
    doneAt: text('done_at'),
  },
  (t) => [index('staff_tasks_tenant_status').on(t.tenantId, t.status, t.callbackBy)],
);

/** Flow (c): one row per reminder call attempt and its outcome. */
export const reminderAttempts = sqliteTable(
  'reminder_attempts',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    appointmentId: text('appointment_id')
      .notNull()
      .references(() => appointments.id),
    callId: text('call_id').notNull(),
    outcome: text('outcome').notNull(),
    /** UTC ISO instant, used for the retry gap. */
    attemptedAt: utcNow('attempted_at'),
  },
  (t) => [index('reminder_attempts_appt').on(t.tenantId, t.appointmentId)],
);

/** Hawk go-live reports (the JSON is the source of truth; HTML/markdown are renderings). */
export const hawkReports = sqliteTable(
  'hawk_reports',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    createdAt: utcNow('created_at'),
    reportJson: text('report_json').notNull(),
  },
  (t) => [index('hawk_reports_tenant_created').on(t.tenantId, t.createdAt)],
);

/**
 * Contact preferences, keyed by phone number rather than patient: an opt-out applies to the
 * number we dial, and it works whichever scheduling backend holds the patient record.
 */
export const contactPreferences = sqliteTable(
  'contact_preferences',
  {
    tenantId: text('tenant_id').notNull(),
    /** Last 10 digits. */
    phone: text('phone').notNull(),
    doNotCall: integer('do_not_call', { mode: 'boolean' }).notNull().default(false),
    updatedAt: utcNow('updated_at'),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.phone] })],
);

/** Manual review of a call by staff or the builder — the ground truth for Hawk's LLM judge. */
export const callLabels = sqliteTable('call_labels', {
  callId: text('call_id')
    .primaryKey()
    .references(() => calls.id),
  tenantId: text('tenant_id').notNull(),
  correct: integer('correct', { mode: 'boolean' }).notNull(),
  failureType: text('failure_type'),
  notes: text('notes'),
  labeledAt: utcNow('labeled_at'),
});

/** Runtime settings changed from the dashboard (override the clinic YAML until changed back). */
export const clinicSettings = sqliteTable('clinic_settings', {
  clinicId: text('clinic_id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  killSwitch: integer('kill_switch', { mode: 'boolean' }),
  updatedAt: utcNow('updated_at'),
});
