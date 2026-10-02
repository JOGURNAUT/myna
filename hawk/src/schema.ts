import { z } from 'zod';

/**
 * Hawk's YAML formats. A scenario says WHAT the caller wants and what the clinic's state must
 * be afterwards; the simulated patient decides HOW to say it, per language and persona.
 */

export const Language = z.enum(['en', 'hinglish', 'hi']);
export type Language = z.infer<typeof Language>;

export const Persona = z.object({
  id: z.string(),
  description: z.string(),
  /** How dates of birth are said: plain "12 April 1990", "12/04/1990", or mumbled in words. */
  dobStyle: z.enum(['spoken', 'numeric', 'words']).default('spoken'),
  /** Adds a filler sentence before answers ("Haan ji, actually…"). */
  rambles: z.boolean().default(false),
  /** Gives the bare answer ("Pooja Malhotra") rather than a sentence ("My name is…"). */
  terse: z.boolean().default(false),
});
export type Persona = z.infer<typeof Persona>;

const Day = z.string(); // tomorrow | monday… | next tuesday | YYYY-MM-DD
const Time = z.string(); // HH:mm | morning | afternoon | evening

const When = z.object({ day: Day.optional(), time: Time.optional() });
export type When = z.infer<typeof When>;

export const Who = z.object({
  name: z.string(),
  /** The name as a Hindi speaker says it (what speech-to-text would give in Devanagari). */
  nameHi: z.string().optional(),
  dob: z.string().optional(),
  phone: z.string().optional(),
});
export type Who = z.infer<typeof Who>;

/** Things the caller does at a given point, beyond pursuing the goal. */
export const Event = z.discriminatedUnion('do', [
  z.object({ do: z.literal('emergency'), atTurn: z.number().int().min(1) }),
  z.object({ do: z.literal('ask_medical'), atTurn: z.number().int().min(1) }),
  z.object({ do: z.literal('ask_staff'), atTurn: z.number().int().min(1) }),
  /** At the read-back, say no and change to another time (once). */
  z.object({ do: z.literal('change_mind_at_confirm'), to: When }),
  /** Mind change inside the first answer about time: "Wednesday… nahi, Tuesday". */
  z.object({ do: z.literal('correct_day_inline'), wrongDay: Day }),
  /** Gives this (wrong) date of birth instead of the real one. */
  z.object({ do: z.literal('wrong_dob'), dob: z.string() }),
  /** Says this phrase verbatim at the given turn (for regression scenarios). */
  z.object({
    do: z.literal('say'),
    atTurn: z.number().int().min(1),
    text: z.partialRecord(Language, z.string()),
  }),
]);
export type Event = z.infer<typeof Event>;

export const Goal = z.discriminatedUnion('intent', [
  z.object({
    intent: z.literal('book'),
    service: z.string(),
    doctor: z.string().optional(),
    when: When,
    pickOption: z.number().int().min(1).max(3).default(1),
  }),
  z.object({
    intent: z.literal('reschedule'),
    when: When,
    pickOption: z.number().int().default(1),
  }),
  z.object({ intent: z.literal('cancel') }),
  z.object({
    intent: z.literal('message'),
    /** What the caller opens with, per language (falls back to en). */
    text: z.partialRecord(Language, z.string()),
    /** What they say when asked "what should I pass on?" (defaults to `text`). */
    details: z.partialRecord(Language, z.string()).optional(),
    /** Mixed call: book first, then this message. */
    alsoBook: z.object({ service: z.string(), when: When }).optional(),
  }),
  z.object({
    intent: z.literal('faq'),
    topic: z.enum(['timings', 'address', 'fees', 'insurance']),
  }),
  z.object({ intent: z.literal('chitchat') }),
  // Reminder calls (outbound): how the callee responds.
  z.object({ intent: z.literal('confirm_attendance') }),
  z.object({
    intent: z.literal('move_from_reminder'),
    when: When,
    pickOption: z.number().int().default(1),
  }),
  z.object({ intent: z.literal('cancel_from_reminder') }),
  z.object({ intent: z.literal('family_answers') }),
  z.object({ intent: z.literal('wrong_number') }),
  z.object({ intent: z.literal('opt_out') }),
  z.object({ intent: z.literal('no_answer') }),
  z.object({ intent: z.literal('voicemail') }),
]);
export type Goal = z.infer<typeof Goal>;

const SeedPatient = z.object({
  key: z.string(),
  name: z.string(),
  phone: z.string(),
  dob: z.string().optional(),
  doNotCall: z.boolean().optional(),
});
const SeedAppointment = z.object({
  key: z.string(),
  patient: z.string(),
  serviceId: z.string(),
  resourceId: z.string(),
  start: z.string(),
});

const ExpectedAppointment = z.object({
  patient: z.string(),
  service: z.string(),
  start: z.string(),
  status: z.enum(['confirmed', 'cancelled']).default('confirmed'),
  doctor: z.string().optional(),
});

export const Scenario = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string(),
  flow: z.enum(['booking', 'messages', 'reminders']),
  /** Groups scenarios in the report ("reschedule", "emergency", "verification"…). */
  type: z.string(),
  persona: z.string().default('polite-adult'),
  languages: z.array(Language).default(['en', 'hinglish', 'hi']),
  direction: z.enum(['inbound', 'outbound']).default('inbound'),
  /** Caller ID on inbound calls. Omit for a withheld number. */
  callerPhone: z.string().optional(),
  caller: Who,
  thirdParty: z.boolean().default(false),
  seed: z
    .object({
      config: z.record(z.string(), z.unknown()).default({}),
      patients: z.array(SeedPatient).default([]),
      appointments: z.array(SeedAppointment).default([]),
    })
    .default({ config: {}, patients: [], appointments: [] }),
  goal: Goal,
  events: z.array(Event).default([]),
  expect: z.object({
    /** The complete list of appointments afterwards (any status). Omit to skip the check. */
    appointments: z.array(ExpectedAppointment).optional(),
    tasks: z
      .array(
        z.object({
          category: z.string(),
          verified: z.boolean().optional(),
          urgency: z.string().optional(),
        }),
      )
      .optional(),
    reminderOutcome: z.string().optional(),
    doNotCall: z.array(z.string()).optional(),
    /** Expected handoff reason, or "none". */
    handoff: z.string().default('none'),
    /** Words that must never appear in what Myna says on this call. */
    neverSay: z.array(z.string()).default([]),
  }),
  maxTurns: z.number().int().default(16),
  /** Why this scenario exists (e.g. "regression for findings.md M1 #2"). */
  notes: z.string().optional(),
});
export type Scenario = z.infer<typeof Scenario>;
