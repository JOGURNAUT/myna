import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMinutes,
  datesBetween,
  fromMinutes,
  maskPhone,
  minutesBetween,
  nowIn,
  toMinutes,
  weekdayOf,
} from '../src/index.js';

describe('time helpers', () => {
  it('converts HH:mm both ways', () => {
    expect(toMinutes('17:30')).toBe(1050);
    expect(fromMinutes(1050)).toBe('17:30');
  });

  it('knows weekdays', () => {
    expect(weekdayOf('2026-10-14')).toBe('wed');
    expect(weekdayOf('2026-10-18')).toBe('sun');
  });

  it('adds days across month ends', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(datesBetween('2026-10-30', '2026-11-02')).toHaveLength(4);
  });

  it('adds minutes across midnight and measures gaps', () => {
    expect(addMinutes('2026-10-14T23:45', 30)).toBe('2026-10-15T00:15');
    expect(minutesBetween('2026-10-14T10:00', '2026-10-14T11:30')).toBe(90);
  });

  it('reads the wall clock in IST regardless of server zone', () => {
    expect(nowIn('Asia/Kolkata', new Date('2026-10-14T05:00:00Z'))).toBe('2026-10-14T10:30');
  });

  it('masks phone numbers', () => {
    expect(maskPhone('9812345210')).toBe('98xxxxx210');
    expect(maskPhone('+91 98123 45210')).toBe('98xxxxx210');
  });
});
