import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { grade, type GradedCall } from './grader.js';
import { loadSuite } from './load.js';
import { buildReport, type Report, renderHtml, renderMarkdown } from './report.js';
import { type Endpoints, runScenario } from './runner.js';
import { Language } from './schema.js';
import { REPO_ROOT, startServices } from './services.js';

/**
 *   pnpm hawk run                              everything, every language
 *   pnpm hawk run --filter reminder --lang en  a slice
 *   pnpm hawk run --api URL --agent URL --token T   against already-running services
 */

// Monday 12 Oct 2026, 11:00 IST: inside the reminder window, a normal clinic morning.
const DEFAULT_CLOCK = '2026-10-12T05:30:00Z';

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      filter: { type: 'string' },
      lang: { type: 'string' },
      concurrency: { type: 'string', default: '6' },
      out: { type: 'string', default: join(REPO_ROOT, 'docs', 'reports') },
      nlu: { type: 'string', default: 'rules' },
      model: { type: 'string' },
      instances: { type: 'string', default: '1' },
      clock: { type: 'string', default: DEFAULT_CLOCK },
      api: { type: 'string' },
      agent: { type: 'string' },
      token: { type: 'string' },
      clinic: { type: 'string', default: 'smile-dental' },
      /** CI: exit non-zero if any flow is NOT SAFE. */
      gate: { type: 'boolean', default: false },
    },
  });
  if (positionals[0] !== 'run') {
    console.log('usage: pnpm hawk run [--filter text] [--lang en,hinglish,hi] [--concurrency 6]');
    process.exit(2);
  }

  const suite = await loadSuite(join(REPO_ROOT, 'hawk'));
  const langs = values.lang ? values.lang.split(',').map((l) => Language.parse(l.trim())) : null;
  const jobs = suite.scenarios
    .filter((s) => !values.filter || s.id.includes(values.filter) || s.type.includes(values.filter))
    .flatMap((s) =>
      s.languages.filter((l) => !langs || langs.includes(l)).map((lang) => ({ s, lang })),
    );
  if (jobs.length === 0) throw new Error('no scenarios match');

  const services =
    values.api && values.agent && values.token
      ? null
      : await startServices({
          fakeNowUtc: values.clock,
          nlu: values.nlu,
          ...(values.model ? { model: values.model } : {}),
          instances: Number(values.instances),
        });
  const env: Endpoints = {
    apiUrl: services?.apiUrl ?? values.api ?? '',
    agentUrls: services?.agentUrls ?? (values.agent ? [values.agent] : []),
    token: services?.token ?? values.token ?? '',
    baseClinicId: values.clinic,
  };

  console.log(
    `Hawk: ${jobs.length} calls (${suite.scenarios.length} scenarios) against ${env.agentUrls.join(' + ')}`,
  );
  const graded: GradedCall[] = [];
  const queue = [...jobs];
  const workers = Array.from({ length: Number(values.concurrency) }, async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const persona = suite.personas.get(job.s.persona);
      if (!persona) throw new Error(`unknown persona ${job.s.persona}`);
      const record = await runScenario(env, job.s, persona, job.lang);
      const g = grade(record, job.s);
      graded.push(g);
      const mark = g.passed ? 'pass' : `FAIL (${g.worst ?? ''})`;
      console.log(`  ${mark.padEnd(16)} ${job.s.id} [${job.lang}]`);
    }
  });
  let report: Report;
  try {
    await Promise.all(workers);
    if (services && graded.some((g) => g.record.endedBy === 'error')) {
      const { agent, api } = services.logs();
      console.log(`
--- agent log (tail) ---
${agent.slice(-3500)}
--- api log (tail) ---
${api.slice(-1500)}
`);
    }
    report = finish(graded, values.clock, values.nlu);
    const all = await Promise.all(
      env.agentUrls.map((u) =>
        fetch(`${u}/v1/stats`)
          .then((r) => r.json() as Promise<Record<string, number | string | null>>)
          .catch(() => null),
      ),
    );
    const stats = all.filter((x): x is Record<string, number | string | null> => x !== null);
    const first = stats[0];
    if (first && values.nlu !== 'rules') {
      const sum = (k: string) => stats.reduce((n, x) => n + Number(x[k] ?? 0), 0);
      report.setup.modelUse = {
        model: typeof first.model === 'string' ? first.model : null,
        calls: sum('nluCalls'),
        fallbacks: sum('nluFallbacks'),
        retries: sum('nluRetries'),
      };
      console.log(`Model use: ${JSON.stringify(report.setup.modelUse)}`);
    }
    if (services && env.agentUrls.length > 1) {
      report.setup.instances = { agents: env.agentUrls.length, sharedState: services.sharedState };
    }
    // The JSON report is stored via the API (CLAUDE.md, Part 4); files below are renderings.
    const saved = await fetch(`${env.apiUrl}/v1/clinics/${values.clinic}/reports`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.token}` },
      body: JSON.stringify(report),
    });
    const body = (await saved.json()) as { data?: { reportId?: string } };
    console.log(`Stored via API as ${body.data?.reportId ?? `(failed: ${saved.status})`}`);
  } finally {
    await services?.stop();
  }

  await mkdir(values.out, { recursive: true });
  const base = join(values.out, report.runId);
  await writeFile(`${base}.json`, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(`${base}.md`, renderMarkdown(report));
  await writeFile(`${base}.html`, renderHtml(report));

  console.log('');
  for (const [flow, f] of Object.entries(report.flows)) {
    console.log(
      `  ${flow.padEnd(10)} ${f.verdict.padEnd(20)} ${Math.round(f.passRate * 100)}% (${f.passed}/${f.calls}) ${f.why}`,
    );
  }
  console.log(`\nReport: ${base}.html`);
  if (values.gate && Object.values(report.flows).some((f) => f.verdict === 'NOT SAFE')) {
    console.error('Hawk gate: at least one flow is NOT SAFE');
    process.exitCode = 1;
  }
}

function finish(graded: GradedCall[], clock: string, nlu: string): Report {
  graded.sort(
    (a, b) =>
      a.record.scenarioId.localeCompare(b.record.scenarioId) ||
      a.record.language.localeCompare(b.record.language),
  );
  const runId = `hawk-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`;
  return buildReport(graded, {
    runId,
    clinic: 'Smile Dental Care (synthetic)',
    clock: `${clock} (Mon 12 Oct 2026, 11:00 IST)`,
    nlu: nlu === 'rules' ? 'rule-based (offline baseline)' : nlu,
    patient: 'scripted',
  });
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
