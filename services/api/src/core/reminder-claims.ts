import type { RedisLike } from '@myna/shared/rate-limit';

/**
 * "I am about to call this patient." Two reminder workers must never ring the same person, so a
 * worker claims an appointment first and only the winner dials.
 *
 * The claim expires by itself (a crashed worker doesn't block the reminder forever) and can only
 * be released by whoever holds it.
 */
export interface ReminderClaims {
  /** True iff this worker now holds the claim. Never throws: if unsure, the answer is false. */
  claim(tenantId: string, appointmentId: string, worker: string, ttlMs: number): Promise<boolean>;
  /** Releases the claim if `worker` still holds it. */
  release(tenantId: string, appointmentId: string, worker: string): Promise<void>;
}

export class MemoryReminderClaims implements ReminderClaims {
  private readonly held = new Map<string, { worker: string; expiresAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  claim(tenantId: string, appointmentId: string, worker: string, ttlMs: number): Promise<boolean> {
    const key = `${tenantId}:${appointmentId}`;
    const current = this.held.get(key);
    if (current && current.expiresAt > this.now()) return Promise.resolve(false);
    this.held.set(key, { worker, expiresAt: this.now() + ttlMs });
    return Promise.resolve(true);
  }

  release(tenantId: string, appointmentId: string, worker: string): Promise<void> {
    const key = `${tenantId}:${appointmentId}`;
    if (this.held.get(key)?.worker === worker) this.held.delete(key);
    return Promise.resolve();
  }
}

const CLAIM = `return redis.call('SET', KEYS[1], ARGV[1], 'NX', 'PX', ARGV[2])`;
const RELEASE = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0`;

export class RedisReminderClaims implements ReminderClaims {
  constructor(
    private readonly redis: RedisLike,
    private readonly onError: (e: unknown) => void = () => undefined,
  ) {}

  private key(tenantId: string, appointmentId: string): string {
    return `myna:claim:${tenantId}:${appointmentId}`;
  }

  async claim(
    tenantId: string,
    appointmentId: string,
    worker: string,
    ttlMs: number,
  ): Promise<boolean> {
    try {
      const won = await this.redis.eval(
        CLAIM,
        1,
        this.key(tenantId, appointmentId),
        worker,
        String(ttlMs),
      );
      return won === 'OK';
    } catch (e) {
      // Fail safe: a missed reminder is better than a patient rung twice.
      this.onError(e);
      return false;
    }
  }

  async release(tenantId: string, appointmentId: string, worker: string): Promise<void> {
    try {
      await this.redis.eval(RELEASE, 1, this.key(tenantId, appointmentId), worker);
    } catch (e) {
      this.onError(e); // the claim expires by itself
    }
  }
}
