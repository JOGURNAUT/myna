import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

/**
 * Server-side calls to the Myna API. The browser never sees the API or agent URLs, and the staff
 * session token lives in an HTTP-only cookie, so no script on the page can read it.
 */
export const API_URL = process.env.API_URL ?? 'http://127.0.0.1:4000';
export const AGENT_URL = process.env.AGENT_URL ?? 'http://127.0.0.1:8000';
export const DEMO_CLINIC = process.env.DEMO_CLINIC ?? 'smile-dental';
export const SESSION_COOKIE = 'myna_session';

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new ApiError(503, 'UNAVAILABLE', 'The Myna service is not reachable right now.');
  }
  const body = (await res.json().catch(() => null)) as Envelope<T> | null;
  if (!res.ok || !body?.ok) {
    throw new ApiError(
      res.status,
      body?.error?.code ?? 'INTERNAL',
      body?.error?.message ?? 'Something went wrong.',
    );
  }
  return body.data as T;
}

export const publicApi = <T>(path: string) => request<T>(`/v1/public${path}`);

/** A signed-in staff call. No session, or an expired one, sends the user to sign in. */
export async function staffApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) redirect('/login');
  try {
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${token}`);
    if (init.body) headers.set('content-type', 'application/json');
    return await request<T>(`/v1/staff${path}`, { ...init, headers });
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) redirect('/login?expired=1');
    throw e;
  }
}

export function login(clinicId: string, password: string) {
  return request<{ token: string; clinicId: string; expiresAt: string }>('/v1/staff/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clinicId, password }),
  });
}

export async function agentCall<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${AGENT_URL}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new ApiError(503, 'UNAVAILABLE', 'Myna is not reachable right now.');
  }
  if (!res.ok) throw new ApiError(res.status, 'AGENT', `Myna is unavailable (${res.status}).`);
  return (await res.json()) as T;
}
