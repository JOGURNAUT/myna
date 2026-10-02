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
