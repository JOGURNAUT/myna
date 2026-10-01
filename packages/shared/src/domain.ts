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

export const NewPatient = z.object({
  name: z.string().trim().min(2),
  phone: z.string(),
  dob: LocalDate.optional(),
});
export type NewPatient = z.infer<typeof NewPatient>;
