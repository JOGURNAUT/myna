import { z } from 'zod';
import { Language, LocalDate, LocalTime, PhoneNumber, Slug, Weekday } from './primitives.js';

/**
 * Business config. The model is vertical-agnostic: a business has resources (people or rooms
 * that can be booked), services (what can be booked, and for how long), opening hours and rules.
 * A dental clinic is one kind of business: resources are doctors, services are visit types.
 */

const TimeRange = z
  .object({ start: LocalTime, end: LocalTime })
  .refine((r) => r.start < r.end, { message: 'start must be before end' });
export type TimeRange = z.infer<typeof TimeRange>;

/** Sessions per weekday. A missing or empty day means closed. */
const WeeklyHours = z.partialRecord(Weekday, z.array(TimeRange));
export type WeeklyHours = z.infer<typeof WeeklyHours>;

export const Resource = z.object({
  id: Slug,
  name: z.string().min(1),
  /** Display role, e.g. "doctor". Only used in wording. */
  kind: z.string().min(1).default('doctor'),
  /** Services this resource provides. */
  services: z.array(Slug).min(1),
  /** When this resource works. Must fall inside the business's hours. */
  hours: WeeklyHours,
});
export type Resource = z.infer<typeof Resource>;

export const Service = z.object({
  id: Slug,
  name: z.string().min(1),
  /** Spoken names per language, used by the agent when reading back. */
  spoken: z.partialRecord(Language, z.string()).default({}),
  durationMin: z.number().int().min(5).max(480),
});
export type Service = z.infer<typeof Service>;

export const FaqEntry = z.object({
  id: Slug,
  question: z.string().min(1),
  /** Empty answer means "don't guess, take a message" — on purpose. */
  answer: z.string().default(''),
});
export type FaqEntry = z.infer<typeof FaqEntry>;

export const BusinessConfig = z
  .object({
    id: Slug,
    tenantId: Slug,
    vertical: z.literal('clinic'),
    name: z.string().min(1),
    /** Spoken name per language for the greeting. */
    spokenName: z.partialRecord(Language, z.string()).default({}),
    timezone: z.string().default('Asia/Kolkata'),
    phone: PhoneNumber,
    /** Where calls go on handoff or when the kill switch is on. */
    humanHandoffNumber: PhoneNumber,
    languages: z.array(Language).min(1),
    greetingLanguage: Language,
    schedulingMode: z.enum(['slots', 'tokens', 'hybrid']).default('slots'),
    /**
     * Where this clinic's appointments live. `gsheets` is a Google Sheet the clinic already
     * uses (the pilot default: most small clinics run on paper or Sheets); `sqlite` is the
     * built-in store (dev, Hawk, and clinics with no spreadsheet).
     */
    scheduleStore: z
      .object({
        backend: z.enum(['sqlite', 'gsheets']).default('sqlite'),
        /** The id in the sheet's URL. Credentials are NOT config: they come from the environment. */
        spreadsheetId: z.string().min(10).optional(),
      })
      .default({ backend: 'sqlite' }),
    hours: WeeklyHours,
    /** Dates the business is closed (holidays). */
    closedDates: z.array(LocalDate).default([]),
    resources: z.array(Resource).min(1),
    services: z.array(Service).min(1),
    booking: z
      .object({
        slotStepMin: z.number().int().min(5).max(60).default(15),
        /** Earliest bookable slot, counted from now. */
        minNoticeMin: z.number().int().min(0).default(60),
        maxDaysAhead: z.number().int().min(1).max(180).default(30),
      })
      .default({ slotStepMin: 15, minNoticeMin: 60, maxDaysAhead: 30 }),
    faq: z.array(FaqEntry).default([]),
    /**
     * Pilot step 2 ("after-hours only"): bookings made while the clinic is closed are `pending`
     * until staff approve them on the dashboard the next morning.
     */
    bookingApproval: z.enum(['none', 'after_hours']).default('none'),
    /** The public "Talk to Myna" page may show this clinic's busy/free grid (no names). */
    publicDemo: z.boolean().default(false),
    /** Assumptions behind "staff hours saved" on the dashboard (shown with the formula). */
    metrics: z
      .object({
        receptionistCallMinutes: z.number().min(0.5).max(30).default(3),
        reminderCallMinutes: z.number().min(0.5).max(30).default(2),
      })
      .default({ receptionistCallMinutes: 3, reminderCallMinutes: 2 }),
    /** What Myna promises when she takes a message, counted in opening hours. */
    callbackPromiseHours: z.number().int().min(1).max(48).default(2),
    /** Flow (b): which messages are always urgent, whatever the caller says. */
    staffTasks: z
      .object({
        urgentCategories: z.array(z.string()).default(['medicine_refill_request']),
      })
      .default({ urgentCategories: ['medicine_refill_request'] }),
    /** Flow (c). Off until the clinic owner explicitly turns it on (pilot rule). */
    outboundReminders: z
      .object({
        enabled: z.boolean().default(false),
        /** Calls only inside this window. Daytime only: must end by 19:00. */
        callWindow: TimeRange.default({ start: '10:00', end: '18:00' }).refine(
          (w) => w.end <= '19:00',
          { message: 'reminder calls must end by 19:00 (never late evening)' },
        ),
        maxAttempts: z.number().int().min(1).max(3).default(2),
        /** Minutes to wait before retrying a no-answer. */
        retryGapMin: z.number().int().min(15).default(90),
        daysBefore: z.number().int().min(1).max(3).default(1),
      })
      .default({
        enabled: false,
        callWindow: { start: '10:00', end: '18:00' },
        maxAttempts: 2,
        retryGapMin: 90,
        daysBefore: 1,
      }),
    /** Whether calls are recorded; drives the opening disclosure. Off by default (DPDP). */
    recordCalls: z.boolean().default(false),
    /** Global kill switch: every call goes straight to a human. */
    killSwitch: z.boolean().default(false),
  })
  .superRefine((cfg, ctx) => {
    if (!cfg.languages.includes(cfg.greetingLanguage)) {
      ctx.addIssue({
        code: 'custom',
        path: ['greetingLanguage'],
        message: 'must be one of languages',
      });
    }
    if (cfg.scheduleStore.backend === 'gsheets' && !cfg.scheduleStore.spreadsheetId) {
      ctx.addIssue({
        code: 'custom',
        path: ['scheduleStore', 'spreadsheetId'],
        message: 'a Google Sheets schedule needs the spreadsheet id',
      });
    }
    const serviceIds = new Set(cfg.services.map((s) => s.id));
    cfg.resources.forEach((r, i) => {
      r.services.forEach((sid, j) => {
        if (!serviceIds.has(sid)) {
          ctx.addIssue({
            code: 'custom',
            path: ['resources', i, 'services', j],
            message: `unknown service "${sid}"`,
          });
        }
      });
    });
    const dupes = (ids: string[]) => ids.filter((id, i) => ids.indexOf(id) !== i);
    for (const id of dupes(cfg.resources.map((r) => r.id))) {
      ctx.addIssue({ code: 'custom', path: ['resources'], message: `duplicate resource "${id}"` });
    }
    for (const id of dupes(cfg.services.map((s) => s.id))) {
      ctx.addIssue({ code: 'custom', path: ['services'], message: `duplicate service "${id}"` });
    }
  });
export type BusinessConfig = z.infer<typeof BusinessConfig>;
export type BusinessConfigInput = z.input<typeof BusinessConfig>;
