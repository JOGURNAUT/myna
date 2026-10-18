'use client';

import { useActionState, useState } from 'react';
import { btnPrimary, Icon, ICONS } from '@/components/ui';
import { FAILURE_TYPES } from '@/lib/format';
import type { CallDetail } from '@/lib/types';
import { saveLabel } from '../../actions';

export function LabelForm({ callId, saved }: { callId: string; saved: CallDetail['label'] }) {
  const [state, action, pending] = useActionState(saveLabel, null);
  const [correct, setCorrect] = useState<'yes' | 'no' | null>(
    saved ? (saved.correct ? 'yes' : 'no') : null,
  );

  return (
    <form
      action={action}
      className="flex flex-col gap-4 rounded-[20px] border border-line bg-surface p-5"
    >
      <input type="hidden" name="callId" value={callId} />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold">Was the outcome correct?</legend>
        <div className="grid grid-cols-2 gap-2.5">
          {(
            [
              ['yes', 'Yes, correct'],
              ['no', 'No, something’s wrong'],
            ] as const
          ).map(([v, label]) => (
            <label
              key={v}
              className={`flex h-12 cursor-pointer items-center justify-center rounded-xl border-2 px-3 text-center font-semibold has-focus-visible:outline-2 has-focus-visible:outline-accent ${
                correct === v
                  ? v === 'yes'
                    ? 'border-safe-ink bg-safe-soft text-safe-ink'
                    : 'border-danger-ink bg-danger-soft text-danger-ink'
                  : 'border-line-strong bg-surface'
              }`}
            >
              <input
                type="radio"
                name="correct"
                value={v}
                checked={correct === v}
                onChange={() => {
                  setCorrect(v);
                }}
                className="sr-only"
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      {correct === 'no' && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="failureType" className="text-sm font-semibold">
            What went wrong?
          </label>
          <select
            id="failureType"
            name="failureType"
            defaultValue={saved?.failureType ?? ''}
            required
            className="h-12 rounded-xl border border-line-strong bg-surface px-3"
          >
            <option value="" disabled>
              Choose one…
            </option>
            {FAILURE_TYPES.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="notes" className="text-sm font-semibold">
          Notes <span className="font-normal text-ink-3">(optional)</span>
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          maxLength={1000}
          defaultValue={saved?.notes ?? ''}
          className="rounded-xl border border-line-strong bg-surface px-3 py-2"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending || correct === null} className={btnPrimary}>
          {pending ? 'Saving…' : saved ? 'Update review' : 'Save review'}
        </button>
        {correct === null && <span className="text-sm text-ink-3">Pick yes or no to save.</span>}
        {state?.error && (
          <span
            role="alert"
            className="flex items-center gap-1 text-sm font-semibold text-danger-ink"
          >
            <Icon d={ICONS.warn} size={16} /> {state.error}
          </span>
        )}
        {state?.saved && (
          <span
            role="status"
            className="flex items-center gap-1 text-sm font-semibold text-safe-ink"
          >
            <Icon d={ICONS.check} size={16} /> Saved
          </span>
        )}
      </div>
    </form>
  );
}
