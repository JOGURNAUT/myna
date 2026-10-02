import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { and, eq } from 'drizzle-orm';
import { addDays, type BusinessConfig, nowIn, splitDateTime } from '@myna/shared';
import { SqliteSchedulingAdapter } from './adapters/sqlite.js';
import { loadClinics, registerClinics } from './clinics.js';
import { type Db, openDb } from './db/client.js';
import { patients } from './db/schema.js';
import { loadDotEnv, readEnv } from './env.js';

/**
 * Synthetic patients only — never real data (CLAUDE.md, pilot data rules).
 * Meera and Kavya share a family phone, as is common: name + phone still tells them apart.
 */
export const DEMO_PATIENTS = [
  { name: 'Pooja Malhotra', phone: '9811100733', dob: '1990-04-12', booking: 'cleaning' },
  { name: 'Arjun Verma', phone: '9911100487', dob: '1985-11-02', booking: 'consultation' },
  { name: 'Sunita Sharma', phone: '9811100210', dob: '1972-07-19', booking: null },
  { name: 'Rahul Gupta', phone: '9311100816', dob: '1995-01-30', booking: 'root-canal' },
  { name: 'Meera Nair', phone: '9711100318', dob: '1988-03-08', booking: null },
  { name: 'Kavya Nair', phone: '9711100318', dob: '2015-09-21', booking: 'braces-review' },
] as const;

/** Seeds demo patients and one upcoming appointment each (where set). Skips if already seeded. */
export async function seedDemo(
  db: Db,
  config: BusinessConfig,
  now: Date = new Date(),
): Promise<number> {
  const existing = await db
    .select({ id: patients.id })
    .from(patients)
    .where(and(eq(patients.tenantId, config.tenantId), eq(patients.phone, DEMO_PATIENTS[0].phone)));
  if (existing.length > 0) return 0;

  const adapter = new SqliteSchedulingAdapter(db, config);
  const localNow = nowIn(config.timezone, now);
  const today = splitDateTime(localNow).date;
  let offsetDays = 3;

  for (const p of DEMO_PATIENTS) {
    const patient = await adapter.createPatient(p);
    if (!p.booking) continue;
    const from = addDays(today, offsetDays);
    const [slot] = await adapter.listSlots(
      {
        serviceId: p.booking,
        dateFrom: from,
        dateTo: addDays(from, 7),
        limit: 1,
        partOfDay: 'morning',
      },
      localNow,
    );
    if (slot) {
      await adapter.book({
        idempotencyKey: `seed-${randomUUID()}`,
        patientId: patient.id,
        resourceId: slot.resourceId,
        serviceId: slot.serviceId,
        start: slot.start,
        end: slot.end,
        source: 'seed',
      });
    }
    offsetDays += 1;
  }
  return DEMO_PATIENTS.length;
}

// `pnpm db:seed`
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  loadDotEnv();
  const env = readEnv();
  const { db, close } = await openDb(env.databaseUrl);
  const clinics = await loadClinics(env.clinicsDir);
  await registerClinics(db, clinics.values());
  for (const cfg of clinics.values()) {
    const n = await seedDemo(db, cfg);
    console.log(
      n > 0 ? `seeded ${n} synthetic patients for ${cfg.id}` : `${cfg.id} already seeded`,
    );
  }
  close();
}
