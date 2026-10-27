'use client';

import { useActionState, useState } from 'react';
import { btnPrimary, Icon, ICONS } from '@/components/ui';
import { signIn } from './actions';

export function LoginForm() {
  const [state, action, pending] = useActionState(signIn, null);
  const [show, setShow] = useState(false);
  return (
    <form action={action} className="flex flex-col gap-5">
      {state?.error && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-xl bg-danger-soft px-4 py-3 font-semibold text-danger-ink"
        >
          <Icon d={ICONS.warn} size={20} />
          {state.error}
        </p>
      )}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="clinicId" className="text-sm font-semibold">
          Clinic ID
        </label>
        <input
          key={state?.clinicId ?? ''}
          id="clinicId"
          name="clinicId"
          defaultValue={state?.clinicId ?? ''}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          className="h-[52px] rounded-xl border border-line-strong bg-surface px-4 text-base"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-sm font-semibold">
          Password
        </label>
        <div className="relative flex">
          <input
            id="password"
            name="password"
            type={show ? 'text' : 'password'}
            autoComplete="current-password"
            required
            className="h-[52px] min-w-0 flex-1 rounded-xl border border-line-strong bg-surface pr-20 pl-4 text-base"
          />
          <button
            type="button"
            aria-pressed={show}
            onClick={() => {
              setShow((s) => !s);
            }}
            className="absolute top-1 right-1 h-11 rounded-lg px-3 text-sm font-semibold text-primary-ink"
          >
            {show ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>
      <button type="submit" disabled={pending} className={`${btnPrimary} h-[52px]`}>
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
