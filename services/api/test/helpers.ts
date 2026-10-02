import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { type BusinessConfig, loadBusinessConfig } from '@myna/shared';
import { registerClinics } from '../src/clinics.js';
import { type Db, openDb } from '../src/db/client.js';

export const CLINIC_FILE = resolve(import.meta.dirname, '../../../clinics/smile-dental.yaml');

/** Monday 12 Oct 2026, 09:00 IST. Dr. Mehta works Mon mornings; Dr. Rao only Mon evenings. */
export const NOW = new Date('2026-10-12T03:30:00Z');

export const loadDemoConfig = (): Promise<BusinessConfig> => loadBusinessConfig(CLINIC_FILE);

export interface TestDb {
  db: Db;
  cleanup: () => void;
}

/** A fresh, migrated SQLite file per test (in-memory DBs don't survive libsql transactions). */
export async function makeTestDb(configs: BusinessConfig[] = []): Promise<TestDb> {
  const dir = mkdtempSync(join(tmpdir(), 'myna-test-'));
  const file = join(dir, 'test.db').replace(/\\/g, '/');
  const { db, close } = await openDb(`file:${file}`);
  await registerClinics(db, configs);
  return {
    db,
    cleanup: () => {
      close();
      // Best effort: on Windows libsql can hold the file a little after close().
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* left in the OS temp dir */
      }
    },
  };
}

export function withTenant(
  config: BusinessConfig,
  tenantId: string,
  id = tenantId,
): BusinessConfig {
  return { ...config, id, tenantId };
}
