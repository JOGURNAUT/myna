import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Starts a private API + agent for one Hawk run: a temp database, a pinned clock, Hawk's test
 * routes on, and the chosen understanding provider. Nothing touches the dev database.
 */

export const REPO_ROOT = resolve(import.meta.dirname, '../..');

async function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      srv.close(() => {
        if (addr && typeof addr === 'object') ok(addr.port);
        else fail(new Error('no port'));
      });
    });
  });
}

async function waitHealthy(url: string, proc: ChildProcess, log: () => string): Promise<void> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (proc.exitCode !== null) throw new Error(`process exited early:\n${log()}`);
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${url}:\n${log()}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** `uv run` starts the agent as a child process; on Windows, kill() would orphan it. */
function killTree(proc: ChildProcess): void {
  if (proc.pid === undefined || proc.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    proc.kill('SIGTERM');
  }
}

function start(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) {
  const proc = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
  let output = '';
  proc.stdout.on('data', (d: Buffer) => (output = (output + d.toString()).slice(-8000)));
  proc.stderr.on('data', (d: Buffer) => (output = (output + d.toString()).slice(-8000)));
  return { proc, log: () => output };
}

export interface RunningServices {
  apiUrl: string;
  agentUrl: string;
  token: string;
  stop: () => Promise<void>;
}

export async function startServices(opts: {
  fakeNowUtc: string;
  nlu: string;
}): Promise<RunningServices> {
  const dir = mkdtempSync(join(tmpdir(), 'hawk-'));
  const token = `hawk-${randomBytes(12).toString('hex')}`;
  const [apiPort, agentPort] = [await freePort(), await freePort()];
  const base = { ...process.env, AGENT_API_TOKEN: token, MYNA_FAKE_NOW: opts.fakeNowUtc };

  const api = start(
    process.execPath,
    ['--import', 'tsx', 'src/main.ts'],
    join(REPO_ROOT, 'services/api'),
    {
      ...base,
      API_HOST: '127.0.0.1',
      API_PORT: String(apiPort),
      DATABASE_PATH: join(dir, 'hawk.db'),
      HAWK_ENABLED: '1',
      NODE_ENV: 'test',
    },
  );
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  await waitHealthy(apiUrl, api.proc, api.log);

  const uv = process.env.HAWK_UV ?? 'uv';
  const agent = start(uv, ['run', '--frozen', 'myna-agent'], join(REPO_ROOT, 'services/agent'), {
    ...base,
    API_BASE_URL: apiUrl,
    AGENT_PORT: String(agentPort),
    LLM_PROVIDER: opts.nlu,
    UV_LINK_MODE: 'copy',
  });
  const agentUrl = `http://127.0.0.1:${agentPort}`;
  try {
    await waitHealthy(agentUrl, agent.proc, agent.log);
  } catch (e) {
    killTree(agent.proc);
    killTree(api.proc);
    throw e;
  }

  return {
    apiUrl,
    agentUrl,
    token,
    stop: async () => {
      for (const p of [agent.proc, api.proc]) killTree(p);
      await new Promise((r) => setTimeout(r, 500));
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    },
  };
}
