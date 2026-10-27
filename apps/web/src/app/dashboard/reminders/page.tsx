import Link from 'next/link';
import { Badge, Card, Empty, Icon, ICONS, LangBadge } from '@/components/ui';
import { OutcomeBadge } from '@/components/outcome-badge';
import { staffApi } from '@/lib/api';
import { duration } from '@/lib/format';
import type { CallSummary, Me, Setup } from '@/lib/types';

export const metadata = { title: 'Reminders' };

const addDays = (d: string, n: number) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

export default async function RemindersPage() {
  const me = await staffApi<Me>('/me');
  const [setup, { calls }] = await Promise.all([
    staffApi<Setup>('/setup'),
    staffApi<{ calls: CallSummary[] }>(`/calls?from=${addDays(me.today, -6)}&to=${me.today}`),
  ]);
  const r = setup.outboundReminders;
  const mine = calls.filter((c) => c.direction === 'outbound');
  return (
    <section aria-labelledby="rm" className="flex flex-col gap-6">
      <h1 id="rm" className="text-2xl font-bold">
        Reminder calls
      </h1>

      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {r.enabled ? (
            <Badge tone="safe" icon={<Icon d={ICONS.check} size={14} />}>
              Reminder calls are on
            </Badge>
          ) : (
            <Badge tone="muted">Reminder calls are off</Badge>
          )}
          <span className="text-ink-2">
            {r.enabled
              ? `Myna calls patients ${r.daysBefore} day before, between ${r.callWindow.start} and ${r.callWindow.end}, up to ${r.maxAttempts} tries ${r.retryGapMin} minutes apart.`
              : 'Myna only starts calling after the clinic owner turns this on. Nothing is dialled until then.'}
          </span>
        </div>
        <p className="text-sm text-ink-3">
          The opening line says it is an automated assistant. Details are shared only after the
          right person is confirmed; a family member is asked to have the patient call back. A
          request not to be called is honoured at once and for good.
        </p>
      </Card>

      <div className="flex flex-col gap-3">
        <h2 className="text-xl font-bold">Last 7 days</h2>
        {mine.length === 0 ? (
          <Empty title="No reminder calls yet">
            {r.enabled
              ? 'The next batch goes out for the following day’s patients.'
              : 'Turn reminders on in the clinic configuration to start.'}
          </Empty>
        ) : (
          <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
            {mine.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/dashboard/calls/${c.id}`}
                  className="flex flex-wrap items-center gap-3 p-4 hover:bg-sunken"
                >
                  <span className="tnum w-40 text-sm text-ink-3">
                    {c.startedAt.replace('T', ' · ')}
                  </span>
                  <LangBadge lang={c.language} />
                  <span className="mr-auto font-mono text-sm text-ink-3">
                    {c.callerPhoneMasked ?? ''}
                  </span>
                  <OutcomeBadge call={c} />
                  <span className="tnum text-sm text-ink-3">{duration(c.durationSec)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
