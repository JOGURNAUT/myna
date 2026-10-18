import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge, Card, Icon, ICONS, LangBadge } from '@/components/ui';
import { ApiError, staffApi } from '@/lib/api';
import { duration, HANDOFF_LABEL, latency, OUTCOME_LABEL } from '@/lib/format';
import type { CallDetail, CallEvent } from '@/lib/types';
import { LabelForm } from './label-form';

export const metadata = { title: 'Call' };
const TARGET_MS = 1500;

type Turn = Extract<CallEvent, { type: 'turn' }>;

/** Response time = from the caller finishing to Myna's reply landing, from the call log's own clock. */
function responseTimes(events: CallEvent[]): Map<number, number> {
  const out = new Map<number, number>();
  events.forEach((e, i) => {
    const prev = events[i - 1];
    if (
      e.type === 'turn' &&
      e.speaker === 'agent' &&
      prev?.type === 'turn' &&
      prev.speaker === 'caller'
    ) {
      out.set(i, new Date(e.at).getTime() - new Date(prev.at).getTime());
    }
  });
  return out;
}

export default async function CallPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const call = await staffApi<CallDetail>(`/calls/${id}`).catch((e: unknown) => {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  });
  const times = responseTimes(call.events);
  const turns = call.events.filter((e): e is Turn => e.type === 'turn');
  const tools = call.events.filter(
    (e): e is Extract<CallEvent, { type: 'tool_call' }> => e.type === 'tool_call',
  );
  const language = [...turns].reverse().find((t) => t.speaker === 'caller')?.language;
  const slow = [...times.values()].filter((ms) => ms > TARGET_MS).length;
  const failedTools = tools.filter((t) => !t.ok);

  return (
    <>
      <div className="flex flex-col gap-3">
        <Link
          href="/dashboard"
          className="flex min-h-11 w-fit items-center gap-1 text-sm font-semibold text-primary-ink"
        >
          <Icon d="M15 6l-6 6 6 6" size={16} /> Today’s calls
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight">
            {call.direction === 'outbound' ? 'Reminder call' : 'Call'} ·{' '}
            {call.startedAt.replace('T', ' · ')}
          </h1>
          {call.source !== 'patient' && (
            <Badge tone="muted" icon={<Icon d={ICONS.flask} size={14} />}>
              {call.source === 'hawk' ? 'Hawk simulation' : 'Your test call'}
            </Badge>
          )}
        </div>
        <div className="tnum flex flex-wrap items-center gap-3 text-ink-2">
          {call.handoffReason ? (
            <Badge tone="warn" icon={<Icon d={ICONS.person} size={14} />}>
              {HANDOFF_LABEL[call.handoffReason] ?? 'Handed to staff'}
            </Badge>
          ) : call.outcome ? (
            <Badge tone="safe" icon={<Icon d={ICONS.check} size={14} />}>
              {call.outcome
                .split(',')
                .map((o) => OUTCOME_LABEL[o] ?? o.replaceAll('_', ' '))
                .join(', ')}
            </Badge>
          ) : (
            <Badge tone="accent">In progress</Badge>
          )}
          <span>
            {call.endedAt
              ? duration(
                  Math.round(
                    (Date.parse(call.endedAt + 'Z') - Date.parse(call.startedAt + 'Z')) / 1000,
                  ),
                )
              : ''}
          </span>
          <span className="font-mono text-sm">{call.callerPhoneMasked ?? 'number withheld'}</span>
          <LangBadge lang={language} />
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section aria-labelledby="tr" className="flex flex-col gap-3">
          <h2 id="tr" className="text-xl font-bold">
            Transcript
          </h2>
          <p className="text-[13px] text-ink-3">Teal is Myna; grey is the caller.</p>
          <ol className="flex flex-col gap-3 rounded-[20px] border border-line bg-surface p-4">
            {call.events.map((e, i) => {
              if (e.type === 'turn') {
                const ms = times.get(i);
                return (
                  <li
                    key={i}
                    className={`flex flex-col gap-1 ${e.speaker === 'caller' ? 'items-end' : 'items-start'}`}
                  >
                    <div
                      lang={e.language === 'hi' ? 'hi' : undefined}
                      className={`max-w-[90%] rounded-2xl px-4 py-2.5 ${e.speaker === 'agent' ? 'bg-primary text-on-primary' : 'bg-sunken'}`}
                    >
                      {e.text}
                    </div>
                    <div className="tnum flex items-center gap-2 text-xs text-ink-3">
                      <span className="font-semibold">
                        {e.speaker === 'agent' ? 'Myna' : 'Caller'}
                      </span>
                      <LangBadge lang={e.language} />
                      {ms !== undefined && (
                        <span className={ms > TARGET_MS ? 'font-semibold text-warn-ink' : ''}>
                          {latency(ms)}
                          {ms > TARGET_MS ? ' · slow' : ''}
                        </span>
                      )}
                    </div>
                  </li>
                );
              }
              if (e.type === 'handoff') {
                return (
                  <li
                    key={i}
                    className="flex items-center gap-2 rounded-xl bg-warn-soft px-3 py-2 text-sm font-semibold text-warn-ink"
                  >
                    <Icon d={ICONS.person} size={16} /> Handed to staff:{' '}
                    {HANDOFF_LABEL[e.reason] ?? e.reason}
                  </li>
                );
              }
              if (e.type === 'end') {
                return (
                  <li
                    key={i}
                    className="border-t border-dashed border-line-strong pt-3 text-center text-sm text-ink-3"
                  >
                    Call ended
                  </li>
                );
              }
              return null;
            })}
          </ol>
        </section>

        <div className="flex flex-col gap-8">
          <section aria-labelledby="rv" className="flex flex-col gap-3">
            <h2 id="rv" className="text-xl font-bold">
              Manual review
            </h2>
            <p className="text-[13px] text-ink-3">
              Your label is the ground truth Hawk’s judge is checked against.
            </p>
            <LabelForm callId={call.id} saved={call.label} />
          </section>

          <section aria-labelledby="tc" className="flex flex-col gap-3">
            <h2 id="tc" className="text-xl font-bold">
              Tool calls
            </h2>
            {tools.length === 0 ? (
              <p className="text-ink-2">Myna didn’t touch the schedule on this call.</p>
            ) : (
              <Card className="p-0">
                <ul className="divide-y divide-line">
                  {tools.map((t, i) => (
                    <li key={i} className="flex items-center gap-3 px-4 py-3">
                      <span className={t.ok ? 'text-safe-ink' : 'text-danger-ink'}>
                        <Icon d={t.ok ? ICONS.check : ICONS.x} size={16} />
                        <span className="sr-only">{t.ok ? 'ok' : 'failed'}</span>
                      </span>
                      <code className="font-mono text-[13px]">{t.tool}</code>
                      {t.errorCode && (
                        <span className="text-xs text-danger-ink">{t.errorCode}</span>
                      )}
                      <span className="tnum ml-auto font-mono text-[13px] text-ink-3">
                        {t.latencyMs} ms
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            <p className="text-sm text-ink-2">
              {tools.length} tool call{tools.length === 1 ? '' : 's'}
              {failedTools.length > 0 ? `, ${failedTools.length} failed` : ''}.{' '}
              {times.size > 0
                ? slow === 0
                  ? `Every reply was under ${TARGET_MS / 1000} s.`
                  : `${slow} of ${times.size} replies were over ${TARGET_MS / 1000} s.`
                : ''}
            </p>
          </section>
        </div>
      </div>
    </>
  );
}
