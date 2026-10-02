import { beforeAll, describe, expect, it } from 'vitest';
import type { BusinessConfig } from '@myna/shared';
import { addOpenMinutes, insideWindow } from '../src/core/hours.js';
import { loadDemoConfig } from './helpers.js';

// Smile Dental: Mon–Fri 10–13 & 17–20:30, Sat 10–14, Sun closed, closed 20–21 Oct (Diwali).
let config: BusinessConfig;
beforeAll(async () => {
  config = await loadDemoConfig();
});

describe('addOpenMinutes (callback promises count opening hours only)', () => {
  it.each([
    ['inside a session', '2026-10-12T10:30', 120, '2026-10-12T12:30'],
    ['across the lunch break', '2026-10-12T12:00', 120, '2026-10-12T18:00'],
    ['before opening', '2026-10-12T08:00', 120, '2026-10-12T12:00'],
    ['late evening → next morning', '2026-10-12T21:00', 120, '2026-10-13T12:00'],
    ['Saturday afternoon → Monday', '2026-10-17T13:00', 120, '2026-10-19T11:00'],
    ['Sunday → Monday', '2026-10-18T11:00', 120, '2026-10-19T12:00'],
    ['skips Diwali', '2026-10-19T21:00', 60, '2026-10-22T11:00'],
  ])('%s', (_label, from, minutes, expected) => {
    expect(addOpenMinutes(config, from, minutes)).toBe(expected);
  });

  it('returns null for a business with no hours', () => {
    expect(addOpenMinutes({ ...config, hours: {} }, '2026-10-12T10:00', 60)).toBeNull();
  });
});

describe('insideWindow', () => {
  const w = { start: '10:00', end: '18:00' };
  it('is half-open', () => {
    expect(insideWindow('2026-10-12T10:00', w)).toBe(true);
    expect(insideWindow('2026-10-12T17:59', w)).toBe(true);
    expect(insideWindow('2026-10-12T18:00', w)).toBe(false);
    expect(insideWindow('2026-10-12T09:59', w)).toBe(false);
  });
});

describe('reminder call window validation', () => {
  it('refuses a window that runs into late evening', async () => {
    const { BusinessConfig } = await import('@myna/shared');
    const bad = BusinessConfig.safeParse({
      ...config,
      outboundReminders: {
        ...config.outboundReminders,
        callWindow: { start: '10:00', end: '21:00' },
      },
    });
    expect(bad.success).toBe(false);
  });
});
