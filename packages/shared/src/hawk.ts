import { z } from 'zod';
import { LocalDate, LocalDateTime, Slug } from './primitives.js';
import { StaffTask } from './domain.js';

/**
 * Contracts for Hawk's test-only API routes (`/v1/hawk/*`, mounted only when HAWK_ENABLED=1
 * and never in production). Each scenario gets a throwaway tenant: the same isolation the
 * product relies on, so scenarios run in parallel with no database resets.
 */

export const HawkSeedPatient = z.object({
  key: z.string().min(1),
  name: z.string().min(2),
  phone: z.string(),
  dob: LocalDate.optional(),
  doNotCall: z.boolean().default(false),
});

export const HawkSeedAppointment = z.object({
  key: z.string().min(1),
  patient: z.string().min(1),
  serviceId: Slug,
  resourceId: Slug,
  start: LocalDateTime,
});

/** Overrides applied on top of the base clinic config, then re-validated. */
export const HawkConfigOverrides = z
  .object({
    killSwitch: z.boolean(),
    recordCalls: z.boolean(),
    callbackPromiseHours: z.number().int(),
    outboundReminders: z.record(z.string(), z.unknown()),
  })
  .partial();

export const CreateHawkTenantInput = z.object({
  baseClinicId: Slug,
  config: HawkConfigOverrides.default({}),
  patients: z.array(HawkSeedPatient).default([]),
  appointments: z.array(HawkSeedAppointment).default([]),
});
export type CreateHawkTenantInput = z.input<typeof CreateHawkTenantInput>;

export const CreateHawkTenantOutput = z.object({
  clinicId: z.string(),
  patients: z.record(z.string(), z.string()),
  appointments: z.record(z.string(), z.string()),
});
export type CreateHawkTenantOutput = z.infer<typeof CreateHawkTenantOutput>;

/** Everything the grader compares against a scenario's expected end-state. */
export const HawkTenantState = z.object({
  patients: z.array(
    z.object({ id: z.string(), name: z.string(), phone: z.string(), doNotCall: z.boolean() }),
  ),
  appointments: z.array(
    z.object({
      id: z.string(),
      patientId: z.string(),
      patientName: z.string(),
      serviceId: z.string(),
      resourceId: z.string(),
      start: LocalDateTime,
      status: z.enum(['confirmed', 'pending', 'cancelled']),
    }),
  ),
  tasks: z.array(StaffTask),
  reminders: z.array(
    z.object({ appointmentId: z.string(), callId: z.string(), outcome: z.string() }),
  ),
});
export type HawkTenantState = z.infer<typeof HawkTenantState>;

/** A stored go-live report. The body is Hawk's own format; the API only needs these fields. */
export const StoredReportInput = z
  .object({
    runId: z.string().min(1),
    createdAt: z.string(),
  })
  .loose();
