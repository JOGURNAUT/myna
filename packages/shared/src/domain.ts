import { z } from 'zod';
import { LocalDate, LocalDateTime, Slug } from './primitives.js';

export const AppointmentStatus = z.enum(['confirmed', 'pending', 'cancelled']);
export type AppointmentStatus = z.infer<typeof AppointmentStatus>;

/** What the agent is allowed to see about a patient once verified. */
export const PatientSummary = z.object({
  id: z.string(),
  name: z.string(),
});
export type PatientSummary = z.infer<typeof PatientSummary>;

export const Slot = z.object({
  start: LocalDateTime,
  end: LocalDateTime,
  resourceId: Slug,
  resourceName: z.string(),
  serviceId: Slug,
});
export type Slot = z.infer<typeof Slot>;

export const Appointment = z.object({
  id: z.string(),
  patientId: z.string(),
  resourceId: Slug,
  resourceName: z.string(),
  serviceId: Slug,
  serviceName: z.string(),
  start: LocalDateTime,
  end: LocalDateTime,
  status: AppointmentStatus,
});
export type Appointment = z.infer<typeof Appointment>;

/** A message for staff, from flow (b). */
export const StaffTask = z.object({
  id: z.string(),
  callId: z.string(),
  category: z.string(),
  summary: z.string(),
  urgency: z.enum(['urgent', 'today', 'routine']),
  /** Null when the caller could not be verified. */
  patientId: z.string().nullable(),
  patientName: z.string().nullable(),
  callerName: z.string().nullable(),
  verified: z.boolean(),
  /** Masked for display; staff dial from the full number in the task detail view (M4). */
  callbackNumberMasked: z.string(),
  callbackBy: LocalDateTime,
  status: z.enum(['open', 'done']),
  createdAt: z.string(),
});
export type StaffTask = z.infer<typeof StaffTask>;

/** One appointment that needs a reminder call now (flow c). */
export const DueReminder = z.object({
  appointmentId: z.string(),
  patientId: z.string(),
  /** Used for "Am I speaking with …?" only. Nothing else is said before verification. */
  patientName: z.string(),
  /** Full number: the dialler needs it. Never logged. */
  phone: z.string(),
  attempts: z.number().int().nonnegative(),
});
export type DueReminder = z.infer<typeof DueReminder>;

export const NewPatient = z.object({
  name: z.string().trim().min(2),
  phone: z.string(),
  dob: LocalDate.optional(),
});
export type NewPatient = z.infer<typeof NewPatient>;
