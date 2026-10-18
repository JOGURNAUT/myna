import { clock, day } from '@/lib/format';
import type { Demo } from '@/lib/types';
import { Icon, ICONS } from './ui';

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

function nextOpenDays(demo: Demo, count: number): string[] {
  const out: string[] = [];
  const d = new Date(`${demo.today}T00:00:00Z`);
  for (let i = 0; i < 14 && out.length < count; i++, d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    const weekday = WEEKDAYS[d.getUTCDay()];
    const open = weekday ? (demo.hours[weekday] ?? []).length > 0 : false;
    if (open && !demo.closedDates.includes(iso)) out.push(iso);
  }
  return out;
}

const hhmm = (local: string) => local.slice(11, 16);

/**
 * Who's busy when, for the next few open days. Shows times only. Bookings that appeared during
 * this chat are marked, so a visitor sees their appointment land on the schedule.
 */
export function Schedule({ demo, fresh }: { demo: Demo; fresh: ReadonlySet<string> }) {
  const days = nextOpenDays(demo, 5);
  const key = (b: Demo['busy'][number]) => `${b.resourceId}|${b.start}`;
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-xl font-bold">{demo.name}: next few days</h2>
      <div className="overflow-x-auto rounded-[20px] border border-line bg-surface">
        <table className="w-full min-w-[420px] border-collapse text-left text-sm">
          <thead>
            <tr className="bg-sunken text-xs font-semibold tracking-wider text-ink-3 uppercase">
              <th className="px-4 py-3">Day</th>
              {demo.resources.map((r) => (
                <th key={r.id} className="px-4 py-3">
                  {r.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d} className="border-t border-line align-top">
                <th scope="row" className="tnum px-4 py-3 font-semibold whitespace-nowrap">
                  {day(d)}
                </th>
                {demo.resources.map((r) => {
                  const weekday = WEEKDAYS[new Date(`${d}T00:00:00Z`).getUTCDay()];
                  const works = weekday ? (r.hours[weekday] ?? []).length > 0 : false;
                  const busy = demo.busy.filter(
                    (b) =>
                      b.resourceId === r.id && b.start.startsWith(d) && b.status !== 'cancelled',
                  );
                  return (
                    <td key={r.id} className="px-4 py-3">
                      {!works ? (
                        <span className="text-ink-3">Not in</span>
                      ) : busy.length === 0 ? (
                        <span className="text-safe-ink">Free</span>
                      ) : (
                        <ul className="flex flex-wrap gap-1.5">
                          {busy.map((b) => (
                            <li
                              key={key(b)}
                              className={`tnum inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[13px] font-semibold ${
                                fresh.has(key(b))
                                  ? 'bg-accent-soft text-accent-ink ring-2 ring-accent'
                                  : 'bg-muted-soft text-muted-ink'
                              }`}
                            >
                              {fresh.has(key(b)) && <Icon d={ICONS.check} size={13} />}
                              {clock(hhmm(b.start))}
                              {fresh.has(key(b)) && <span className="sr-only"> (new booking)</span>}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[13px] text-ink-3">
        Booked times only. Names are never shown. Anything not listed is free.
      </p>
    </div>
  );
}
