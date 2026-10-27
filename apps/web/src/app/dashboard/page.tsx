import Link from 'next/link';
import {
  Badge,
  Card,
  Empty,
  Icon,
  ICONS,
  LangBadge,
  SectionTitle,
  btnGhost,
  btnPrimary,
} from '@/components/ui';
import { staffApi } from '@/lib/api';
import { CATEGORY_LABEL, duration, HANDOFF_LABEL, when } from '@/lib/format';
import type { CallSummary, Metric, PendingBooking, Task } from '@/lib/types';
import { OutcomeBadge } from '@/components/outcome-badge';
import { approveBooking, markHandoffSeen, markTaskDone, rejectBooking } from './actions';

export const metadata = { title: 'Today' };

type Filter = 'all' | 'handed' | 'missed' | 'test';
const FILTERS: [Filter, string][] = [
  ['all', 'All'],
  ['handed', 'Handed to staff'],
  ['missed', 'Missed'],
  ['test', 'Test calls'],
];

const URGENCY = {
  urgent: { tone: 'danger', label: 'Urgent' },
  today: { tone: 'warn', label: 'Today' },
  routine: { tone: 'muted', label: 'Routine' },
} as const;

function metricValue(m: Metric): string {
  if (m.value === null) return '—';
  return m.unit === '%' ? `${m.value}%` : m.unit === 'hours' ? `${m.value} h` : String(m.value);
}

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  const { show } = await searchParams;
  const filter: Filter = FILTERS.some(([k]) => k === show) ? (show as Filter) : 'all';

  const [handoffs, tasks, pending, m, calls] = await Promise.all([
    staffApi<{ handoffs: CallSummary[] }>('/handoffs'),
    staffApi<{ tasks: Task[] }>('/tasks?status=open'),
    staffApi<{ pending: PendingBooking[] }>('/pending'),
    staffApi<{ metrics: Metric[]; reminders: Record<string, number> }>('/metrics'),
    staffApi<{ calls: CallSummary[] }>('/calls'),
  ]);

  const needs = handoffs.handoffs.length + tasks.tasks.length + pending.pending.length;
  const counts: Record<Filter, number> = {
    all: calls.calls.length,
    handed: calls.calls.filter((c) => c.handoffReason).length,
    missed: calls.calls.filter((c) => c.firstRequest === null && c.outcome).length,
    test: calls.calls.filter((c) => c.source !== 'patient').length,
  };
  const shown = calls.calls.filter(
    (c) =>
      filter === 'all' ||
      (filter === 'handed' && c.handoffReason) ||
      (filter === 'missed' && c.firstRequest === null && c.outcome) ||
      (filter === 'test' && c.source !== 'patient'),
  );
  const reminderTotal = Object.values(m.reminders).reduce((a, b) => a + b, 0);

  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight">
        {needs === 0
          ? 'Nothing needs you right now'
          : needs === 1
            ? '1 thing needs you'
            : `${needs} things need you`}
      </h1>

      {handoffs.handoffs.length > 0 && (
        <section aria-labelledby="ha" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 id="ha" className="text-xl font-bold">
              Handoff alerts
            </h2>
            <span className="tnum inline-flex h-[26px] min-w-[26px] items-center justify-center rounded-full bg-danger-ink px-2 text-[13px] font-bold text-bg">
              {handoffs.handoffs.length}
            </span>
            <span className="text-[13px] text-ink-3">Calls Myna passed to a person mid-call</span>
          </div>
          {handoffs.handoffs.map((c) => {
            const emergency = c.handoffReason === 'emergency';
            return (
              <article
                key={c.id}
                className="flex flex-wrap items-center gap-4 rounded-[20px] border border-line bg-surface p-5"
              >
                <span
                  className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${emergency ? 'bg-danger-soft text-danger-ink' : 'bg-warn-soft text-warn-ink'}`}
                >
                  <Icon d={emergency ? ICONS.warn : ICONS.person} size={24} />
                </span>
                <div className="flex min-w-[260px] flex-1 flex-col gap-1">
                  <div className="tnum flex flex-wrap items-center gap-2 text-xs text-ink-3">
                    <Badge tone={emergency ? 'danger' : 'warn'}>
                      {HANDOFF_LABEL[c.handoffReason ?? ''] ?? c.handoffReason}
                    </Badge>
                    <LangBadge lang={c.language} />
                    <span>
                      {c.startedAt.slice(11)} · {duration(c.durationSec)}
                    </span>
                  </div>
                  <p className="text-lg font-bold">{c.firstRequest ?? 'The caller said nothing'}</p>
                  <Link
                    href={`/dashboard/calls/${c.id}`}
                    className="w-fit text-sm font-semibold text-primary-ink"
                  >
                    Open the call
                  </Link>
                </div>
                <span className="font-mono text-sm">{c.callerPhoneMasked ?? 'withheld'}</span>
                <form action={markHandoffSeen}>
                  <input type="hidden" name="id" value={c.id} />
                  <button type="submit" className={btnPrimary}>
                    <Icon d={ICONS.check} size={18} /> Mark seen
                  </button>
                </form>
              </article>
            );
          })}
        </section>
      )}

      <div className="grid gap-8 lg:grid-cols-[7fr_5fr]">
        <section aria-labelledby="tq" className="flex flex-col gap-3">
          <SectionTitle count={tasks.tasks.length}>
            <span id="tq">Call back</span>
          </SectionTitle>
          <p className="text-[13px] text-ink-3">Soonest deadline first.</p>
          {tasks.tasks.length === 0 ? (
            <Empty title="All caught up">
              When Myna takes a message that needs a person, it lands here with a call-back time.
            </Empty>
          ) : (
            tasks.tasks.map((t) => (
              <article
                key={t.id}
                className="flex flex-wrap items-center gap-4 rounded-[20px] border border-line bg-surface p-5"
              >
                <div className="flex min-w-[240px] flex-1 flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-md bg-sunken px-2 py-0.5 text-xs font-semibold text-ink-2">
                      {CATEGORY_LABEL[t.category] ?? t.category}
                    </span>
                    <Badge tone={URGENCY[t.urgency].tone} icon={<Icon d={ICONS.clock} size={14} />}>
                      {URGENCY[t.urgency].label} · by {when(t.callbackBy)}
                    </Badge>
                    {!t.verified && (
                      <Badge tone="muted" icon={<Icon d={ICONS.info} size={14} />}>
                        Not verified
                      </Badge>
                    )}
                  </div>
                  <p className="text-lg font-bold">
                    {t.patientName ?? t.callerName ?? 'Unknown caller'}
                  </p>
                  <p className="text-ink-2">{t.summary}</p>
                  <Link
                    href={`/dashboard/calls/${t.callId}`}
                    className="w-fit text-sm font-semibold text-primary-ink"
                  >
                    Transcript
                  </Link>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className="font-mono text-sm">{t.callbackNumberMasked}</span>
                  <form action={markTaskDone}>
                    <input type="hidden" name="id" value={t.id} />
                    <button type="submit" className={btnPrimary}>
                      <Icon d={ICONS.check} size={18} /> Mark done
                    </button>
                  </form>
                </div>
              </article>
            ))
          )}
        </section>

        <section aria-labelledby="pc" className="flex flex-col gap-3">
          <SectionTitle count={pending.pending.length}>
            <span id="pc">Confirm bookings</span>
          </SectionTitle>
          <p className="text-[13px] text-ink-3">
            Made after hours. Rejecting creates a call-back task so someone offers other times.
          </p>
          {pending.pending.length === 0 ? (
            <Empty title="Nothing to confirm">
              Bookings Myna takes after hours wait here until someone approves them.
            </Empty>
          ) : (
            pending.pending.map((p) => (
              <article
                key={p.id}
                className="flex flex-col gap-3 rounded-[20px] border border-line bg-surface p-5"
              >
                <Badge tone="accent" icon={<Icon d={ICONS.moon} size={14} />}>
                  After-hours booking
                </Badge>
                <div>
                  <p className="text-lg font-bold">{p.patientName}</p>
                  <p className="tnum font-semibold">{when(p.start)}</p>
                  <p className="text-sm text-ink-3">
                    {p.serviceName} · {p.resourceName}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <form action={rejectBooking}>
                    <input type="hidden" name="id" value={p.id} />
                    <button type="submit" className={`${btnGhost} h-[52px] w-full text-danger-ink`}>
                      <Icon d={ICONS.x} size={18} /> Reject
                    </button>
                  </form>
                  <form action={approveBooking}>
                    <input type="hidden" name="id" value={p.id} />
                    <button type="submit" className={`${btnPrimary} h-[52px] w-full`}>
                      <Icon d={ICONS.check} size={18} /> Approve
                    </button>
                  </form>
                </div>
              </article>
            ))
          )}
        </section>
      </div>

      <section aria-labelledby="mt" className="flex flex-col gap-3">
        <h2 id="mt" className="text-[13px] font-semibold tracking-wider text-ink-3 uppercase">
          How Myna is doing · last 7 days
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
          {m.metrics.map((x) => (
            <Card key={x.id} className="flex flex-col gap-1.5">
              <p className="text-[13px] font-semibold text-ink-2">{x.label}</p>
              <p className="tnum text-4xl font-bold tracking-tight">{metricValue(x)}</p>
              <details>
                <summary className="flex min-h-8 w-fit cursor-pointer items-center gap-1.5 text-[13px] text-ink-3">
                  <Icon d={ICONS.info} size={15} /> How is this calculated?
                </summary>
                <p className="mt-1 rounded-lg bg-sunken p-2.5 text-[13px] leading-relaxed text-ink-2">
                  {x.formula}
                </p>
              </details>
            </Card>
          ))}
        </div>
        <Card className="flex flex-col gap-1">
          <p className="text-[13px] font-semibold text-ink-2">Reminder calls · outcomes</p>
          {reminderTotal === 0 ? (
            <p className="text-ink-2">
              No reminder calls yet. Outbound reminders are off until the clinic turns them on.
            </p>
          ) : (
            <p className="tnum flex flex-wrap gap-x-5 gap-y-1 text-ink-2">
              {Object.entries(m.reminders).map(([k, v]) => (
                <span key={k}>
                  <b className="text-ink">{v}</b> {k.replaceAll('_', ' ')}
                </span>
              ))}
            </p>
          )}
        </Card>
      </section>

      <section aria-labelledby="tc" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="tc" className="mr-auto text-xl font-bold">
            Today’s calls
          </h2>
          <div role="group" aria-label="Filter calls" className="flex flex-wrap gap-1.5">
            {FILTERS.map(([k, label]) => (
              <Link
                key={k}
                href={k === 'all' ? '/dashboard' : `/dashboard?show=${k}`}
                aria-current={filter === k ? 'true' : undefined}
                className={`tnum inline-flex h-10 items-center rounded-full border px-3.5 text-sm font-semibold ${
                  filter === k
                    ? 'border-primary bg-primary-soft text-primary-ink'
                    : 'border-line-strong bg-surface text-ink-2'
                }`}
              >
                {label} · {counts[k]}
              </Link>
            ))}
          </div>
        </div>
        {shown.length === 0 ? (
          <Empty title="No calls here yet">Calls appear as they happen.</Empty>
        ) : (
          <>
            <ul className="flex flex-col gap-3 md:hidden">
              {shown.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/dashboard/calls/${c.id}`}
                    className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-4"
                  >
                    <span className="tnum flex flex-wrap items-center gap-2 text-sm text-ink-3">
                      <b className="text-ink">{c.startedAt.slice(11)}</b>
                      <LangBadge lang={c.language} />
                      <span>{duration(c.durationSec)}</span>
                      {c.source !== 'patient' && (
                        <span className="inline-flex items-center gap-1 rounded border border-dashed border-line-strong px-1.5 text-xs font-semibold text-ink">
                          <Icon d={ICONS.flask} size={12} />{' '}
                          {c.source === 'hawk' ? 'Hawk' : 'Test call'}
                        </span>
                      )}
                    </span>
                    <span className="font-semibold">
                      {c.firstRequest ?? 'Dropped before anyone spoke'}
                    </span>
                    <span className="flex flex-wrap items-center gap-2">
                      <OutcomeBadge call={c} />
                      <span className="font-mono text-xs text-ink-3">
                        {c.callerPhoneMasked ?? ''}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto rounded-[20px] border border-line bg-surface md:block">
              <table className="tnum w-full min-w-[820px] border-collapse text-left">
                <thead>
                  <tr className="bg-sunken text-xs font-semibold tracking-wider text-ink-3 uppercase">
                    {['Time', 'Caller', 'Language', 'Request', 'Outcome', 'Length', 'Review'].map(
                      (h) => (
                        <th key={h} scope="col" className="px-4 py-3">
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((c) => (
                    <tr key={c.id} className="border-t border-line">
                      <td className="px-4 py-3 font-semibold whitespace-nowrap">
                        {c.startedAt.slice(11)}
                      </td>
                      <td className="px-4 py-3 font-mono text-[13px] text-ink-2">
                        {c.callerPhoneMasked ?? '—'}
                      </td>
                      <td className="px-4 py-3">
                        <LangBadge lang={c.language} />
                      </td>
                      <td className="max-w-[320px] px-4 py-3">
                        <Link
                          href={`/dashboard/calls/${c.id}`}
                          className="font-medium text-ink hover:underline"
                        >
                          {c.firstRequest ?? 'Dropped before anyone spoke'}
                        </Link>
                        {c.source !== 'patient' && (
                          <span className="ml-2 inline-flex items-center gap-1 rounded border border-dashed border-line-strong px-1.5 text-xs font-semibold">
                            <Icon d={ICONS.flask} size={12} />{' '}
                            {c.source === 'hawk' ? 'Hawk' : 'Test call'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <OutcomeBadge call={c} />
                      </td>
                      <td className="px-4 py-3 text-ink-2">{duration(c.durationSec)}</td>
                      <td className="px-4 py-3 text-sm">
                        {c.label ? (
                          c.label.correct ? (
                            <span className="font-semibold text-safe-ink">Correct</span>
                          ) : (
                            <span className="font-semibold text-danger-ink">Wrong</span>
                          )
                        ) : (
                          <span className="text-ink-3">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </>
  );
}
