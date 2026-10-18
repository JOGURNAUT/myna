import Link from 'next/link';
import { redirect } from 'next/navigation';
import { DEMO_CLINIC, publicApi } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'How Hawk tests Myna' };

/** `/hawk` always lands on the most recent go-live report. */
export default async function HawkIndex() {
  const latest = await publicApi<{ reportId: string }>(
    `/clinics/${DEMO_CLINIC}/latest-report`,
  ).catch(() => null);
  if (latest) redirect(`/report/${latest.reportId}`);
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-16">
      <h1 className="text-3xl font-bold">No go-live report yet</h1>
      <p className="text-ink-2">
        Hawk is the test harness that plays hundreds of simulated patients against Myna and decides
        whether she is safe to launch. Run <code className="font-mono">pnpm hawk run</code> to
        produce the first report.
      </p>
      <Link href="/" className="font-semibold text-primary-ink">
        Back to the demo
      </Link>
    </main>
  );
}
