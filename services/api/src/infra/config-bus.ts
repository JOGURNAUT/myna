import type { Redis } from 'ioredis';

/**
 * "Clinic X's settings changed." With several API instances each keeps its clinics in memory, so
 * the instance that handled a change tells the others. Safety-critical case: the kill switch.
 *
 * Without Redis there is one instance and nothing to tell (the default no-op bus).
 */
export interface ConfigBus {
  /** Announces the change to every instance and drops shared caches of that clinic's config. */
  publish(clinicId: string): Promise<void>;
  /** Calls `handler` for every announcement from any instance (including this one). */
  subscribe(handler: (clinicId: string) => Promise<void> | void): Promise<() => Promise<void>>;
}

export const noConfigBus: ConfigBus = {
  publish: () => Promise.resolve(),
  subscribe: () => Promise.resolve(() => Promise.resolve()),
};

const CHANNEL = 'myna:config-changed';
/** The agent caches configs under this key; see services/agent config_cache.py. */
export const configCacheKey = (clinicId: string) => `myna:config:${clinicId}`;

export class RedisConfigBus implements ConfigBus {
  constructor(
    private readonly redis: Redis,
    private readonly onError: (e: unknown) => void = () => undefined,
  ) {}

  async publish(clinicId: string): Promise<void> {
    // DEL first: a reader that misses the message still can't be served the old config.
    await this.redis.del(configCacheKey(clinicId));
    await this.redis.publish(CHANNEL, clinicId);
  }

  subscribe(handler: (clinicId: string) => Promise<void> | void): Promise<() => Promise<void>> {
    // The publisher fails fast (no offline queue) so a request never hangs on a dead Redis. The
    // subscriber is the opposite: it is set up once at startup, possibly before the connection
    // is open, so it must queue the SUBSCRIBE and re-subscribe by itself after any reconnect.
    const sub = this.redis.duplicate({ enableOfflineQueue: true, maxRetriesPerRequest: null });
    sub.on('error', this.onError);
    sub.on('message', (_channel: string, clinicId: string) => {
      Promise.resolve(handler(clinicId)).catch(this.onError);
    });
    // A Redis that is down at startup must not stop the API from starting: it keeps retrying in
    // the background and the app serves in the meantime. Missed announcements are caught by the
    // periodic re-read in app.ts (the backstop for the kill switch).
    sub.subscribe(CHANNEL).catch(this.onError);
    return Promise.resolve(async () => {
      await sub.quit().catch(() => undefined);
    });
  }
}
