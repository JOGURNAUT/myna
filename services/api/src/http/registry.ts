import type { BusinessConfig } from '@myna/shared';
import { SqliteSchedulingAdapter } from '../adapters/sqlite.js';
import type { SchedulingAdapter } from '../adapters/types.js';
import type { Db } from '../db/client.js';

export interface ClinicEntry {
  config: BusinessConfig;
  adapter: SchedulingAdapter;
}

/** Clinics this API serves: loaded from YAML at start, plus Hawk's throwaway tenants. */
export class ClinicRegistry {
  private readonly entries = new Map<string, ClinicEntry>();

  constructor(
    private readonly db: Db,
    configs: Iterable<BusinessConfig> = [],
  ) {
    for (const c of configs) this.add(c);
  }

  add(config: BusinessConfig): ClinicEntry {
    const entry = { config, adapter: new SqliteSchedulingAdapter(this.db, config) };
    this.entries.set(config.id, entry);
    return entry;
  }

  get(clinicId: string): ClinicEntry | undefined {
    return this.entries.get(clinicId);
  }
}
