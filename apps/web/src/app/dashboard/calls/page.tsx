import Link from 'next/link';
import { Empty, Icon, ICONS, LangBadge } from '@/components/ui';
import { OutcomeBadge } from '@/components/outcome-badge';
import { staffApi } from '@/lib/api';
import { duration } from '@/lib/format';
import type { CallSummary, Me } from '@/lib/types';

export const metadata = { title: 'Calls' };

const addDays = (d: string, n: number) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
const RANGES = [
  ['today', 'Today', 0],
  ['week', 'Last 7 days', 6],
  ['month', 'Last 30 days', 29],
] as const;

export default async function CallsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { range } = await searchParams;
  const chosen = RANGES.find(([k]) => k === range) ?? RANGES[1];
  const me = await staffApi<Me>('/me');
  const { calls } = await staffApi<{ calls: CallSummary[] }>(
    `/calls?from=${addDays(me.today, -chosen[2])}&to=${me.today}`,
  );
  return (
    <section aria-labelledby="ac" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 id="ac" className="mr-auto text-2xl font-bold">
          All calls
        </h1>
        <div role="group" aria-label="Date range" className="flex gap-1.5">
          {RANGES.map(([k, label]) => (
            <Link
              key={k}
              href={`/dashboard/calls?range=${k}`}
              aria-current={chosen[0] === k ? 'true' : undefined}
              className={`inline-flex h-10 items-center rounded-full border px-3.5 text-sm font-semibold ${
                chosen[0] === k
                  ? 'border-primary bg-primary-soft text-primary-ink'
                  : 'border-line-strong bg-surface text-ink-2'
              }`}
            >
              {label}
            </Link>
          ))}
        </div>
      </div>
      {calls.length === 0 ? (
        <Empty title="No calls in this range">Calls appear here as they happen.</Empty>
      ) : (
        <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
          {calls.map((c) => (
            <li key={c.id}>
              <Link
                href={`/dashboard/calls/${c.id}`}
                className="grid gap-2 p-4 hover:bg-sunken md:grid-cols-[150px_110px_1fr_auto_70px] md:items-center md:gap-4"
              >
                <span className="tnum text-sm text-ink-3">{c.startedAt.replace('T', ' · ')}</span>
                <LangBadge lang={c.language} />
                <span className="flex min-w-0 items-center gap-2 font-semibold">
                  {c.direction === 'outbound' && (
                    <span title="Reminder call" className="text-ink-3">
                      <Icon d={ICONS.phone} size={14} />
                    </span>
                  )}
                  <span className="truncate">
                    {c.firstRequest ?? 'Dropped before anyone spoke'}
                  </span>
                  {c.source !== 'patient' && (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded border border-dashed border-line-strong px-1.5 text-xs">
                      <Icon d={ICONS.flask} size={12} />{' '}
                      {c.source === 'hawk' ? 'Hawk' : 'Test call'}
                    </span>
                  )}
                </span>
                <OutcomeBadge call={c} />
                <span className="tnum text-sm text-ink-3 md:text-right">
                  {duration(c.durationSec)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
