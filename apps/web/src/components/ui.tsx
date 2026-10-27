import type { ReactNode } from 'react';
import { LANG_GLYPH, LANG_LABEL } from '@/lib/format';

export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <path d="M9.5 21.5L2.5 29.5L14.5 25.5Z" fill="var(--primary)" />
      <circle cx="16" cy="16" r="11" fill="var(--primary)" />
      <path d="M25.4 11.6L31 15L25.4 18.4Z" fill="var(--accent)" />
      <ellipse cx="20.6" cy="12.2" rx="3.4" ry="2.9" fill="var(--accent)" />
      <circle cx="21.4" cy="12.2" r="1.35" fill="var(--bg)" />
    </svg>
  );
}

/** Hawk, the tester: ink, never teal (the thing that judges should never be mistaken for Myna). */
export function HawkLogo({ size = 32 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <path d="M9.5 21.5L3 30L14 25.5Z" fill="var(--mark-hawk)" />
      <path d="M13 4.5L23 5.5L27.5 11L26.5 20L19 27.5L8 25.5L4.5 14Z" fill="var(--mark-hawk)" />
      <path d="M25 8.5L31 11L30 17L28 13.5L25.8 14Z" fill="var(--accent)" />
      <path d="M15.6 11L23 9.2L20.8 13.2Z" fill="var(--accent)" />
      <circle cx="20.4" cy="11" r="1.15" fill="var(--bg)" />
    </svg>
  );
}

type Tone = 'safe' | 'warn' | 'danger' | 'muted' | 'primary' | 'accent';
const TONE: Record<Tone, string> = {
  safe: 'bg-safe-soft text-safe-ink',
  warn: 'bg-warn-soft text-warn-ink',
  danger: 'bg-danger-soft text-danger-ink',
  muted: 'bg-muted-soft text-muted-ink',
  primary: 'bg-primary-soft text-primary-ink',
  accent: 'bg-accent-soft text-accent-ink',
};

/** Every status is an icon + a word + a colour: readable in grayscale. */
export function Badge({
  tone,
  icon,
  children,
}: {
  tone: Tone;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-semibold ${TONE[tone]}`}
    >
      {icon}
      {children}
    </span>
  );
}

export function LangBadge({ lang }: { lang: string | null | undefined }) {
  if (!lang) return <span className="text-ink-3">—</span>;
  return (
    <span className="inline-flex h-6 items-center gap-1.5 rounded-md border border-line-strong pr-1.5 pl-0.5 text-xs font-semibold text-ink-2">
      <span className="flex h-[18px] min-w-[22px] items-center justify-center rounded bg-sunken px-0.5 text-[11px] text-ink">
        {LANG_GLYPH[lang] ?? '?'}
      </span>
      {LANG_LABEL[lang] ?? lang}
    </span>
  );
}

export function Icon({ d, size = 16 }: { d: string; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      <path d={d} />
    </svg>
  );
}

export const ICONS = {
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6L6 18',
  warn: 'M12 3.5L2.5 20h19zM12 10v4.5M12 17.4v.2',
  person: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3 20c0-3.3 2.7-6 6-6M13 17h8M18 14l3 3-3 3',
  phone:
    'M5 4h3l1.5 4-2 1.5a11 11 0 0 0 5 5l1.5-2 4 1.5v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z',
  message: 'M4 5h16v11H9l-5 4z',
  refresh: 'M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4',
  shield: 'M12 3l7 3v5.5c0 4.5-3 8-7 9.5-4-1.5-7-5-7-9.5V6l7-3zM8.8 12l2.2 2.2 4.2-4.4',
  flask: 'M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3M7.5 15h9',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 7.6v.4',
  power: 'M12 3v8M6.3 6.8a8 8 0 1 0 11.4 0',
  stop: 'M8.2 3h7.6L21 8.2v7.6L15.8 21H8.2L3 15.8V8.2zM9.5 9.5l5 5M14.5 9.5l-5 5',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  send: 'M4 12l16-8-6 16-2.5-6.5z',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM6 11a6 6 0 0 0 12 0M12 17v4M9 21h6',
} as const;

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-[20px] border border-line bg-surface p-5 ${className}`}>
      {children}
    </div>
  );
}

export function SectionTitle({ children, count }: { children: ReactNode; count?: number }) {
  return (
    <div className="flex items-center gap-3">
      <h2 className="text-xl font-bold">{children}</h2>
      {count !== undefined && (
        <span className="tnum inline-flex h-[26px] min-w-[26px] items-center justify-center rounded-full bg-ink px-2 text-[13px] font-bold text-bg">
          {count}
        </span>
      )}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-[20px] border border-dashed border-line-strong bg-surface p-6">
      <p className="font-bold">{title}</p>
      {children && <p className="text-ink-2">{children}</p>}
    </div>
  );
}

export const btn =
  'inline-flex h-12 items-center justify-center gap-1.5 rounded-xl px-4 font-semibold cursor-pointer disabled:cursor-not-allowed disabled:opacity-50';
export const btnPrimary = `${btn} bg-primary text-on-primary hover:bg-primary-hover`;
export const btnGhost = `${btn} border border-line-strong bg-surface hover:bg-sunken`;
