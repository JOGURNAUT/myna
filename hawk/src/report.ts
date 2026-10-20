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

export function buildReport(
  graded: GradedCall[],
  meta: { runId: string; clinic: string; clock: string; nlu: string; patient: string },
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

  return {
    runId: meta.runId,
    createdAt: new Date().toISOString(),
    clinic: meta.clinic,
    setup: {
      clock: meta.clock,
      nlu: meta.nlu,
      patient: meta.patient,
      judge: 'not graded: the LLM judge for politeness/clarity needs a model key',
      caveat:
        meta.patient === 'scripted'
          ? 'Scripted patients say things the way the scenarios were written, so a high pass rate here is necessary but not sufficient. Real callers are messier: re-run with LLM-played patients and in audio mode before trusting a SAFE verdict for a pilot.'
          : 'LLM-played patients vary between runs; compare spreads, not single numbers.',
    },
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
<h2>Top failure modes</h2>${modes || '<p>None. Every call passed every check.</p>'}
<p class="muted">Read-only report · all patients and calls are simulated · soft criteria ${esc(r.setup.judge)}</p>
</main></body></html>`;
}
