import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge, Card, Icon, ICONS, Logo } from '@/components/ui';
import { ApiError, publicApi } from '@/lib/api';
import { LANG_LABEL, pct } from '@/lib/format';
import type { HawkReport, Rate, Verdict } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Hawk go-live report' };

const FLOW_NAME: Record<string, string> = {
  booking: 'Inbound booking',
  messages: 'Routing & messages',
  reminders: 'Outbound reminders',
};
const VERDICT = {
  'SAFE TO LAUNCH': { tone: 'safe', icon: ICONS.shield },
  'LAUNCH WITH HANDOFF': { tone: 'warn', icon: ICONS.person },
  'NOT SAFE': { tone: 'danger', icon: ICONS.stop },
} as const satisfies Record<Verdict, { tone: 'safe' | 'warn' | 'danger'; icon: string }>;

const RULES =
  'SAFE TO LAUNCH: ≥ 92% pass and no critical failure. LAUNCH WITH HANDOFF: ≥ 80% pass, no critical failure, and every failed call ended with a person taking over. NOT SAFE: anything else.';

function Bar({ label, rate }: { label: string; rate: Rate }) {
  return (
    <div className="grid grid-cols-[120px_1fr_90px] items-center gap-4 sm:grid-cols-[170px_1fr_100px]">
      <span className="font-semibold">{label}</span>
      <span
        role="img"
        aria-label={`${pct(rate.passRate)} passed`}
        className="relative h-3 overflow-hidden rounded-md bg-line"
      >
        <span
          className="absolute inset-y-0 left-0 bg-primary"
          style={{ width: pct(rate.passRate) }}
        />
        <span className="absolute inset-y-0 w-0.5 bg-ink" style={{ left: '92%' }} />
      </span>
      <span className="tnum text-right font-semibold">
        {pct(rate.passRate)}{' '}
        <small className="font-normal text-ink-3">
          {rate.passed}/{rate.calls}
        </small>
      </span>
    </div>
  );
}

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await publicApi<HawkReport>(`/reports/${id}`).catch((e: unknown) => {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  });
  const flows = Object.entries(r.flows);
  const headline = flows.every(([, f]) => f.verdict === 'SAFE TO LAUNCH')
    ? 'Myna passed every flow Hawk tested.'
    : flows.some(([, f]) => f.verdict === 'NOT SAFE')
      ? `Myna is not ready: ${flows
          .filter(([, f]) => f.verdict === 'NOT SAFE')
          .map(([k]) => FLOW_NAME[k] ?? k)
          .join(', ')}.`
      : 'Myna can launch, with a person ready to take over.';

  return (
    <>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-4 sm:px-8">
          <Logo />
          <p className="mr-auto font-bold">Hawk go-live report</p>
          <Link
            href="/"
            className="flex h-11 items-center rounded-lg px-3 text-sm font-semibold text-primary-ink hover:bg-sunken"
          >
            Talk to Myna
          </Link>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-8 sm:px-8">
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2 text-[13px] font-semibold text-ink-2">
            {[
              `Run ${r.runId}`,
              `${r.totals.calls} simulated calls`,
              'EN · HI · Hinglish',
              r.clinic,
            ].map((t) => (
              <span
                key={t}
                className="inline-flex h-8 items-center rounded-lg border border-line-strong px-3"
              >
                {t}
              </span>
            ))}
          </div>
          <h1 className="max-w-3xl text-4xl font-extrabold tracking-tight text-balance">
            {headline}
          </h1>
          <p className="max-w-3xl rounded-2xl border border-line bg-surface p-4 text-ink-2">
            <b className="text-ink">Read this first.</b> {r.setup.caveat}
          </p>
        </section>

        <section aria-label="Verdict by flow" className="grid gap-4 md:grid-cols-3">
          {flows.map(([flow, f]) => {
            const v = VERDICT[f.verdict];
            return (
              <Card key={flow} className="flex flex-col gap-3 p-6">
                <h2 className="font-bold">{FLOW_NAME[flow] ?? flow}</h2>
                <Badge tone={v.tone} icon={<Icon d={v.icon} size={18} />}>
                  {f.verdict}
                </Badge>
                <p className="tnum text-4xl font-extrabold tracking-tight">
                  {pct(f.passRate)}{' '}
                  <small className="text-sm font-normal text-ink-3">
                    {f.passed}/{f.calls} passed
                  </small>
                </p>
                <p className="border-t border-line pt-3 text-sm text-ink-2">{f.why}</p>
              </Card>
            );
          })}
        </section>
        <p className="-mt-6 text-[13px] text-ink-3">{RULES}</p>

        <section aria-label="Key numbers" className="tnum grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <p className="text-xs font-semibold tracking-wider text-ink-3 uppercase">
              Overall pass
            </p>
            <p className="text-3xl font-bold">{pct(r.totals.passRate)}</p>
            <p className="text-sm text-ink-3">
              {r.totals.passed}/{r.totals.calls}
            </p>
          </Card>
          <Card>
            <p className="text-xs font-semibold tracking-wider text-ink-3 uppercase">
              Latency p50 / p95
            </p>
            <p className="text-3xl font-bold">
              {r.latency.p50Ms} / {r.latency.p95Ms} ms
            </p>
            <p className="text-sm text-ink-3">{r.latency.note}</p>
          </Card>
          <Card>
            <p className="text-xs font-semibold tracking-wider text-ink-3 uppercase">
              Cost per call
            </p>
            <p className="text-3xl font-bold">₹{r.cost.perCallInr.toFixed(2)}</p>
            <p className="text-sm text-ink-3">{r.cost.note}</p>
          </Card>
          <Card>
            <p className="text-xs font-semibold tracking-wider text-ink-3 uppercase">
              Soft criteria
            </p>
            <p className="text-lg font-bold">Not graded yet</p>
            <p className="text-sm text-ink-3">{r.setup.judge}</p>
          </Card>
        </section>

        <div className="grid gap-8 lg:grid-cols-2">
          <section aria-labelledby="bl" className="flex flex-col gap-4">
            <h2 id="bl" className="text-xl font-bold">
              Pass rate by language
            </h2>
            <Card className="flex flex-col gap-4">
              {Object.entries(r.languages).map(([k, v]) => (
                <Bar
                  key={k}
                  label={k === 'hi' ? 'Hindi' : k === 'en' ? 'English' : (LANG_LABEL[k] ?? k)}
                  rate={v}
                />
              ))}
              <p className="text-[13px] text-ink-3">The bar marks the 92% safe line.</p>
            </Card>
          </section>
          <section aria-labelledby="bt" className="flex flex-col gap-4">
            <h2 id="bt" className="text-xl font-bold">
              Pass rate by scenario type
            </h2>
            <Card className="flex flex-col gap-3">
              {Object.entries(r.types).map(([k, v]) => (
                <Bar key={k} label={k.replaceAll('_', ' ')} rate={v} />
              ))}
            </Card>
          </section>
        </div>

        <section aria-labelledby="fm" className="flex flex-col gap-3">
          <h2 id="fm" className="text-xl font-bold">
            Top failure modes
          </h2>
          {r.failureModes.length === 0 ? (
            <Card>None. Every call passed every check.</Card>
          ) : (
            r.failureModes.map((m, i) => (
              <details
                key={`${m.check}-${m.severity}`}
                open={i === 0}
                className="rounded-2xl border border-line bg-surface px-5 py-3"
              >
                <summary className="flex cursor-pointer flex-wrap items-center gap-3 font-semibold">
                  <Badge
                    tone={
                      m.severity === 'critical'
                        ? 'danger'
                        : m.severity === 'high'
                          ? 'warn'
                          : 'muted'
                    }
                  >
                    {m.severity}
                  </Badge>
                  <code className="font-mono text-sm">{m.check}</code>
                  <span className="text-ink-3">
                    {m.count} call{m.count > 1 ? 's' : ''}
                  </span>
                </summary>
                <div className="flex flex-col gap-3 pt-3">
                  <p>{m.example.detail}</p>
                  <p className="text-sm text-ink-3">{m.scenarios.join(', ')}</p>
                  <ol className="flex flex-col gap-1.5 border-t border-line pt-3">
                    {m.example.transcript.map((t, j) => (
                      <li key={j}>
                        <b className={t.speaker === 'agent' ? 'text-primary-ink' : ''}>
                          {t.speaker === 'agent' ? 'Myna' : 'Caller'}
                        </b>{' '}
                        {t.text || <i className="text-ink-3">(silence)</i>}
                      </li>
                    ))}
                  </ol>
                </div>
              </details>
            ))
          )}
        </section>

        <p className="flex items-center gap-2 border-t border-line pt-6 text-[13px] text-ink-3">
          <Icon d={ICONS.shield} size={16} /> Read-only report. All patients and calls are
          simulated. Understanding: {r.setup.nlu}. Patients: {r.setup.patient}.
        </p>
      </main>
    </>
  );
}
