import Link from 'next/link';
import { LoginForm } from './login-form';
import { Logo } from '@/components/ui';

export const metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ expired?: string }>;
}) {
  const { expired } = await searchParams;
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <section
        aria-label="About the dashboard"
        className="hidden flex-col justify-between gap-12 bg-primary p-14 text-on-primary lg:flex"
      >
        <div className="flex items-center gap-3">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-surface">
            <Logo size={36} />
          </span>
          <div className="leading-tight">
            <p className="text-2xl font-extrabold">myna</p>
            <p className="text-sm">Clinic dashboard</p>
          </div>
        </div>
        <h2 className="max-w-lg text-4xl font-extrabold tracking-tight text-balance">
          Everything Myna couldn’t finish on her own, ready for your front desk.
        </h2>
        <p className="text-sm">Myna talks, Hawk watches.</p>
      </section>

      <main className="flex items-center justify-center p-6">
        <div className="flex w-full max-w-sm flex-col gap-7">
          <div className="flex flex-col gap-2">
            <h1 className="text-3xl font-bold">Sign in to your clinic</h1>
            <p className="text-ink-2">
              One login per clinic. Use the clinic ID and password you got when Myna was set up.
            </p>
          </div>
          {expired && (
            <p role="status" className="rounded-xl bg-warn-soft px-4 py-3 text-warn-ink">
              Your session ended. Please sign in again.
            </p>
          )}
          <LoginForm />
          <div className="flex flex-col gap-1 border-t border-line pt-5 text-sm text-ink-2">
            <span>Not clinic staff?</span>
            <Link href="/" className="flex min-h-11 items-center font-semibold text-primary-ink">
              Try the public demo: talk to Myna
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
