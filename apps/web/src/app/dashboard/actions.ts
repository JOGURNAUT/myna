'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, staffApi } from '@/lib/api';

const refresh = () => {
  revalidatePath('/dashboard', 'layout');
};
const id = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

export async function markTaskDone(form: FormData) {
  await staffApi(`/tasks/${id(form, 'id')}/done`, { method: 'POST' });
  refresh();
}

export async function approveBooking(form: FormData) {
  await staffApi(`/pending/${id(form, 'id')}/approve`, { method: 'POST' });
  refresh();
}

export async function rejectBooking(form: FormData) {
  await staffApi(`/pending/${id(form, 'id')}/reject`, { method: 'POST' });
  refresh();
}

export async function markHandoffSeen(form: FormData) {
  await staffApi(`/calls/${id(form, 'id')}/handoff-seen`, { method: 'POST' });
  refresh();
}

export async function setKillSwitch(form: FormData) {
  await staffApi('/kill-switch', {
    method: 'PUT',
    body: JSON.stringify({ on: id(form, 'on') === 'true' }),
  });
  refresh();
}

export async function saveLabel(
  _prev: { error?: string; saved?: boolean } | null,
  form: FormData,
): Promise<{ error?: string; saved?: boolean }> {
  const correct = id(form, 'correct');
  if (correct !== 'yes' && correct !== 'no') return { error: 'Pick yes or no to save.' };
  const failureType = id(form, 'failureType');
  if (correct === 'no' && !failureType) return { error: 'Pick what went wrong.' };
  try {
    await staffApi(`/calls/${id(form, 'callId')}/label`, {
      method: 'PUT',
      body: JSON.stringify({
        correct: correct === 'yes',
        ...(correct === 'no' ? { failureType } : {}),
        notes: id(form, 'notes') || undefined,
      }),
    });
  } catch (e) {
    return { error: e instanceof ApiError ? e.message : 'Could not save. Try again.' };
  }
  refresh();
  return { saved: true };
}
