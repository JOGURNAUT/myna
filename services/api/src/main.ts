import { loadClinics, registerClinics } from './clinics.js';
import { openDb } from './db/client.js';
import { loadDotEnv, readEnv } from './env.js';
import { buildApp } from './http/app.js';
import { seedDemo } from './seed.js';

loadDotEnv();

const env = readEnv();

/**
 * Tests and Hawk pin the clock so runs are reproducible: MYNA_FAKE_NOW=2026-10-12T03:30:00Z.
 * Never honoured in production.
 */
const fakeNow = process.env.MYNA_FAKE_NOW;
if (fakeNow && process.env.NODE_ENV === 'production') {
  throw new Error('MYNA_FAKE_NOW is not allowed in production');
}
const pinned = fakeNow ? new Date(fakeNow) : null;
if (pinned && Number.isNaN(pinned.getTime())) throw new Error(`bad MYNA_FAKE_NOW: ${fakeNow}`);
const clock = () => pinned ?? new Date();
const { db, close } = await openDb(env.databaseUrl);
const clinics = await loadClinics(env.clinicsDir);
await registerClinics(db, clinics.values());
if (process.env.SEED_DEMO === '1') {
  for (const cfg of clinics.values()) await seedDemo(db, cfg, clock());
}

const hawk = process.env.HAWK_ENABLED === '1';
if (hawk && process.env.NODE_ENV === 'production') {
  throw new Error('HAWK_ENABLED is not allowed in production');
}

const app = await buildApp({
  db,
  clinics,
  agentToken: env.AGENT_API_TOKEN,
  logger: true,
  clock,
  hawk,
});

const shutdown = async () => {
  await app.close();
  close();
};
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());

await app.listen({ host: env.API_HOST, port: env.API_PORT });
app.log.info({ clinics: [...clinics.keys()] }, 'myna api ready');
