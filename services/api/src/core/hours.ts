import {
  addDays,
  type BusinessConfig,
  fromMinutes,
  joinDateTime,
  splitDateTime,
  toMinutes,
  weekdayOf,
} from '@myna/shared';

/** The business's open sessions on `date`, in minutes since midnight. Closed dates are empty. */
export function openSessions(config: BusinessConfig, date: string): [number, number][] {
  if (config.closedDates.includes(date)) return [];
  return (config.hours[weekdayOf(date)] ?? [])
    .map((r): [number, number] => [toMinutes(r.start), toMinutes(r.end)])
    .sort((a, b) => a[0] - b[0]);
}

/**
 * `minutes` of OPEN time after `from` (business-local). A 2-hour callback promise made at
 * 9 pm lands at noon the next morning (opening 10:00), not at 11 pm, and skips Sundays and
 * holidays. Searches up to two weeks ahead; a business with no hours at all returns null.
 */
export function addOpenMinutes(
  config: BusinessConfig,
  from: string,
  minutes: number,
): string | null {
  const { date: startDate, time } = splitDateTime(from);
  let remaining = minutes;
  let cursorDate = startDate;
  let cursor = toMinutes(time);
  for (let day = 0; day < 14; day++) {
    for (const [open, close] of openSessions(config, cursorDate)) {
      const start = Math.max(open, cursor);
      if (start >= close) continue;
      const available = close - start;
      if (remaining <= available) return joinDateTime(cursorDate, fromMinutes(start + remaining));
      remaining -= available;
    }
    cursorDate = addDays(cursorDate, 1);
    cursor = 0;
  }
  return null;
}

/** Whether the business is open at business-local `at`. */
export function isOpenAt(config: BusinessConfig, at: string): boolean {
  const { date, time } = splitDateTime(at);
  const m = toMinutes(time);
  return openSessions(config, date).some(([open, close]) => m >= open && m < close);
}

/** Whether business-local `at` falls inside [start, end) of a `HH:mm` window. */
export function insideWindow(at: string, window: { start: string; end: string }): boolean {
  const { time } = splitDateTime(at);
  return time >= window.start && time < window.end;
}
