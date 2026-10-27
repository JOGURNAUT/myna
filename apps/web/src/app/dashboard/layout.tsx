import type { ReactNode } from 'react';
import { signOut } from '@/app/login/actions';
import { btnGhost, Icon, ICONS, Logo } from '@/components/ui';
import { staffApi } from '@/lib/api';
import type { Me } from '@/lib/types';
import { setKillSwitch } from './actions';
import { NavTabs } from './nav-tabs';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const me = await staffApi<Me>('/me');
  return (
    <>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-8">
          <div className="flex items-center gap-3">
            <Logo />
            <div className="leading-tight">
              <p className="font-bold">{me.name}</p>
              <p className="text-xs text-ink-3">Myna receptionist</p>
            </div>
          </div>
          <NavTabs />

          {me.killSwitch ? (
            <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-muted-soft px-3 text-[13px] font-semibold text-muted-ink">
              <Icon d="M9 5v14M15 5v14" size={14} /> Myna paused
            </span>
          ) : (
            <span className="inline-flex h-8 items-center gap-2 rounded-full bg-accent-soft px-3 text-[13px] font-semibold text-accent-ink">
              <span className="live h-2 w-2 rounded-full bg-accent" aria-hidden="true" /> Myna is
              answering
            </span>
          )}

          {me.killSwitch ? (
            <form action={setKillSwitch}>
              <input type="hidden" name="on" value="false" />
              <button type="submit" className={`${btnGhost} h-11 border-warn-ink text-warn-ink`}>
                <Icon d={ICONS.power} size={18} /> Turn Myna back on
              </button>
            </form>
          ) : (
            <details className="relative">
              <summary className={`${btnGhost} h-11 list-none`}>
                <Icon d={ICONS.power} size={18} /> Route all calls to staff
              </summary>
              <div
                role="alertdialog"
                aria-label="Route all calls to staff?"
                className="absolute right-0 z-10 mt-2 flex w-80 flex-col gap-3 rounded-2xl border border-line bg-surface p-4 shadow-lg"
              >
                <p className="font-bold">Route all calls to staff?</p>
                <p className="text-sm text-ink-2">
                  Myna stops answering and every call rings the front desk until you turn her back
                  on. Reminder calls pause too.
                </p>
                <form action={setKillSwitch}>
                  <input type="hidden" name="on" value="true" />
                  <button
                    type="submit"
                    className="h-12 w-full cursor-pointer rounded-xl border-2 border-warn-ink bg-warn-soft font-bold text-warn-ink"
                  >
                    Yes, route to staff
                  </button>
                </form>
              </div>
            </details>
          )}

          <form action={signOut}>
            <button
              type="submit"
              className="h-11 cursor-pointer rounded-lg px-3 text-sm font-semibold text-ink-2 hover:bg-sunken"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      {me.killSwitch && (
        <div role="status" className="bg-warn-soft text-warn-ink">
          <p className="mx-auto flex max-w-[1440px] items-center gap-2 px-4 py-3 font-semibold sm:px-8">
            <Icon d="M9 5v14M15 5v14" size={18} />
            All calls are going to staff. Myna isn’t answering or making reminder calls.
          </p>
        </div>
      )}
      <main className="mx-auto flex max-w-[1440px] flex-col gap-10 px-4 py-8 sm:px-8">
        {children}
      </main>
    </>
  );
}
