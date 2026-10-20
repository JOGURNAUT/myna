import type { RedisLike } from '@myna/shared/rate-limit';
import type { BusinessConfig } from '@myna/shared';
import { SheetsSchedulingAdapter } from '../adapters/sheets/adapter.js';
import {
  GoogleSheetsClient,
  type ServiceAccount,
  type SheetsClient,
} from '../adapters/sheets/client.js';
import { InProcessMutex, type Mutex, RedisMutex } from '../adapters/sheets/mutex.js';
import type { SchedulingAdapter } from '../adapters/types.js';

/** Parses GOOGLE_SERVICE_ACCOUNT_JSON (a secret: env / Secret Manager, never config or git). */
export function parseServiceAccount(json: string | undefined): ServiceAccount | undefined {
  if (!json) return undefined;
  const parsed = JSON.parse(json) as Partial<ServiceAccount>;
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON needs client_email and private_key');
  }
  return { client_email: parsed.client_email, private_key: parsed.private_key };
}

/**
 * Picks each clinic's schedule store. The Sheets client and its write lock are created ONCE per
 * clinic and shared: the registry rebuilds adapters whenever settings change (the kill switch),
 * and a fresh lock each time would let two bookings through together.
 */
export class ScheduleStores {
  private readonly sheets = new Map<string, { client: SheetsClient; mutex: Mutex }>();

  constructor(
    private readonly account: ServiceAccount | undefined,
    private readonly redis?: RedisLike,
    private readonly makeClient: (
      spreadsheetId: string,
      account: ServiceAccount,
    ) => SheetsClient = (id, acct) => new GoogleSheetsClient(id, acct),
  ) {}

  /** The adapter for a clinic, or undefined to use the built-in SQLite store. */
  adapterFor(config: BusinessConfig): SchedulingAdapter | undefined {
    const store = config.scheduleStore;
    if (store.backend !== 'gsheets') return undefined;
    const shared = this.shared(config);
    return new SheetsSchedulingAdapter(shared.client, config, shared.mutex);
  }

  /** Fails fast at startup (missing credentials, unreachable sheet) instead of on the first call. */
  async prepare(configs: Iterable<BusinessConfig>): Promise<void> {
    for (const config of configs) {
      if (config.scheduleStore.backend !== 'gsheets') continue;
      await this.shared(config).client.ensureHeaders();
    }
  }

  private shared(config: BusinessConfig): { client: SheetsClient; mutex: Mutex } {
    const existing = this.sheets.get(config.id);
    if (existing) return existing;
    const id = config.scheduleStore.spreadsheetId;
    if (!id) throw new Error(`${config.id}: gsheets needs scheduleStore.spreadsheetId`);
    if (!this.account) {
      throw new Error(`${config.id} uses Google Sheets: set GOOGLE_SERVICE_ACCOUNT_JSON`);
    }
    const created = {
      client: this.makeClient(id, this.account),
      mutex: this.redis
        ? new RedisMutex(this.redis, `myna:schedule-lock:${config.tenantId}`)
        : new InProcessMutex(),
    };
    this.sheets.set(config.id, created);
    return created;
  }
}
