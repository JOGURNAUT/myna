import { z } from 'zod';
import { Appointment, NewPatient, PatientSummary, Slot } from './domain.js';
import { ToolError } from './errors.js';
import { Language, LocalDate, LocalDateTime, Slug } from './primitives.js';

/**
 * Tool contracts between the agent and the API. These are the ONLY way the agent can read
 * or change the schedule. Each tool has an input and an output schema; the API validates both,
 * and the agent's Pydantic models are generated from the exported JSON Schema.
 */

const IdempotencyKey = z.string().min(8).max(128);
const VerificationId = z.string().min(8);

// ---------- find_patient
export const FindPatientInput = z
  .object({
    callId: z.string().min(1),
    name: z.string().trim().min(2),
    dob: LocalDate.optional(),
    phone: z.string().optional(),
  })
  .refine((v) => v.dob !== undefined || v.phone !== undefined, {
    message: 'name plus dob or phone is required',
  });
export const FindPatientOutput = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('verified'),
    verificationId: VerificationId,
    patient: PatientSummary,
  }),
  /** Deliberately says nothing about WHY: never leak whether a name or number exists. */
  z.object({ status: z.literal('not_verified') }),
]);

// ---------- list_appointments (upcoming, for the verified patient)
export const ListAppointmentsInput = z.object({ verificationId: VerificationId });
export const ListAppointmentsOutput = z.object({ appointments: z.array(Appointment) });

// ---------- find_slots
export const PartOfDay = z.enum(['morning', 'afternoon', 'evening']);
export const FindSlotsInput = z.object({
  serviceId: Slug,
  resourceId: Slug.optional(),
  dateFrom: LocalDate,
  dateTo: LocalDate,
  partOfDay: PartOfDay.optional(),
  limit: z.number().int().min(1).max(20).default(5),
});
export const FindSlotsOutput = z.object({ slots: z.array(Slot) });

// ---------- book
export const BookInput = z
  .object({
    idempotencyKey: IdempotencyKey,
    callId: z.string().min(1),
    verificationId: VerificationId.optional(),
    newPatient: NewPatient.optional(),
    serviceId: Slug,
    resourceId: Slug,
    start: LocalDateTime,
  })
  .refine((v) => (v.verificationId === undefined) !== (v.newPatient === undefined), {
    message: 'exactly one of verificationId or newPatient',
  });
export const BookOutput = z.object({
  appointment: Appointment,
  /** Set when the booking registered a new patient, so the rest of the call can act for them. */
  verificationId: VerificationId.optional(),
});

// ---------- reschedule
export const RescheduleInput = z.object({
  idempotencyKey: IdempotencyKey,
  verificationId: VerificationId,
  appointmentId: z.string().min(1),
  newStart: LocalDateTime,
  newResourceId: Slug.optional(),
});
export const RescheduleOutput = z.object({ appointment: Appointment });

// ---------- cancel
export const CancelInput = z.object({
  idempotencyKey: IdempotencyKey,
  verificationId: VerificationId,
  appointmentId: z.string().min(1),
});
export const CancelOutput = z.object({ appointment: Appointment });

// ---------- handoff_to_human
export const HandoffReason = z.enum([
  'emergency',
  'medical_question',
  'low_confidence',
  'frustrated',
  'repeated_misunderstanding',
  'caller_asked',
  'kill_switch',
  'tool_failure',
  'verification_failed',
  'unanswered_question',
]);
export type HandoffReason = z.infer<typeof HandoffReason>;
export const HandoffInput = z.object({
  callId: z.string().min(1),
  reason: HandoffReason,
  summary: z.string().max(500),
});
export const HandoffOutput = z.object({ transferTo: z.string() });

// ---------- send_sms_confirmation
export const SendSmsInput = z.object({
  verificationId: VerificationId,
  appointmentId: z.string().min(1),
  language: Language,
});
export const SendSmsOutput = z.object({ queued: z.boolean() });

// ---------- create_staff_task (flow b)
export const StaffTaskCategory = z.enum([
  'report_status',
  'medicine_refill_request',
  'billing_question',
  'doctor_callback',
  'directions_timings',
  'other',
]);
export type StaffTaskCategory = z.infer<typeof StaffTaskCategory>;
export const TaskUrgency = z.enum(['urgent', 'today', 'routine']);
export const CreateStaffTaskInput = z.object({
  callId: z.string().min(1),
  /** Links the task to a verified patient. Absent = an unverified caller (flagged for staff). */
  verificationId: VerificationId.optional(),
  /** What an unverified caller said their name is. Never used to look anyone up. */
  callerName: z.string().trim().min(1).max(100).optional(),
  category: StaffTaskCategory,
  summary: z.string().min(1).max(200),
  urgency: TaskUrgency,
  callbackNumber: z.string(),
});
/** `callbackBy` is the promise Myna says out loud, counted in clinic opening hours. */
export const CreateStaffTaskOutput = z.object({ taskId: z.string(), callbackBy: LocalDateTime });

// ---------- mark_reminder_outcome (flow c)
export const ReminderOutcome = z.enum([
  'confirmed',
  'rescheduled',
  'cancelled',
  'wrong_number',
  'no_answer',
  'voicemail',
  'opted_out',
  /** A family member answered; asked them to have the patient call back. No details given. */
  'reached_family',
  /** The person couldn't confirm the patient's date of birth. No details given. */
  'not_verified',
]);
export type ReminderOutcome = z.infer<typeof ReminderOutcome>;
export const MarkReminderOutcomeInput = z.object({
  callId: z.string().min(1),
  appointmentId: z.string().min(1),
  outcome: ReminderOutcome,
});
export const MarkReminderOutcomeOutput = z.object({ recorded: z.boolean() });

/** Registry: tool name → schemas. The API mounts one route per entry. */
export const TOOLS = {
  find_patient: { input: FindPatientInput, output: FindPatientOutput },
  list_appointments: { input: ListAppointmentsInput, output: ListAppointmentsOutput },
  find_slots: { input: FindSlotsInput, output: FindSlotsOutput },
  book: { input: BookInput, output: BookOutput },
  reschedule: { input: RescheduleInput, output: RescheduleOutput },
  cancel: { input: CancelInput, output: CancelOutput },
  handoff_to_human: { input: HandoffInput, output: HandoffOutput },
  send_sms_confirmation: { input: SendSmsInput, output: SendSmsOutput },
  create_staff_task: { input: CreateStaffTaskInput, output: CreateStaffTaskOutput },
  mark_reminder_outcome: { input: MarkReminderOutcomeInput, output: MarkReminderOutcomeOutput },
} as const;

export type ToolName = keyof typeof TOOLS;
export type ToolInput<T extends ToolName> = z.input<(typeof TOOLS)[T]['input']>;
export type ToolArgs<T extends ToolName> = z.output<(typeof TOOLS)[T]['input']>;
export type ToolOutput<T extends ToolName> = z.output<(typeof TOOLS)[T]['output']>;

/** HTTP envelope for every tool response. */
export const toolResponse = <T extends z.ZodType>(data: T) =>
  z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), data }),
    z.object({ ok: z.literal(false), error: ToolError }),
  ]);
