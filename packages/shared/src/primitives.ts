import { z } from 'zod';

/** Stable identifier: lower-case slug, used for clinics, resources, services. */
export const Slug = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,63}$/, 'lower-case letters, digits and dashes');

/** Calendar date in the business's local time zone: `YYYY-MM-DD`. */
export const LocalDate = z.iso.date();

/** Wall-clock time: `HH:mm` (24h). */
export const LocalTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:mm, 24-hour');

/**
 * Date and time in the business's local time zone, no offset: `YYYY-MM-DDTHH:mm`.
 * All schedule times on the wire are business-local; the zone lives in the config.
 * Lexicographic order equals chronological order, which the API relies on.
 */
export const LocalDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/, 'YYYY-MM-DDTHH:mm, business-local');

/** Indian mobile number, digits only, with or without the 91 country code. */
export const PhoneNumber = z
  .string()
  .transform((s) => s.replace(/[\s()+-]/g, ''))
  .pipe(z.string().regex(/^(91)?[6-9]\d{9}$/, 'a 10-digit Indian mobile number'));

export const Language = z.enum(['en', 'hi', 'hinglish']);
export type Language = z.infer<typeof Language>;

export const Weekday = z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
export type Weekday = z.infer<typeof Weekday>;

/** Masks a phone number for logs and UI: `98xxxxx210`. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '').slice(-10);
  if (digits.length < 5) return 'x'.repeat(digits.length);
  return `${digits.slice(0, 2)}${'x'.repeat(digits.length - 5)}${digits.slice(-3)}`;
}
