'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Demo } from '@/lib/types';
import { latency } from '@/lib/format';
import { Schedule } from './schedule';
import { btnGhost, btnPrimary, Icon, ICONS, LangBadge } from './ui';

interface Message {
  who: 'myna' | 'caller';
  text: string;
  lang?: string;
  latencyMs?: number;
}
interface ChatResponse {
  callId: string;
  latencyMs: number;
  reply: {
    text: string;
    language: string;
    ended: boolean;
    handoffTo: string | null;
    state: string;
  };
}

const SUGGESTIONS = [
  'Mujhe cleaning ka appointment chahiye kal subah',
  'I need a consultation with Dr. Rao on Wednesday',
  'मुझे अपना अपॉइंटमेंट बदलना है',
  'What are your timings?',
];

const key = (b: Demo['busy'][number]) => `${b.resourceId}|${b.start}`;

export function Talk({ initialDemo }: { initialDemo: Demo | null }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [callId, setCallId] = useState<string | null>(null);
  const [ended, setEnded] = useState<{ handoffTo: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [demo, setDemo] = useState<Demo | null>(initialDemo);
  const baseline = useRef(new Set(initialDemo?.busy.map(key) ?? []));
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [messages]);

  const refreshSchedule = useCallback(async () => {
    const res = await fetch('/api/demo', { cache: 'no-store' }).catch(() => null);
    if (res?.ok) setDemo((await res.json()) as Demo);
  }, []);

  const post = useCallback(
    async (text: string | null) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(text === null ? {} : { callId, text }),
        });
        const body = (await res.json()) as ChatResponse | { error: string };
        if (!res.ok || 'error' in body) {
          setError('error' in body ? body.error : 'Something went wrong.');
          if (res.status === 410) setEnded({ handoffTo: null });
          return;
        }
        setCallId(body.callId);
        setMessages((prev) => {
          // The reply's language is the caller's language for the turn that just happened.
          const withLang = prev.map((m, i) =>
            i === prev.length - 1 && m.who === 'caller' ? { ...m, lang: body.reply.language } : m,
          );
          return [
            ...withLang,
            {
              who: 'myna',
              text: body.reply.text,
              lang: body.reply.language,
              latencyMs: body.latencyMs,
            },
          ];
        });
        if (body.reply.ended) setEnded({ handoffTo: body.reply.handoffTo });
        void refreshSchedule();
      } catch {
        setError('Could not reach Myna. Check your connection and try again.');
      } finally {
        setBusy(false);
      }
    },
    [callId, refreshSchedule],
  );

  const send = (text: string) => {
    const clean = text.trim();
    if (!clean || busy || ended) return;
    setMessages((prev) => [...prev, { who: 'caller', text: clean }]);
    setDraft('');
    void post(clean);
  };

  const restart = () => {
    setMessages([]);
    setCallId(null);
    setEnded(null);
    setError(null);
    baseline.current = new Set(demo?.busy.map(key) ?? []);
    void post(null);
  };

  const latencies = messages.flatMap((m) => (m.latencyMs !== undefined ? [m.latencyMs] : []));
  const last = latencies.at(-1);
  const avg = latencies.length
    ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
    : null;
  const fresh = useMemo(
    () => new Set((demo?.busy ?? []).map(key).filter((k) => !baseline.current.has(k))),
    [demo],
  );

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-2">
      <section aria-label="Conversation with Myna" className="flex min-w-0 flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-bold">Talk to Myna</h2>
          <span className="tnum flex items-center gap-4 text-[13px] text-ink-3" aria-live="off">
            <span>Last reply {last === undefined ? '—' : latency(last)}</span>
            <span>Average {avg === null ? '—' : latency(avg)}</span>
          </span>
        </div>

        <div className="flex min-h-[420px] flex-col gap-3 rounded-[20px] border border-line bg-surface p-4">
          {messages.length === 0 ? (
            <div className="m-auto flex max-w-md flex-col items-center gap-4 text-center">
              <p className="text-ink-2">
                She answers the phone for a small dental clinic. Type in English, Hindi or Hinglish
                (voice arrives soon). Try booking a cleaning with Dr. Mehta.
              </p>
              <button type="button" className={btnPrimary} disabled={busy} onClick={restart}>
                <Icon d={ICONS.phone} size={18} />
                Start the call
              </button>
            </div>
          ) : (
            <ol className="flex flex-col gap-3" aria-live="polite">
              {messages.map((m, i) => (
                <li
                  key={i}
                  className={`flex flex-col gap-1 ${m.who === 'caller' ? 'items-end' : 'items-start'}`}
                >
                  <div
                    className={`max-w-[88%] rounded-2xl px-4 py-2.5 ${
                      m.who === 'myna' ? 'bg-primary text-on-primary' : 'bg-sunken text-ink'
                    }`}
                    lang={m.lang === 'hi' ? 'hi' : undefined}
                  >
                    {m.text}
                  </div>
                  <div className="tnum flex items-center gap-2 text-xs text-ink-3">
                    <span className="font-semibold">{m.who === 'myna' ? 'Myna' : 'You'}</span>
                    <LangBadge lang={m.lang} />
                    {m.latencyMs !== undefined && <span>{latency(m.latencyMs)}</span>}
                  </div>
                </li>
              ))}
              {busy && (
                <li className="flex items-center gap-2 text-sm text-ink-3">
                  <span className="live h-2 w-2 rounded-full bg-accent" aria-hidden="true" />
                  Myna is replying…
                </li>
              )}
              <div ref={bottom} />
            </ol>
          )}
        </div>

        {ended && (
          <div
            role="status"
            className="flex items-start gap-3 rounded-2xl bg-warn-soft p-4 text-warn-ink"
          >
            <Icon d={ended.handoffTo ? ICONS.person : ICONS.check} size={20} />
            <div className="flex-1">
              <p className="font-semibold">
                {ended.handoffTo
                  ? 'Myna passed this call to the clinic staff.'
                  : 'The call has ended.'}
              </p>
              {ended.handoffTo && (
                <p className="text-sm text-ink">
                  On a real call she would now transfer you to the front desk.
                </p>
              )}
            </div>
            <button type="button" className={btnGhost} onClick={restart}>
              <Icon d={ICONS.refresh} size={16} />
              Again
            </button>
          </div>
        )}
        {error && (
          <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-danger-ink">
            {error}
          </p>
        )}

        {messages.length > 0 && !ended && (
          <>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                send(draft);
              }}
            >
              <label htmlFor="say" className="sr-only">
                Say something to Myna
              </label>
              <input
                id="say"
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                }}
                maxLength={500}
                autoComplete="off"
                placeholder="Type your reply…"
                className="h-12 min-w-0 flex-1 rounded-xl border border-line-strong bg-surface px-4"
                disabled={busy}
              />
              <button type="submit" className={btnPrimary} disabled={busy || !draft.trim()}>
                <Icon d={ICONS.send} size={18} />
                Send
              </button>
            </form>
            {messages.length < 3 && (
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      send(s);
                    }}
                    disabled={busy}
                    className="min-h-11 rounded-full border border-line-strong bg-surface px-3.5 text-sm text-ink-2 hover:bg-sunken"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      <section aria-label="The clinic's schedule" className="flex min-w-0 flex-col gap-4">
        {demo ? (
          <Schedule demo={demo} fresh={fresh} />
        ) : (
          <p className="rounded-xl bg-muted-soft p-4 text-muted-ink">
            The schedule isn’t available right now.
          </p>
        )}
        {fresh.size > 0 && (
          <p
            role="status"
            className="flex items-center gap-2 rounded-xl bg-safe-soft px-4 py-3 text-safe-ink"
          >
            <Icon d={ICONS.check} size={18} />
            <span>
              <b>Booked.</b> Your appointment now shows on the schedule.
            </span>
          </p>
        )}
      </section>
    </div>
  );
}
