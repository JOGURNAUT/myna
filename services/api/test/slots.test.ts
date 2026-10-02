import { beforeAll, describe, expect, it } from 'vitest';
import { type BusinessConfig, ToolFailure } from '@myna/shared';
import { assertBookable, generateSlots } from '../src/core/slots.js';
import { loadDemoConfig } from './helpers.js';

const NOW = '2026-10-12T09:00'; // Monday
let config: BusinessConfig;
beforeAll(async () => {
  config = await loadDemoConfig();
});

const query = (over: Partial<Parameters<typeof generateSlots>[1]> = {}) => ({
  serviceId: 'consultation',
  dateFrom: '2026-10-12',
  dateTo: '2026-10-12',
  limit: 50,
  ...over,
});

const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    if (e instanceof ToolFailure) return e.code;
    throw e;
  }
  return 'OK';
};

describe('generateSlots', () => {
  it('starts after the minimum notice and steps by 15 minutes', () => {
    const slots = generateSlots(config, query(), new Map(), NOW);
    expect(slots[0]).toMatchObject({
      start: '2026-10-12T10:00',
      end: '2026-10-12T10:15',
      resourceId: 'dr-mehta',
    });
    expect(slots[1]?.start).toBe('2026-10-12T10:15');
  });

  it('only offers a doctor inside both their own and the clinic hours', () => {
    const monday = generateSlots(config, query({ resourceId: 'dr-rao' }), new Map(), NOW);
    expect(monday.length).toBeGreaterThan(0);
    expect(monday.every((s) => s.start >= '2026-10-12T17:00')).toBe(true);
    // Dr. Mehta doesn't sit on Wednesdays
    const wed = generateSlots(
      config,
      query({ resourceId: 'dr-mehta', dateFrom: '2026-10-14', dateTo: '2026-10-14' }),
      new Map(),
      NOW,
    );
    expect(wed).toEqual([]);
  });

  it('never offers a slot that runs past the end of a session', () => {
    const slots = generateSlots(config, query({ serviceId: 'root-canal' }), new Map(), NOW);
    const morning = slots.filter((s) => s.start < '2026-10-12T13:00');
    expect(morning.at(-1)?.start).toBe('2026-10-12T12:15'); // 45 min → ends exactly at 13:00
    expect(slots.every((s) => s.end <= '2026-10-12T13:00' || s.start >= '2026-10-12T17:00')).toBe(
      true,
    );
  });

  it('skips Sundays, closed dates and busy times', () => {
    const busy = new Map([['dr-mehta', [{ start: '2026-10-12T10:00', end: '2026-10-12T10:30' }]]]);
    const mon = generateSlots(config, query({ resourceId: 'dr-mehta', limit: 1 }), busy, NOW);
    expect(mon[0]?.start).toBe('2026-10-12T10:30');
    const sun = generateSlots(
      config,
      query({ dateFrom: '2026-10-18', dateTo: '2026-10-18' }),
      new Map(),
      NOW,
    );
    expect(sun).toEqual([]);
    const diwali = generateSlots(
      config,
      query({ dateFrom: '2026-10-20', dateTo: '2026-10-21' }),
      new Map(),
      NOW,
    );
    expect(diwali).toEqual([]);
  });

  it('filters by part of day', () => {
    const evening = generateSlots(config, query({ partOfDay: 'evening' }), new Map(), NOW);
    expect(evening.every((s) => s.start >= '2026-10-12T17:00')).toBe(true);
  });

  it('ignores dates before today and beyond the booking horizon', () => {
    expect(
      generateSlots(
        config,
        query({ dateFrom: '2026-10-01', dateTo: '2026-10-11' }),
        new Map(),
        NOW,
      ),
    ).toEqual([]);
    expect(
      generateSlots(
        config,
        query({ dateFrom: '2026-12-01', dateTo: '2026-12-05' }),
        new Map(),
        NOW,
      ),
    ).toEqual([]);
  });
});

describe('assertBookable', () => {
  const book = (resource: string, service: string, start: string) => () =>
    assertBookable(config, resource, service, start, NOW);

  it('accepts a valid slot', () => {
    expect(code(book('dr-mehta', 'cleaning', '2026-10-13T11:30'))).toBe('OK');
  });

  it.each([
    ['dr-mehta', 'cleaning', '2026-10-12T09:30', 'TOO_SOON'],
    ['dr-mehta', 'cleaning', '2026-10-12T09:59', 'TOO_SOON'],
    ['dr-mehta', 'cleaning', '2026-12-01T10:00', 'TOO_FAR_AHEAD'],
    ['dr-mehta', 'cleaning', '2026-10-13T14:00', 'OUTSIDE_HOURS'],
    ['dr-mehta', 'cleaning', '2026-10-13T12:45', 'OUTSIDE_HOURS'], // would end 13:15
    ['dr-mehta', 'cleaning', '2026-10-13T10:05', 'OUTSIDE_HOURS'], // off the 15-min grid
    ['dr-mehta', 'cleaning', '2026-10-18T10:00', 'OUTSIDE_HOURS'], // Sunday
    ['dr-mehta', 'cleaning', '2026-10-20T10:00', 'OUTSIDE_HOURS'], // Diwali
    ['dr-mehta', 'cleaning', '2026-10-14T10:00', 'OUTSIDE_HOURS'], // Mehta off on Wed
    ['dr-rao', 'root-canal', '2026-10-14T10:00', 'SERVICE_NOT_OFFERED'],
    ['dr-nobody', 'cleaning', '2026-10-13T10:00', 'NOT_FOUND'],
  ])('%s %s at %s → %s', (resource, service, start, expected) => {
    expect(code(book(resource, service, start))).toBe(expected);
  });
});
