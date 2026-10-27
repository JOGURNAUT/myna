'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Demo } from '@/lib/types';
import { latency } from '@/lib/format';
import { useVoiceCall, type VoiceReply } from '@/lib/voice';
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
  const [mode, setMode] = useState<'text' | 'voice'>('text');

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [messages]);

  const refreshSchedule = useCallback(async () => {
    const res = await fetch('/api/demo', { cache: 'no-store' }).catch(() => null);
    if (res?.ok) setDemo((await res.json()) as Demo);
  }, []);

  const voice = useVoiceCall({
    onGreeting: (reply: VoiceReply) => {
      setMessages([{ who: 'myna', text: reply.text, lang: reply.language }]);
    },
    onTurn: (caller, reply) => {
      setMessages((prev) => [
        ...prev,
        { who: 'caller', text: caller, lang: reply.language },
        { who: 'myna', text: reply.text, lang: reply.language },
      ]);
      if (reply.ended) setEnded({ handoffTo: reply.handoffTo });
      void refreshSchedule();
    },
    onLatency: (l) => {
      // What the caller felt: from the end of their sentence to the first sound of Myna's reply.
      const ms = l.felt_ms ?? l.total_ms;
      if (ms === null) return;
      setMessages((prev) => {
        const i = prev.findLastIndex((m) => m.who === 'myna');
        return prev.map((m, j) => (j === i ? { ...m, latencyMs: ms } : m));
      });
    },
  });

  const startVoice = () => {
    setMode('voice');
    setMessages([]);
    setEnded(null);
    setError(null);
    baseline.current = new Set(demo?.busy.map(key) ?? []);
    void voice.start();
  };

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
    void voice.stop();
    setMode('text');
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
            <span title="From the end of your sentence to the start of her reply">
              Last reply {last === undefined ? '—' : latency(last)}
            </span>
            <span>Average {avg === null ? '—' : latency(avg)}</span>
          </span>
        </div>

        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-[13px] font-semibold tracking-wider text-ink-3 uppercase">
            Live transcript
          </h3>
          <p className="text-xs text-ink-3">Language is detected every turn</p>
        </div>
        <div className="flex min-h-[420px] flex-1 flex-col gap-3 rounded-[20px] border border-line bg-surface p-4">
          {messages.length === 0 ? (
            <div className="m-auto flex max-w-md flex-col items-center gap-4 text-center">
              <p className="text-ink-2">
                She answers the phone for a small dental clinic. Speak or type in English, Hindi or
                Hinglish. Try booking a cleaning with Dr. Mehta.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  className={btnPrimary}
                  disabled={busy || voice.status === 'connecting'}
                  onClick={startVoice}
                >
                  <Icon d={ICONS.mic} size={18} />
                  {voice.status === 'connecting' ? 'Connecting…' : 'Talk with your voice'}
                </button>
                <button type="button" className={btnGhost} disabled={busy} onClick={restart}>
                  <Icon d={ICONS.phone} size={18} />
                  Type instead
                </button>
              </div>
              {voice.error && (
                <p role="alert" className="text-sm text-danger-ink">
                  {voice.error}
                </p>
              )}
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

        {mode === 'voice' && voice.status !== 'idle' && !ended && (
          <div
            role="status"
            className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3"
          >
            <span
              className={`h-3 w-3 rounded-full ${voice.status === 'live' ? 'live bg-accent' : 'bg-muted-ink'}`}
              aria-hidden="true"
            />
            <span className="flex-1 text-sm text-ink-2">
              {voice.status === 'connecting' && 'Connecting to Myna…'}
              {voice.status === 'live' &&
                (voice.speaker === 'myna'
                  ? 'Myna is speaking… (talk over her any time)'
                  : voice.speaker === 'you'
                    ? 'Listening…'
                    : 'Your turn. Just talk.')}
              {voice.status === 'ended' && 'The voice call has ended.'}
              {voice.status === 'error' && (voice.error ?? 'The voice call failed.')}
            </span>
            {(voice.status === 'live' || voice.status === 'connecting') && (
              <button type="button" className={btnGhost} onClick={() => void voice.stop()}>
                <Icon d={ICONS.phone} size={16} />
                Hang up
              </button>
            )}
          </div>
        )}

        {messages.length > 0 && !ended && mode === 'text' && (
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
