import Link from 'next/link';
import { Talk } from '@/components/talk';
import { Card, Icon, ICONS, Logo } from '@/components/ui';
import { DEMO_CLINIC, publicApi } from '@/lib/api';
import type { Demo } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const demo = await publicApi<Demo>(`/clinics/${DEMO_CLINIC}/demo`).catch(() => null);
  return (
    <>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-4 sm:px-8">
          <Logo />
          <div className="mr-auto leading-tight">
            <p className="font-bold">myna</p>
            <p className="text-xs text-ink-3">Myna talks, Hawk watches.</p>
          </div>
          <nav aria-label="Main" className="flex items-center gap-1 text-sm font-semibold">
            <Link
              href="/hawk"
              className="flex h-11 items-center rounded-lg px-3 text-ink-2 hover:bg-sunken"
            >
              How Hawk tests Myna
            </Link>
            <Link
              href="/login"
              className="flex h-11 items-center rounded-lg px-3 text-primary-ink hover:bg-sunken"
            >
              Clinic sign in
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl min-w-0 flex-col gap-10 px-4 py-8 sm:px-8">
        <Talk initialDemo={demo} />

        <div className="grid gap-4 md:grid-cols-3">
          <Card className="flex flex-col gap-2">
            <h2 className="flex items-center gap-2 font-bold text-safe-ink">
              <Icon d={ICONS.check} size={18} /> She can
            </h2>
            <ul className="list-disc space-y-1 pl-5 text-ink-2">
              <li>Book, move and cancel appointments</li>
              <li>Answer clinic timings, fees and directions</li>
              <li>Take a message and promise a staff call-back</li>
              <li>Call patients the day before to confirm</li>
            </ul>
          </Card>
          <Card className="flex flex-col gap-2">
            <h2 className="flex items-center gap-2 font-bold text-danger-ink">
              <Icon d={ICONS.x} size={18} /> She won’t
            </h2>
            <ul className="list-disc space-y-1 pl-5 text-ink-2">
              <li>Give medical advice or suggest medicines</li>
              <li>Guess answers the clinic hasn’t given her</li>
              <li>Share one patient’s details with another caller</li>
              <li>Pretend to be a person: she says she’s an assistant</li>
            </ul>
          </Card>
          <div className="flex flex-col gap-2 rounded-[20px] bg-danger-soft p-5 text-danger-ink">
            <h2 className="flex items-center gap-2 font-bold">
              <Icon d={ICONS.warn} size={18} /> Emergency? Call 112 or 108
            </h2>
            <p className="text-ink">
              If a caller mentions chest pain, heavy bleeding, trouble breathing or anything urgent,
              Myna stops and tells them to call 112 or 108 right away, in their language.
            </p>
            <p lang="hi" className="text-ink">
              आपातकाल में तुरंत 112 या 108 पर कॉल करें।
            </p>
          </div>
        </div>

        <p className="max-w-3xl text-[13px] text-ink-3">
          Myna says she’s an AI assistant at the start of every call. This demo doesn’t record
          audio. Chats are kept for 30 days with phone numbers masked, then deleted; ask us and
          we’ll delete yours sooner. The demo clinic and its patients are fictional.
        </p>
      </main>
    </>
  );
}
