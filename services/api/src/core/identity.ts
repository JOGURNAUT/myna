/**
 * Matching rules for patient verification. Deliberately strict: a near-miss is
 * "not verified" (the agent then asks again or hands off), never a guess.
 */

const HONORIFICS = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'shri', 'smt', 'kumari', 'sri']);
const SUFFIXES = new Set(['ji']);

/** Lower-case, strip punctuation, honorifics and "ji", sort tokens: order of names doesn't matter. */
export function nameKey(name: string): string {
  return name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0 && !HONORIFICS.has(t) && !SUFFIXES.has(t))
    .sort()
    .join(' ');
}

/** Last 10 digits of a phone number, or null if it can't be an Indian mobile. */
export function phoneKey(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  const last10 = digits.slice(-10);
  return /^[6-9]\d{9}$/.test(last10) ? last10 : null;
}
