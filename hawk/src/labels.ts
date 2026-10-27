import { type AgreementPair, type JudgeModel, judgeTranscript } from './judge.js';

/**
 * Human labels live in the API (dashboard → call detail). This signs in as the clinic, reads the
 * calls a person labelled, and asks the judge the same question the person answered.
 */

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { message: string };
}

async function call<T>(url: string, token: string | null, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(20_000) });
  const body = (await res.json()) as Envelope<T>;
  if (!res.ok || !body.ok || body.data === undefined)
    throw new Error(`${url} → ${res.status}: ${body.error?.message ?? 'failed'}`);
  return body.data;
}

const addDays = (d: string, n: number): string => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

interface Summary {
  id: string;
  language: string | null;
  label: { correct: boolean } | null;
}
interface Detail {
  events: { type: string; speaker?: 'agent' | 'caller'; text?: string }[];
}

export async function judgeHumanLabelled(opts: {
  apiUrl: string;
  clinicId: string;
  password: string;
  judge: JudgeModel;
  log?: (line: string) => void;
}): Promise<AgreementPair[]> {
  const log = opts.log ?? (() => undefined);
  const login = await call<{ token: string }>(`${opts.apiUrl}/v1/staff/login`, null, {
    method: 'POST',
    body: JSON.stringify({ clinicId: opts.clinicId, password: opts.password }),
  });
  const me = await call<{ today: string }>(`${opts.apiUrl}/v1/staff/me`, login.token);
  const { calls } = await call<{ calls: Summary[] }>(
    `${opts.apiUrl}/v1/staff/calls?from=${addDays(me.today, -30)}&to=${me.today}`,
    login.token,
  );
  const labelled = calls.filter((c) => c.label !== null);
  log(`${labelled.length} human-labelled calls in the last 31 days`);
  const pairs: AgreementPair[] = [];
  for (const c of labelled) {
    const detail = await call<Detail>(`${opts.apiUrl}/v1/staff/calls/${c.id}`, login.token);
    const turns = detail.events.flatMap((e) =>
      e.type === 'turn' && e.speaker && e.text ? [{ speaker: e.speaker, text: e.text }] : [],
    );
    const scores = await judgeTranscript(opts.judge, turns, c.language ?? 'unknown');
    if (!scores || !c.label) {
      log(`  ${c.id}: judge could not score this call, skipped`);
      continue;
    }
    pairs.push({ callId: c.id, human: c.label.correct, judge: scores.overallOk });
    log(
      `  ${c.id}: human ${c.label.correct ? 'correct' : 'wrong'} · judge ${scores.overallOk ? 'ok' : 'flagged'}`,
    );
  }
  return pairs;
}
