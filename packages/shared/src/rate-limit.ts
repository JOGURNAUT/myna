/**
 * Rate limiting that still works when there are several instances.
 *
 * A per-process Map lets N instances allow N× the limit (and lets a login lock-out be dodged by
 * hitting another instance). The Redis implementation keeps the counter in one place.
 *
 * Fixed window: the first hit starts a window of `windowMs`; hits inside it are counted; the key
 * expires on its own. (A burst straddling a window edge can reach 2× the limit: fine for
 * lock-outs and abuse control, which is what this is for.)
 *
 * Imported as `@myna/shared/rate-limit` so the web app doesn't pull in the config loader.
 */

/** The one Redis command we need. ioredis (and ioredis-mock) satisfy it structurally. */
export interface RedisLike {
  eval(script: string, numKeys: number, ...args: string[]): Promise<unknown>;
}

export interface RateLimiter {
  /** Counts one event for `key` and returns how many there are in the current window. */
  hit(key: string, windowMs: number): Promise<number>;
  /** How many events are in the current window, without counting a new one. */
  count(key: string): Promise<number>;
  reset(key: string): Promise<void>;
}

export class MemoryRateLimiter implements RateLimiter {
  private readonly windows = new Map<string, { count: number; expiresAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  hit(key: string, windowMs: number): Promise<number> {
    const current = this.live(key);
    const next = current
      ? { count: current.count + 1, expiresAt: current.expiresAt }
      : { count: 1, expiresAt: this.now() + windowMs };
    this.windows.set(key, next);
    return Promise.resolve(next.count);
  }

  count(key: string): Promise<number> {
    return Promise.resolve(this.live(key)?.count ?? 0);
  }

  reset(key: string): Promise<void> {
    this.windows.delete(key);
    return Promise.resolve();
  }

  private live(key: string) {
    const w = this.windows.get(key);
    if (w && w.expiresAt <= this.now()) {
      this.windows.delete(key);
      return undefined;
    }
    return w;
  }
}

// INCR and PEXPIRE must be one atomic step: if we crashed between them the key would never expire.
const HIT = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return n`;
const COUNT = `return tonumber(redis.call('GET', KEYS[1]) or '0')`;
const RESET = `return redis.call('DEL', KEYS[1])`;

export class RedisRateLimiter implements RateLimiter {
  constructor(
    private readonly redis: RedisLike,
    private readonly prefix = 'myna:rl:',
  ) {}

  async hit(key: string, windowMs: number): Promise<number> {
    return Number(await this.redis.eval(HIT, 1, this.prefix + key, String(windowMs)));
  }

  async count(key: string): Promise<number> {
    return Number(await this.redis.eval(COUNT, 1, this.prefix + key));
  }

  async reset(key: string): Promise<void> {
    await this.redis.eval(RESET, 1, this.prefix + key);
  }
}

/**
 * Redis if it answers, this process's memory if it doesn't. A limiter that took the site down
 * with Redis would be worse than the abuse it prevents; per-instance limits are the safe floor.
 */
export class FallbackRateLimiter implements RateLimiter {
  constructor(
    private readonly primary: RateLimiter,
    private readonly fallback: RateLimiter,
    private readonly onError: (e: unknown) => void = () => undefined,
  ) {}

  hit(key: string, windowMs: number): Promise<number> {
    return this.guard(
      () => this.primary.hit(key, windowMs),
      () => this.fallback.hit(key, windowMs),
    );
  }

  count(key: string): Promise<number> {
    return this.guard(
      () => this.primary.count(key),
      () => this.fallback.count(key),
    );
  }

  async reset(key: string): Promise<void> {
    await this.fallback.reset(key);
    await this.guard(
      () => this.primary.reset(key),
      () => Promise.resolve(),
    );
  }

  private async guard<T>(primary: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
    try {
      return await primary();
    } catch (e) {
      this.onError(e);
      return fallback();
    }
  }
}
