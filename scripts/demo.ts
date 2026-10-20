import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hashPassword } from '../services/api/src/core/staff-auth.js';

/**
 * `pnpm demo` — the whole product on your laptop:
 *   API :4000 (seeded demo clinic) · agent :8000 (real Sarvam model if SARVAM_API_KEY is set,
 *   otherwise the offline rules) · web :3000.
 * Open http://localhost:3000. Ctrl+C stops everything.
 */

const ROOT = resolve(import.meta.dirname, '..');
const env = readEnvFile(resolve(ROOT, '.env'));
const hasKey = Boolean(env.SARVAM_API_KEY);
const token = env.AGENT_API_TOKEN ?? 'demo-agent-token-change-me-123';
const password = 'demo-password-123';
const secret = 'demo-session-secret-0123456789-abcdefghij';

function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m?.[1] && m[2] !== undefined) out[m[1]] = m[2];
  }
  return out;
}

const children: ChildProcess[] = [];
function run(name: string, cmd: string, args: string[], cwd: string, extra: NodeJS.ProcessEnv) {
  const proc = spawn(cmd, args, {
    cwd,
    env: { ...process.env, ...extra },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const tag = `[${name}]`;
  const out = (d: Buffer) => {
    for (const l of d.toString().split(/\r?\n/)) {
      if (l.trim() && !l.includes('"incoming request"') && !l.includes('"request completed"')) {
        console.log(`${tag} ${l.slice(0, 160)}`);
      }
    }
  };
  proc.stdout.on('data', out);
  proc.stderr.on('data', out);
  children.push(proc);
}

function stopAll() {
  for (const p of children) {
    if (p.pid === undefined || p.exitCode !== null) continue;
    if (process.platform === 'win32')
      spawnSync('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
    else p.kill('SIGTERM');
  }
}
process.on('SIGINT', () => {
  stopAll();
  process.exit(0);
});
process.on('exit', stopAll);

async function waitFor(url: string, label: string) {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${label} did not start (${url})`);
}

mkdirSync(resolve(ROOT, 'services/api/data'), { recursive: true });
const login = `smile-dental=${hashPassword(password)}`;

run('api', process.execPath, ['--import', 'tsx', 'src/main.ts'], resolve(ROOT, 'services/api'), {
  AGENT_API_TOKEN: token,
  API_PORT: '4000',
  DATABASE_PATH: 'services/api/data/demo.db',
  SEED_DEMO: '1',
  STAFF_SESSION_SECRET: secret,
  CLINIC_LOGINS: login,
});
run('agent', 'uv', ['run', 'myna-agent'], resolve(ROOT, 'services/agent'), {
  AGENT_API_TOKEN: token,
  API_BASE_URL: 'http://127.0.0.1:4000',
  AGENT_PORT: '8000',
  LLM_PROVIDER: hasKey ? 'sarvam' : 'rules',
  SARVAM_MODEL: 'sarvam-105b-conversations',
  UV_LINK_MODE: 'copy',
});
run(
  'web',
  process.execPath,
  [resolve(ROOT, 'apps/web/node_modules/next/dist/bin/next'), 'dev', '-p', '3000'],
  resolve(ROOT, 'apps/web'),
  {
    API_URL: 'http://127.0.0.1:4000',
    AGENT_URL: 'http://127.0.0.1:8000',
  },
);

await waitFor('http://127.0.0.1:4000/health', 'API');
await waitFor('http://127.0.0.1:8000/health', 'agent');

// A Hawk report to look at on /hawk (the real-model run if it exists).
const reportFile = ['run-04-live-final.json', 'run-02-after-fixes.json']
  .map((f) => resolve(ROOT, 'docs/reports', f))
  .find((f) => existsSync(f));
if (reportFile) {
  await fetch('http://127.0.0.1:4000/v1/clinics/smile-dental/reports', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: readFileSync(reportFile, 'utf8'),
  });
}
await waitFor('http://127.0.0.1:3000', 'web');

console.log(`
  ──────────────────────────────────────────────────────────────
   Myna demo is running  ·  understanding: ${hasKey ? 'REAL Sarvam model (sarvam-105b-conversations)' : 'offline rules (add SARVAM_API_KEY for the real model)'}

   Talk to Myna (public)   http://localhost:3000
   Hawk go-live report     http://localhost:3000/hawk
   Clinic dashboard        http://localhost:3000/login
                           clinic ID: smile-dental   password: ${password}

   Try:  "Mujhe cleaning ka appointment chahiye kal subah"
         then watch the booking land on the schedule, and appear
         on the dashboard as a "Test call" you can review.
   Ctrl+C stops everything.
  ──────────────────────────────────────────────────────────────
`);
await new Promise(() => undefined);
