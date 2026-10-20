import { eq } from 'drizzle-orm';
import type { BusinessConfig } from '@myna/shared';
import { SqliteSchedulingAdapter } from '../adapters/sqlite.js';
import type { SchedulingAdapter } from '../adapters/types.js';
import type { Db } from '../db/client.js';
import { clinicSettings } from '../db/schema.js';

export interface ClinicEntry {
  config: BusinessConfig;
  adapter: SchedulingAdapter;
}

/**
 * Clinics this API serves: loaded from YAML at start, plus Hawk's throwaway tenants. Settings
 * changed on the dashboard (the kill switch) override the YAML and survive restarts.
 */
export class ClinicRegistry {
  private readonly entries = new Map<string, ClinicEntry>();

  constructor(
    private readonly db: Db,
    configs: Iterable<BusinessConfig> = [],
    /** Chooses each clinic's schedule store. Default: the built-in SQLite one. */
    private readonly makeAdapter?: (config: BusinessConfig) => SchedulingAdapter | undefined,
  ) {
    for (const c of configs) this.add(c);
  }

  add(config: BusinessConfig): ClinicEntry {
    const adapter = this.makeAdapter?.(config) ?? new SqliteSchedulingAdapter(this.db, config);
    const entry = { config, adapter };
    this.entries.set(config.id, entry);
    return entry;
  }

  get(clinicId: string): ClinicEntry | undefined {
    return this.entries.get(clinicId);
  }

  /** Re-applies dashboard overrides saved in the database. */
  async loadOverrides(): Promise<void> {
    for (const row of await this.db.select().from(clinicSettings)) {
      const entry = this.entries.get(row.clinicId);
      if (entry && row.killSwitch !== null) {
        this.add({ ...entry.config, killSwitch: row.killSwitch });
      }
    }
  }

  /**
   * Re-reads one clinic's dashboard override from the database. Another API instance changed it
   * (we were told over the config bus), and this instance must not keep answering with the old
   * value: for the kill switch that would mean taking calls the clinic has turned off.
   */
  async refresh(clinicId: string): Promise<void> {
    const entry = this.entries.get(clinicId);
    if (!entry) return;
    const [row] = await this.db
      .select()
      .from(clinicSettings)
      .where(eq(clinicSettings.clinicId, clinicId));
    if (row && row.killSwitch !== null && row.killSwitch !== entry.config.killSwitch) {
      this.add({ ...entry.config, killSwitch: row.killSwitch });
    }
  }

  /** Re-reads every clinic's override: the backstop if an announcement was missed. */
  async refreshAll(): Promise<void> {
    for (const clinicId of this.entries.keys()) await this.refresh(clinicId);
  }

  async setKillSwitch(clinicId: string, on: boolean): Promise<BusinessConfig> {
    const entry = this.entries.get(clinicId);
    if (!entry) throw new Error(`unknown clinic ${clinicId}`);
    const values = {
      clinicId,
      tenantId: entry.config.tenantId,
      killSwitch: on,
      updatedAt: new Date().toISOString(),
    };
    await this.db
      .insert(clinicSettings)
      .values(values)
      .onConflictDoUpdate({ target: clinicSettings.clinicId, set: values });
    return this.add({ ...entry.config, killSwitch: on }).config;
  }

  async clearOverrides(clinicId: string): Promise<void> {
    await this.db.delete(clinicSettings).where(eq(clinicSettings.clinicId, clinicId));
  }
}
