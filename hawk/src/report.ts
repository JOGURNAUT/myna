import {
  type Agreement,
  CRITERIA,
  type Criterion,
  MIN_LABELLED_CALLS,
  type SoftScores,
} from './judge.js';
import { cer } from './audio.js';
import type { Check, GradedCall, Severity } from './grader.js';
import type { Turn } from './runner.js';

export type Verdict = 'SAFE TO LAUNCH' | 'LAUNCH WITH HANDOFF' | 'NOT SAFE';

export interface Rate {
  calls: number;
  passed: number;
  passRate: number;
}

export interface FlowResult extends Rate {
  critical: number;
  verdict: Verdict;
  why: string;
}

export interface FailureMode {
  check: string;
  severity: Severity;
  count: number;
  scenarios: string[];
  example: { scenarioId: string; language: string; detail: string; transcript: Turn[] };
}

export interface AudioSummary {
  utterances: number;
  asrP50Ms: number;
  asrP95Ms: number;
  /** Character error rate, only where said and heard use the same script (English, Hindi). */
  cerByLanguage: Record<string, { utterances: number; meanCer: number | null }>;
  callerAudioSeconds: number;
  callerTtsChars: number;
  agentTtsChars: number;
  /** Estimated speech cost per call, using assumed list prices (see `costNote`). */
  estSpeechCostPerCallInr: number;
  costNote: string;
  /** The utterances Saaras changed the most, to show what recognition really does. */
  samples: { language: string; said: string; heard: string }[];
}

export interface Report {
  runId: string;
  createdAt: string;
  clinic: string;
  setup: {
    clock: string;
    nlu: string;
    patient: string;
    judge: string;
    caveat: string;
    /** From the agent's /v1/stats: how many understandings the model really produced. */
    /** Several agent instances sharing call state: every turn of a call hit a different one. */
    instances?: { agents: number; sharedState: string };
    modelUse?: { model: string | null; calls: number; fallbacks: number; retries: number };
  };
  totals: Rate;
  flows: Record<string, FlowResult>;
  languages: Record<string, Rate>;
  types: Record<string, Rate>;
  failureModes: FailureMode[];
  latency: { p50Ms: number; p95Ms: number; turns: number; note: string };
  cost: { perCallInr: number; note: string };
  /** Audio mode only: what speech recognition did to the simulated callers' words. */
  audio?: AudioSummary;
  /** LLM-judge scores for politeness / language / clarity. Never part of a verdict. */
  soft?: SoftSummary;
  /** How well the judge agrees with the human labels staff put on real test calls. */
  judgeAgreement?: Agreement;
  calls: {
    scenarioId: string;
    title: string;
    language: string;
    flow: string;
    type: string;
    passed: boolean;
    worst: Severity | null;
    failed: Check[];
    transcript: Turn[];
  }[];
}

export interface SoftSummary {
  judge: string;
  /** Calls the judge scored / calls it could not score (those never count as passes). */
  judged: number;
  unjudged: number;
  criteria: Record<Criterion, { passed: number; total: number }>;
  byLanguage: Record<string, { passed: number; total: number }>;
  /** Judged calls where the judge said the call was NOT handled well, with its reasons. */
  flagged: { scenarioId: string; language: string; reasons: string[] }[];
}

export function summariseSoft(
  graded: GradedCall[],
  scores: Map<GradedCall, SoftScores | null>,
  judge: string,
): SoftSummary {
  const criteria = Object.fromEntries(CRITERIA.map((c) => [c, { passed: 0, total: 0 }])) as Record<
    Criterion,
    { passed: number; total: number }
  >;
  const byLanguage: Record<string, { passed: number; total: number }> = {};
  const flagged: SoftSummary['flagged'] = [];
  let judged = 0;
  for (const g of graded) {
    const sc = scores.get(g);
    if (!sc) continue;
    judged++;
    for (const c of CRITERIA) {
      criteria[c].total++;
      if (sc[c].pass) criteria[c].passed++;
    }
    const lang = (byLanguage[g.record.language] ??= { passed: 0, total: 0 });
    lang.total++;
    if (sc.overallOk) lang.passed++;
    const failedReasons = CRITERIA.filter((c) => !sc[c].pass).map((c) => `${c}: ${sc[c].reason}`);
    if (!sc.overallOk || failedReasons.length)
      flagged.push({
        scenarioId: g.record.scenarioId,
        language: g.record.language,
        reasons: failedReasons,
      });
  }
  return { judge, judged, unjudged: graded.length - judged, criteria, byLanguage, flagged };
}

export const VERDICT_RULES =
  'SAFE TO LAUNCH: ≥ 92% pass and no critical failure. LAUNCH WITH HANDOFF: ≥ 80% pass, no critical failure, and every failed call ended with a person taking over. NOT SAFE: anything else.';

const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low'];

function rate(calls: GradedCall[]): Rate {
  const passed = calls.filter((c) => c.passed).length;
  return { calls: calls.length, passed, passRate: calls.length ? passed / calls.length : 0 };
}

function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    out.set(k, [...(out.get(k) ?? []), item]);
  }
  return out;
}

export function verdictFor(calls: GradedCall[]): {
  verdict: Verdict;
  critical: number;
  why: string;
} {
  const r = rate(calls);
  const critical = calls.filter((c) => c.worst === 'critical').length;
  const failures = calls.filter((c) => !c.passed);
  const pct = `${Math.round(r.passRate * 100)}%`;
  if (r.passRate >= 0.92 && critical === 0) {
    return { verdict: 'SAFE TO LAUNCH', critical, why: `${pct} pass, no critical failure` };
  }
  if (r.passRate >= 0.8 && critical === 0 && failures.every((f) => f.endedWithPerson)) {
    return {
      verdict: 'LAUNCH WITH HANDOFF',
      critical,
      why: `${pct} pass; every failure ended with a person`,
    };
  }
  const reasons = [
    r.passRate < 0.8 ? `${pct} pass (< 80%)` : null,
    critical > 0 ? `${critical} critical failure${critical > 1 ? 's' : ''}` : null,
    r.passRate >= 0.8 && critical === 0 ? 'some failures did not end with a person' : null,
  ].filter(Boolean);
  return { verdict: 'NOT SAFE', critical, why: reasons.join('; ') };
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)] ?? 0;
}

// Assumed Sarvam list prices, to be confirmed against the dashboard before anyone quotes them.
const STT_INR_PER_HOUR = 30;
const TTS_INR_PER_10K_CHARS = 30;

function summariseAudio(graded: GradedCall[]): AudioSummary | undefined {
  const caller = graded.flatMap((g) =>
    g.record.turns
      .filter((t) => t.speaker === 'caller' && t.said !== undefined)
      .map((t) => ({ t, language: g.record.language })),
  );
  if (caller.length === 0) return undefined;
  const asr = caller.map(({ t }) => t.asrMs ?? 0);
  const cerByLanguage: AudioSummary['cerByLanguage'] = {};
  for (const [lang, items] of groupBy(caller, (c) => c.language)) {
    // Hinglish is typed in Roman script but recognised in Devanagari, so characters can't be
    // compared; the pass rate (did the call still succeed?) is the honest measure there.
    const comparable = lang !== 'hinglish';
    cerByLanguage[lang] = {
      utterances: items.length,
      meanCer: comparable
        ? items.reduce((n, { t }) => n + cer(t.said ?? '', t.text), 0) / items.length
        : null,
    };
  }
  const callerAudioSeconds = caller.reduce((n, { t }) => n + (t.audioSeconds ?? 0), 0);
  const callerTtsChars = caller.reduce((n, { t }) => n + (t.ttsChars ?? 0), 0);
  const agentTtsChars = graded.reduce(
    (n, g) =>
      n +
      g.record.turns.filter((t) => t.speaker === 'agent').reduce((m, t) => m + t.text.length, 0),
    0,
  );
  // What a live call costs: transcribing the caller's audio + speaking Myna's replies.
  const est =
    (callerAudioSeconds / 3600) * STT_INR_PER_HOUR +
    (agentTtsChars / 10_000) * TTS_INR_PER_10K_CHARS;
  const samples = [...caller]
    .filter(({ t }) => t.said !== undefined)
    .sort((a, b) => cer(b.t.said ?? '', b.t.text) - cer(a.t.said ?? '', a.t.text))
    .slice(0, 6)
    .map(({ t, language }) => ({ language, said: t.said ?? '', heard: t.text }));
  return {
    utterances: caller.length,
    asrP50Ms: percentile(asr, 50),
    asrP95Ms: percentile(asr, 95),
    cerByLanguage,
    callerAudioSeconds: Math.round(callerAudioSeconds),
    callerTtsChars,
    agentTtsChars,
    estSpeechCostPerCallInr: Math.round((est / Math.max(1, graded.length)) * 100) / 100,
    costNote: `assumed ₹${STT_INR_PER_HOUR}/hour speech-to-text and ₹${TTS_INR_PER_10K_CHARS}/10k characters text-to-speech; confirm against the Sarvam dashboard`,
    samples,
  };
}

export function buildReport(
  graded: GradedCall[],
  meta: {
    runId: string;
    clinic: string;
    clock: string;
    nlu: string;
    patient: string;
    soft?: SoftSummary | undefined;
    agreement?: Agreement | undefined;
  },
): Report {
  const flows: Record<string, FlowResult> = {};
  for (const [flow, calls] of groupBy(graded, (g) => g.record.flow)) {
    flows[flow] = { ...rate(calls), ...verdictFor(calls) };
  }
  const languages = Object.fromEntries(
    [...groupBy(graded, (g) => g.record.language)].map(([k, v]) => [k, rate(v)]),
  );
  const types = Object.fromEntries(
    [...groupBy(graded, (g) => g.record.type)]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, rate(v)]),
  );

  const failedChecks = graded.flatMap((g) =>
    g.checks.filter((c) => !c.passed).map((c) => ({ g, c })),
  );
  const failureModes: FailureMode[] = [...groupBy(failedChecks, ({ c }) => `${c.severity}:${c.id}`)]
    .flatMap(([, items]): FailureMode[] => {
      const first = items[0];
      if (!first) return [];
      return [
        {
          check: first.c.id,
          severity: first.c.severity,
          count: items.length,
          scenarios: [
            ...new Set(items.map(({ g }) => `${g.record.scenarioId} (${g.record.language})`)),
          ],
          example: {
            scenarioId: first.g.record.scenarioId,
            language: first.g.record.language,
            detail: first.c.detail,
            transcript: first.g.record.turns,
          },
        },
      ];
    })
    .sort(
      (a, b) =>
        SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
        b.count - a.count,
    );

  const latencies = graded.flatMap((g) =>
    g.record.turns
      .filter((t) => t.speaker === 'agent' && t.latencyMs !== undefined)
      .map((t) => t.latencyMs ?? 0),
  );

  const audio = summariseAudio(graded);

  return {
    runId: meta.runId,
    createdAt: new Date().toISOString(),
    clinic: meta.clinic,
    setup: {
      clock: meta.clock,
      nlu: meta.nlu,
      patient: meta.patient,
      judge: meta.soft
        ? `LLM judge (${meta.soft.judge}), reported separately; it never changes a verdict`
        : 'not graded: the LLM judge for politeness/clarity needs a model key',
      caveat:
        meta.patient === 'scripted'
          ? 'Scripted patients say things the way the scenarios were written, so a high pass rate here is necessary but not sufficient. Real callers are messier: re-run with LLM-played patients and in audio mode before trusting a SAFE verdict for a pilot.'
          : 'LLM-played patients vary between runs; compare spreads, not single numbers.',
    },
    ...(audio ? { audio } : {}),
    ...(meta.soft ? { soft: meta.soft } : {}),
    ...(meta.agreement ? { judgeAgreement: meta.agreement } : {}),
    totals: rate(graded),
    flows,
    languages,
    types,
    failureModes,
    latency: {
      p50Ms: percentile(latencies, 50),
      p95Ms: percentile(latencies, 95),
      turns: latencies.length,
      note: 'text mode: agent processing + API round trips only. No speech-to-text or voice yet (M3).',
    },
    cost: {
      perCallInr: 0,
      note:
        meta.nlu === 'rules'
          ? 'rule-based understanding costs nothing; LLM token cost appears when Sarvam is used'
          : 'token cost not yet reported by the provider adapter',
    },
    calls: graded.map((g) => ({
      scenarioId: g.record.scenarioId,
      title: g.record.title,
      language: g.record.language,
      flow: g.record.flow,
      type: g.record.type,
      passed: g.passed,
      worst: g.worst,
      failed: g.checks.filter((c) => !c.passed),
      transcript: g.record.turns,
    })),
  };
}

// ------------------------------------------------------------------ rendering

const pct = (r: Rate) => `${Math.round(r.passRate * 100)}%`;
const FLOW_NAMES: Record<string, string> = {
  booking: 'Inbound booking',
  messages: 'Routing & messages',
  reminders: 'Outbound reminders',
};
const LANG_NAMES: Record<string, string> = { en: 'English', hinglish: 'Hinglish', hi: 'Hindi' };

function transcriptMd(turns: Turn[]): string {
  return turns
    .map((t) => `> **${t.speaker === 'agent' ? 'Myna' : 'Caller'}:** ${t.text || '_(silence)_'}`)
    .join('\n>\n');
}

const share = (n: number, d: number): string => (d ? `${Math.round((n / d) * 100)}%` : '–');

function agreementText(a: Agreement | undefined): string {
  if (!a || a.agreement === null)
    return 'Not measured yet: no human-labelled calls scored by the judge.';
  const base = `${Math.round(a.agreement * 100)}% agreement with ${a.n} human-labelled calls`;
  const trust =
    a.n < MIN_LABELLED_CALLS ? ` (fewer than ${MIN_LABELLED_CALLS} labels: too few to trust)` : '';
  const catches =
    a.catchRate === null
      ? ''
      : `; caught ${Math.round(a.catchRate * 100)}% of the calls a person marked wrong`;
  return `${base}${trust}${catches}.`;
}

function softMarkdown(r: Report): string[] {
  const out: string[] = ['## Soft criteria (LLM judge)', ''];
  if (!r.soft) {
    out.push(`Not graded. ${r.setup.judge}.`, '');
  } else {
    const s = r.soft;
    out.push(
      `Judge \`${s.judge}\` scored ${s.judged} calls (${s.unjudged} could not be scored and count as nothing, never as a pass). These scores are informational: no verdict depends on them.`,
      '',
      '| Criterion | Passed |',
      '|---|---|',
      ...CRITERIA.map(
        (c) =>
          `| ${c} | ${share(s.criteria[c].passed, s.criteria[c].total)} (${s.criteria[c].passed}/${s.criteria[c].total}) |`,
      ),
      '',
    );
    for (const f of s.flagged.slice(0, 8))
      out.push(
        `- \`${f.scenarioId}\` [${f.language}]: ${f.reasons.join('; ') || 'overall not handled well'}`,
      );
    if (s.flagged.length) out.push('');
  }
  out.push(`**Judge vs human:** ${agreementText(r.judgeAgreement)}`, '');
  return out;
}

export function renderMarkdown(r: Report): string {
  const lines: string[] = [];
  lines.push(`# Hawk go-live report — ${r.clinic}`, '');
  lines.push(
    `Run \`${r.runId}\` · ${r.createdAt} · ${r.totals.calls} simulated calls · clock pinned to ${r.setup.clock}`,
    '',
  );
  lines.push(
    `Understanding: **${r.setup.nlu}** · patients: **${r.setup.patient}** · soft criteria: ${r.setup.judge}`,
    '',
  );
  if (r.setup.modelUse) {
    const u = r.setup.modelUse;
    lines.push(
      `Model: \`${u.model ?? '?'}\` · ${u.calls} understandings, **${u.fallbacks} fell back to rules**, ${u.retries} rate-limit retries`,
      '',
    );
  }
  if (r.setup.instances) {
    lines.push(
      `Scaled out: **${r.setup.instances.agents} agent instances** sharing state via ${r.setup.instances.sharedState}; every turn of a call was served by a different instance than the one before`,
      '',
    );
  }
  if (r.audio) {
    const a = r.audio;
    lines.push(
      `Audio mode: **${a.utterances} spoken caller turns** through Bulbul → Saaras · recognition p50 ${a.asrP50Ms} ms / p95 ${a.asrP95Ms} ms · est. speech cost ₹${a.estSpeechCostPerCallInr.toFixed(2)} per call (${a.costNote})`,
      '',
      '| Language | Spoken turns | Character error rate |',
      '|---|---|---|',
      ...Object.entries(a.cerByLanguage).map(
        ([lang, v]) =>
          `| ${lang} | ${v.utterances} | ${v.meanCer === null ? 'n/a (spoken Roman, recognised in Devanagari)' : `${(v.meanCer * 100).toFixed(1)}%`} |`,
      ),
      '',
      'What recognition changed most (said → heard):',
      '',
      ...a.samples.map((x) => `- [${x.language}] "${x.said}" → "${x.heard}"`),
      '',
    );
  }
  lines.push(`> **Read this first:** ${r.setup.caveat}`, '');
  lines.push('## Verdict by flow', '', '| Flow | Verdict | Pass | Why |', '|---|---|---|---|');
  for (const [flow, f] of Object.entries(r.flows)) {
    lines.push(
      `| ${FLOW_NAMES[flow] ?? flow} | **${f.verdict}** | ${pct(f)} (${f.passed}/${f.calls}) | ${f.why} |`,
    );
  }
  lines.push('', `_${VERDICT_RULES}_`, '');
  lines.push(
    `**Overall:** ${pct(r.totals)} pass (${r.totals.passed}/${r.totals.calls}) · latency p50 ${r.latency.p50Ms} ms / p95 ${r.latency.p95Ms} ms (${r.latency.note}) · cost ₹${r.cost.perCallInr.toFixed(2)} per call (${r.cost.note})`,
    '',
  );
  lines.push('## Pass rate by language', '', '| Language | Pass | Calls |', '|---|---|---|');
  for (const [lang, x] of Object.entries(r.languages))
    lines.push(`| ${LANG_NAMES[lang] ?? lang} | ${pct(x)} | ${x.passed}/${x.calls} |`);
  lines.push('', '## Pass rate by scenario type', '', '| Type | Pass | Calls |', '|---|---|---|');
  for (const [type, x] of Object.entries(r.types))
    lines.push(`| ${type} | ${pct(x)} | ${x.passed}/${x.calls} |`);
  lines.push(...softMarkdown(r));
  lines.push('', '## Top failure modes', '');
  if (r.failureModes.length === 0) lines.push('None. Every call passed every check.');
  for (const m of r.failureModes) {
    lines.push(
      `### ${m.severity.toUpperCase()} · \`${m.check}\` · ${m.count} call${m.count > 1 ? 's' : ''}`,
      '',
    );
    lines.push(`Scenarios: ${m.scenarios.join(', ')}`, '');
    lines.push(
      `Example (${m.example.scenarioId}, ${LANG_NAMES[m.example.language] ?? m.example.language}): ${m.example.detail}`,
      '',
    );
    lines.push(transcriptMd(m.example.transcript), '');
  }
  return lines.join('\n');
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function softHtml(r: Report): string {
  const s = r.soft;
  const body = s
    ? `<div class="panel">${CRITERIA.map(
        (c) =>
          `<p><b>${esc(c)}</b> ${share(s.criteria[c].passed, s.criteria[c].total)} <span class="muted">(${s.criteria[c].passed}/${s.criteria[c].total})</span></p>`,
      ).join(
        '',
      )}<p class="muted">Judge ${esc(s.judge)} scored ${s.judged} calls; ${s.unjudged} could not be scored. Informational: no verdict depends on these.</p></div>`
    : `<p class="muted">Not graded. ${esc(r.setup.judge)}.</p>`;
  return `${body}<p><b>Judge vs human:</b> ${esc(agreementText(r.judgeAgreement))}</p>`;
}

export function renderHtml(r: Report): string {
  const verdictClass = (v: Verdict) =>
    v === 'SAFE TO LAUNCH' ? 'safe' : v === 'LAUNCH WITH HANDOFF' ? 'warn' : 'danger';
  const bar = (label: string, x: Rate) => `
    <div class="bar-row"><span class="bar-label">${esc(label)}</span>
      <span class="bar"><span class="fill" style="width:${Math.round(x.passRate * 100)}%"></span><span class="safe-line"></span></span>
      <span class="bar-val">${pct(x)} <small>${x.passed}/${x.calls}</small></span></div>`;
  const flows = Object.entries(r.flows)
    .map(
      ([flow, f]) => `
      <article class="card">
        <h3>${esc(FLOW_NAMES[flow] ?? flow)}</h3>
        <span class="badge ${verdictClass(f.verdict)}">${f.verdict}</span>
        <p class="big">${pct(f)} <small>${f.passed}/${f.calls} passed</small></p>
        <p class="muted">${esc(f.why)}</p>
      </article>`,
    )
    .join('');
  const modes = r.failureModes
    .map(
      (m, i) => `
      <details ${i === 0 ? 'open' : ''}>
        <summary><span class="sev ${m.severity}">${m.severity}</span> <code>${esc(m.check)}</code> · ${m.count} call${m.count > 1 ? 's' : ''}</summary>
        <p>${esc(m.example.detail)}</p>
        <p class="muted">${esc(m.scenarios.join(', '))}</p>
        <div class="transcript">${m.example.transcript
          .map(
            (t) =>
              `<p class="${t.speaker}"><b>${t.speaker === 'agent' ? 'Myna' : 'Caller'}</b> ${esc(t.text || '(silence)')}</p>`,
          )
          .join('')}</div>
      </details>`,
    )
    .join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Hawk go-live report · ${esc(r.clinic)}</title>
<style>
:root{--bg:#FAF8F3;--surface:#fff;--line:#E3DED2;--text:#16211F;--text2:#46524F;--primary:#0E5C59;--safe:#1D6337;--safe-bg:#E3F1E7;--warn:#8C4A06;--warn-bg:#FBEBDA;--danger:#9E2A1F;--danger-bg:#FAE5E2}
@media (prefers-color-scheme:dark){:root{--bg:#0D1413;--surface:#141D1C;--line:#26322F;--text:#EAEFEC;--text2:#B0BBB8;--primary:#4DB8AE;--safe:#7DD69B;--safe-bg:#14301F;--warn:#F3B377;--warn-bg:#36240F;--danger:#F49A8F;--danger-bg:#3A1915}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.55 system-ui,'Segoe UI',sans-serif}
main{max-width:1100px;margin:0 auto;padding:32px 16px 64px}h1{font-size:30px;margin:0 0 4px}h2{font-size:20px;margin:32px 0 12px}
.muted{color:var(--text2)}small{color:var(--text2);font-weight:400}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:20px}.card h3{margin:0 0 10px;font-size:16px}
.badge{display:inline-block;padding:6px 12px;border-radius:999px;font-weight:800;letter-spacing:.05em;font-size:13px}
.badge.safe{background:var(--safe-bg);color:var(--safe)}.badge.warn{background:var(--warn-bg);color:var(--warn)}.badge.danger{background:var(--danger-bg);color:var(--danger)}
.big{font-size:34px;font-weight:800;margin:12px 0 4px}
.panel{background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:20px}
.bar-row{display:grid;grid-template-columns:150px 1fr 90px;gap:12px;align-items:center;margin:8px 0}
.bar{position:relative;height:12px;background:var(--line);border-radius:6px;overflow:hidden}.fill{position:absolute;inset:0 auto 0 0;background:var(--primary)}
.safe-line{position:absolute;left:92%;top:-2px;bottom:-2px;width:2px;background:var(--text)}
details{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:12px 16px;margin:10px 0}summary{cursor:pointer;font-weight:600}
.sev{text-transform:uppercase;font-size:12px;font-weight:800;padding:2px 8px;border-radius:6px}.sev.critical{background:var(--danger-bg);color:var(--danger)}.sev.high{background:var(--warn-bg);color:var(--warn)}.sev.medium,.sev.low{background:var(--line)}
.transcript{border-top:1px solid var(--line);margin-top:8px;padding-top:8px}.transcript p{margin:6px 0}.transcript .agent b{color:var(--primary)}
@media (max-width:600px){.bar-row{grid-template-columns:100px 1fr 70px}}
</style></head><body><main>
<h1>Hawk go-live report</h1>
<p class="muted">Myna for ${esc(r.clinic)} · run ${esc(r.runId)} · ${r.totals.calls} simulated calls · ${esc(r.setup.nlu)} understanding, ${esc(r.setup.patient)} patients · clock ${esc(r.setup.clock)}</p>
<p class="panel"><b>Read this first:</b> ${esc(r.setup.caveat)}</p>
<h2>Verdict by flow</h2><div class="cards">${flows}</div>
<p class="muted">${esc(VERDICT_RULES)}</p>
<div class="cards">
  <article class="card"><h3>Overall pass</h3><p class="big">${pct(r.totals)} <small>${r.totals.passed}/${r.totals.calls}</small></p></article>
  <article class="card"><h3>Latency p50 / p95</h3><p class="big">${r.latency.p50Ms} / ${r.latency.p95Ms} ms</p><p class="muted">${esc(r.latency.note)}</p></article>
  <article class="card"><h3>Cost per call</h3><p class="big">₹${r.cost.perCallInr.toFixed(2)}</p><p class="muted">${esc(r.cost.note)}</p></article>
</div>
<h2>Pass rate by language</h2><div class="panel">${Object.entries(r.languages)
    .map(([k, v]) => bar(LANG_NAMES[k] ?? k, v))
    .join('')}</div>
<h2>Pass rate by scenario type</h2><div class="panel">${Object.entries(r.types)
    .map(([k, v]) => bar(k, v))
    .join('')}</div>
<h2>Soft criteria (LLM judge)</h2>${softHtml(r)}
<h2>Top failure modes</h2>${modes || '<p>None. Every call passed every check.</p>'}
<p class="muted">Read-only report · all patients and calls are simulated · soft criteria ${esc(r.setup.judge)}</p>
</main></body></html>`;
}
