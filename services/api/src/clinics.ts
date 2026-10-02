import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { type BusinessConfig, loadBusinessConfig } from '@myna/shared';
import type { Db } from './db/client.js';
import { clinics } from './db/schema.js';

/** Loads every `clinics/*.yaml`, failing fast on the first invalid file. */
export async function loadClinics(dir: string): Promise<Map<string, BusinessConfig>> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
  const out = new Map<string, BusinessConfig>();
  for (const file of files.sort()) {
    const cfg = await loadBusinessConfig(join(dir, file));
    if (out.has(cfg.id)) throw new Error(`duplicate clinic id "${cfg.id}" in ${file}`);
    out.set(cfg.id, cfg);
  }
  return out;
}

/** Makes sure each loaded clinic has a row (the config file stays the source of truth). */
export async function registerClinics(db: Db, configs: Iterable<BusinessConfig>): Promise<void> {
  for (const cfg of configs) {
    await db
      .insert(clinics)
      .values({ id: cfg.id, tenantId: cfg.tenantId, name: cfg.name })
      .onConflictDoUpdate({ target: clinics.id, set: { name: cfg.name, tenantId: cfg.tenantId } });
  }
}
