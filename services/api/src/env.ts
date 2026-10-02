import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** Loads the repo's `.env` if there is one; real environment variables win. */
export function loadDotEnv(): void {
  const file = resolve(REPO_ROOT, '.env');
  if (existsSync(file)) process.loadEnvFile(file);
}

const Env = z.object({
  API_HOST: z.string().default('127.0.0.1'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_PATH: z.string().default('services/api/data/myna.db'),
  CLINICS_DIR: z.string().default('clinics'),
  AGENT_API_TOKEN: z.string().min(12, 'set AGENT_API_TOKEN (12+ characters) in .env'),
  LOG_LEVEL: z.string().default('info'),
});
export type Env = z.infer<typeof Env>;

export function readEnv(source: NodeJS.ProcessEnv = process.env) {
  const env = Env.parse(source);
  const dbFile = resolve(REPO_ROOT, env.DATABASE_PATH);
  mkdirSync(dirname(dbFile), { recursive: true });
  return {
    ...env,
    databaseUrl: `file:${dbFile.replace(/\\/g, '/')}`,
    clinicsDir: resolve(REPO_ROOT, env.CLINICS_DIR),
  };
}
