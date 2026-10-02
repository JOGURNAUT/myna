import type { AppointmentStatus, BusinessConfig, Slot } from '@myna/shared';
import type { SlotQuery } from '../core/slots.js';

/**
 * Storage for one business's schedule. Implementations: SQLite (dev + harness),
 * Google Sheets (pilot clinics, M4), FHIR (stretch). Every implementation must pass
 * `test/contract/scheduling-adapter.contract.ts`.
 *
 * Adapters store and fetch; they do NOT decide who may see what (verification lives in
 * the tool layer) or whether a time obeys clinic rules (`assertBookable`). They DO own
 * atomicity: no overlapping bookings per resource, and idempotent writes.
 */
export interface SchedulingAdapter {
  readonly config: BusinessConfig;

  /** Candidates sharing a phone number or date of birth. Name matching happens above. */
  findPatients(by: { phone?: string; dob?: string }): Promise<PatientRecord[]>;
  createPatient(p: {
    name: string;
    phone: string;
    dob?: string | undefined;
  }): Promise<PatientRecord>;

  listSlots(query: SlotQuery, now: string): Promise<Slot[]>;
  getAppointment(id: string): Promise<StoredAppointment | null>;
  /** Non-cancelled appointments for a patient starting at or after `from`. */
  listAppointments(patientId: string, from: string): Promise<StoredAppointment[]>;

  /** Throws `SLOT_UNAVAILABLE` on overlap, `IDEMPOTENCY_CONFLICT` on key reuse with a different request. */
  book(req: BookRequest): Promise<StoredAppointment>;
  reschedule(req: RescheduleRequest): Promise<StoredAppointment>;
  cancel(req: CancelRequest): Promise<StoredAppointment>;
}

export interface PatientRecord {
  id: string;
  name: string;
  /** Last 10 digits. */
  phone: string;
  dob: string | null;
}

export interface StoredAppointment {
  id: string;
  patientId: string;
  resourceId: string;
  serviceId: string;
  start: string;
  end: string;
  status: AppointmentStatus;
}

export interface BookRequest {
  idempotencyKey: string;
  patientId: string;
  resourceId: string;
  serviceId: string;
  start: string;
  end: string;
  source: string;
}

export interface RescheduleRequest {
  idempotencyKey: string;
  appointmentId: string;
  /** The verified patient; an appointment belonging to someone else is NOT_FOUND. */
  patientId: string;
  resourceId: string;
  start: string;
  end: string;
}

export interface CancelRequest {
  idempotencyKey: string;
  appointmentId: string;
  patientId: string;
}
