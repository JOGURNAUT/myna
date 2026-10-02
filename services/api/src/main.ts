import { loadClinics, registerClinics } from './clinics.js';
import { openDb } from './db/client.js';
import { loadDotEnv, readEnv } from './env.js';
import { buildApp } from './http/app.js';
import { seedDemo } from './seed.js';

loadDotEnv();

const env = readEnv();
const { db, close } = await openDb(env.databaseUrl);
const clinics = await loadClinics(env.clinicsDir);
await registerClinics(db, clinics.values());
if (process.env.SEED_DEMO === '1') {
  for (const cfg of clinics.values()) await seedDemo(db, cfg);
}

const app = await buildApp({ db, clinics, agentToken: env.AGENT_API_TOKEN, logger: true });

const shutdown = async () => {
  await app.close();
  close();
};
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());

await app.listen({ host: env.API_HOST, port: env.API_PORT });
app.log.info({ clinics: [...clinics.keys()] }, 'myna api ready');
