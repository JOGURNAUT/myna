import type { Weekday } from './primitives.js';

/**
 * Business-local date/time helpers. Everything works on wall-clock strings
 * (`YYYY-MM-DD`, `HH:mm`, `YYYY-MM-DDTHH:mm`) and uses UTC arithmetic internally,
 * so results never depend on the server's own time zone.
 */

const WEEKDAYS: readonly Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function fromMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function splitDateTime(dt: string): { date: string; time: string } {
  const [date = '', time = ''] = dt.split('T');
  return { date, time };
}

export function joinDateTime(date: string, time: string): string {
  return `${date}T${time}`;
}

function parseDate(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function weekdayOf(date: string): Weekday {
  const day = WEEKDAYS[parseDate(date).getUTCDay()];
  if (!day) throw new Error(`invalid date: ${date}`);
  return day;
}

export function addDays(date: string, days: number): string {
  const d = parseDate(date);
  d.setUTCDate(d.getUTCDate() + days);
  return formatDate(d);
}

/** Inclusive list of dates from `from` to `to`. */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function addMinutes(dt: string, minutes: number): string {
  const d = new Date(`${dt}:00Z`);
  d.setUTCMinutes(d.getUTCMinutes() + minutes);
  return d.toISOString().slice(0, 16);
}

/** Minutes from `a` to `b` (both business-local date-times). */
export function minutesBetween(a: string, b: string): number {
  return (new Date(`${b}:00Z`).getTime() - new Date(`${a}:00Z`).getTime()) / 60_000;
}

/** Current wall-clock date-time in `timeZone`, as `YYYY-MM-DDTHH:mm`. */
export function nowIn(timeZone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}
