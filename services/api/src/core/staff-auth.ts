import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Dashboard sign-in: one login per clinic (CLAUDE.md, web app). Passwords are stored as scrypt
 * hashes in env (`CLINIC_LOGINS=smile-dental=scrypt$…`); a session is an HMAC-signed token that
 * names one clinic and expires. Separate from the agent token on purpose: a staff session can
 * read and act on its own clinic's dashboard, never call the agent's tools, never see another
 * clinic.
 */

const KEY_LEN = 32;
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEY_LEN);
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64url');
  const actual = scryptSync(password, Buffer.from(saltB64, 'base64url'), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** `smile-dental=scrypt$..;other=scrypt$..` → clinicId → hash. */
export function parseClinicLogins(value: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const entry of (value ?? '').split(';')) {
    const i = entry.indexOf('=');
    if (i <= 0) continue;
    out.set(entry.slice(0, i).trim(), entry.slice(i + 1).trim());
  }
  return out;
}

const sign = (secret: string, payload: string) =>
  createHmac('sha256', secret).update(payload).digest('base64url');

export interface StaffSession {
  clinicId: string;
  expiresAt: number;
}

export function issueSession(
  secret: string,
  clinicId: string,
  now: number,
): { token: string; session: StaffSession } {
  const session = { clinicId, expiresAt: now + SESSION_TTL_MS };
  const payload = Buffer.from(JSON.stringify({ c: clinicId, e: session.expiresAt })).toString(
    'base64url',
  );
  return { token: `${payload}.${sign(secret, payload)}`, session };
}

export function verifySession(secret: string, token: string, now: number): StaffSession | null {
  const [payload, mac] = token.split('.');
  if (!payload || !mac) return null;
  const expected = Buffer.from(sign(secret, payload));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const { c, e } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      c: unknown;
      e: unknown;
    };
    if (typeof c !== 'string' || typeof e !== 'number' || e <= now) return null;
    return { clinicId: c, expiresAt: e };
  } catch {
    return null;
  }
}

/** At most `limit` failed logins per clinic per window. In-memory: one API process. */
export class LoginThrottle {
  private readonly failures = new Map<string, number[]>();

  constructor(
    private readonly limit = 5,
    private readonly windowMs = 15 * 60 * 1000,
  ) {}

  blocked(clinicId: string, now: number): boolean {
    const recent = (this.failures.get(clinicId) ?? []).filter((t) => now - t < this.windowMs);
    this.failures.set(clinicId, recent);
    return recent.length >= this.limit;
  }

  fail(clinicId: string, now: number): void {
    this.failures.set(clinicId, [...(this.failures.get(clinicId) ?? []), now]);
  }

  succeed(clinicId: string): void {
    this.failures.delete(clinicId);
  }
}
