import { describe, expect, it } from 'vitest';
import { clock, day, duration, latency, pct, when } from '../src/lib/format';

describe('format', () => {
  it('writes business-local times without any time-zone maths', () => {
    expect(when('2026-10-14T16:30')).toBe('Wed, 14 Oct · 4:30 pm');
    expect(when('2026-10-12T00:00')).toBe('Mon, 12 Oct · 12 am');
    expect(clock('12:15')).toBe('12:15 pm');
    expect(day('2026-12-31')).toBe('Thu, 31 Dec');
  });

  it('says milliseconds when a reply takes milliseconds', () => {
    expect(latency(33)).toBe('33 ms');
    expect(latency(999.4)).toBe('999 ms');
    expect(latency(1500)).toBe('1.5 s');
  });

  it('formats call lengths and rates', () => {
    expect(duration(null)).toBe('—');
    expect(duration(48)).toBe('48s');
    expect(duration(115)).toBe('1m 55s');
    expect(pct(0.9237)).toBe('92%');
  });
});
