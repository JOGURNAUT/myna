'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  ['/dashboard', 'Today', true],
  ['/dashboard/calls', 'Calls', false],
  ['/dashboard/reminders', 'Reminders', false],
  ['/dashboard/setup', 'Setup', false],
] as const;

export function NavTabs() {
  const path = usePathname();
  const active = (href: string, exact: boolean) =>
    exact ? path === href : path === href || path.startsWith(`${href}/`);
  return (
    <nav aria-label="Main" className="mr-auto flex flex-wrap gap-1 text-sm font-semibold">
      {TABS.map(([href, label, exact]) => (
        <Link
          key={href}
          href={href}
          aria-current={active(href, exact) ? 'page' : undefined}
          className={`flex h-11 items-center rounded-lg px-3.5 ${
            active(href, exact) ? 'bg-primary-soft text-primary-ink' : 'text-ink-2 hover:bg-sunken'
          }`}
        >
          {label}
        </Link>
      ))}
      <Link
        href="/"
        className="flex h-11 items-center rounded-lg px-3.5 text-ink-2 hover:bg-sunken"
      >
        Public demo
      </Link>
    </nav>
  );
}
