'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ApiError, login, SESSION_COOKIE } from '@/lib/api';

export async function signIn(_prev: { error: string; clinicId: string } | null, form: FormData) {
  const field = (name: string) => {
    const value = form.get(name);
    return typeof value === 'string' ? value : '';
  };
  const clinicId = field('clinicId').trim();
  const password = field('password');
  if (!clinicId || !password) return { error: 'Enter your clinic ID and password.', clinicId };

  try {
    const session = await login(clinicId, password);
    (await cookies()).set(SESSION_COOKIE, session.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      expires: new Date(session.expiresAt),
    });
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      return {
        error: e.message.includes('too many')
          ? e.message
          : 'That clinic ID and password don’t match. Check both and try again.',
        clinicId,
      };
    }
    return { error: 'Sign-in isn’t available right now. Try again in a minute.', clinicId };
  }
  redirect('/dashboard');
}

export async function signOut() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect('/login');
}
