import {
  addDays,
  addMinutes,
  type BusinessConfig,
  datesBetween,
  fromMinutes,
  joinDateTime,
  minutesBetween,
  type Resource,
  type Service,
  type Slot,
  splitDateTime,
  type TimeRange,
  toMinutes,
  ToolFailure,
  weekdayOf,
} from '@myna/shared';

export interface Interval {
  start: string;
  end: string;
}

export type PartOfDay = 'morning' | 'afternoon' | 'evening';

const PART_OF_DAY: Record<PartOfDay, [number, number]> = {
  morning: [0, 12 * 60],
  afternoon: [12 * 60, 17 * 60],
  evening: [17 * 60, 24 * 60],
};

export function findService(config: BusinessConfig, serviceId: string): Service {
  const service = config.services.find((s) => s.id === serviceId);
  if (!service) throw new ToolFailure('NOT_FOUND', `unknown service "${serviceId}"`);
  return service;
}

export function findResource(config: BusinessConfig, resourceId: string): Resource {
  const resource = config.resources.find((r) => r.id === resourceId);
  if (!resource) throw new ToolFailure('NOT_FOUND', `unknown resource "${resourceId}"`);
  return resource;
}

/** Intersection of two lists of time ranges, in minutes since midnight. */
function intersect(a: TimeRange[], b: TimeRange[]): [number, number][] {
  const out: [number, number][] = [];
  for (const x of a) {
    for (const y of b) {
      const start = Math.max(toMinutes(x.start), toMinutes(y.start));
      const end = Math.min(toMinutes(x.end), toMinutes(y.end));
      if (start < end) out.push([start, end]);
    }
  }
  return out.sort((p, q) => p[0] - q[0]);
}

/** When `resource` can see patients on `date`: its own hours inside the business's hours. */
export function sessionsOn(config: BusinessConfig, resource: Resource, date: string) {
  if (config.closedDates.includes(date)) return [];
  const day = weekdayOf(date);
  return intersect(config.hours[day] ?? [], resource.hours[day] ?? []);
}

function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

export interface SlotQuery {
  serviceId: string;
  resourceId?: string | undefined;
  dateFrom: string;
  dateTo: string;
  partOfDay?: PartOfDay | undefined;
  limit: number;
}

/**
 * Free slots for a service, earliest first. `now` is business-local; `busy` holds the
 * non-cancelled appointments per resource in the date range.
 */
export function generateSlots(
  config: BusinessConfig,
  query: SlotQuery,
  busy: ReadonlyMap<string, Interval[]>,
  now: string,
): Slot[] {
  const service = findService(config, query.serviceId);
  if (query.resourceId) findResource(config, query.resourceId);
  const resources = config.resources.filter(
    (r) => r.services.includes(service.id) && (!query.resourceId || r.id === query.resourceId),
  );

  const today = splitDateTime(now).date;
  const lastDay = addDays(today, config.booking.maxDaysAhead);
  const from = query.dateFrom < today ? today : query.dateFrom;
  const to = query.dateTo > lastDay ? lastDay : query.dateTo;
  if (from > to) return [];

  const earliest = addMinutes(now, config.booking.minNoticeMin);
  const step = config.booking.slotStepMin;
  const window = query.partOfDay ? PART_OF_DAY[query.partOfDay] : null;
  const slots: Slot[] = [];

  for (const date of datesBetween(from, to)) {
    for (const resource of resources) {
      const taken = busy.get(resource.id) ?? [];
      for (const [sessionStart, sessionEnd] of sessionsOn(config, resource, date)) {
        for (let m = sessionStart; m + service.durationMin <= sessionEnd; m += step) {
          if (window && (m < window[0] || m >= window[1])) continue;
          const start = joinDateTime(date, fromMinutes(m));
          if (start < earliest) continue;
          const slot = { start, end: addMinutes(start, service.durationMin) };
          if (taken.some((b) => overlaps(slot, b))) continue;
          slots.push({
            ...slot,
            resourceId: resource.id,
            resourceName: resource.name,
            serviceId: service.id,
          });
        }
      }
    }
  }
  slots.sort((a, b) => a.start.localeCompare(b.start) || a.resourceId.localeCompare(b.resourceId));
  return slots.slice(0, query.limit);
}

/**
 * Throws a `ToolFailure` if `start` is not a bookable slot by the rules alone
 * (hours, notice, horizon, step). Whether it's free is the adapter's job.
 */
export function assertBookable(
  config: BusinessConfig,
  resourceId: string,
  serviceId: string,
  start: string,
  now: string,
): Interval {
  const resource = findResource(config, resourceId);
  const service = findService(config, serviceId);
  if (!resource.services.includes(service.id)) {
    throw new ToolFailure('SERVICE_NOT_OFFERED', `${resource.name} does not offer ${service.name}`);
  }
  const end = addMinutes(start, service.durationMin);
  const { date, time } = splitDateTime(start);

  if (minutesBetween(now, start) < config.booking.minNoticeMin) {
    throw new ToolFailure('TOO_SOON', 'slot is in the past or inside the minimum notice', {
      minNoticeMin: config.booking.minNoticeMin,
    });
  }
  if (date > addDays(splitDateTime(now).date, config.booking.maxDaysAhead)) {
    throw new ToolFailure('TOO_FAR_AHEAD', 'slot is beyond the booking horizon', {
      maxDaysAhead: config.booking.maxDaysAhead,
    });
  }
  const m = toMinutes(time);
  const fits = sessionsOn(config, resource, date).some(
    ([s, e]) =>
      m >= s && m + service.durationMin <= e && (m - s) % config.booking.slotStepMin === 0,
  );
  if (!fits) {
    throw new ToolFailure('OUTSIDE_HOURS', `${resource.name} is not available at ${start}`);
  }
  return { start, end };
}
