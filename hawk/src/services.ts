import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createConnection, createServer } from 'node:net';
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

async function waitPort(port: number, proc: ChildProcess, log: () => string): Promise<void> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    if (proc.exitCode !== null)
      throw new Error(`process exited early:
${log()}`);
    const open = await new Promise<boolean>((done) => {
      const sock = createConnection({ host: '127.0.0.1', port }, () => {
        sock.destroy();
        done(true);
      });
      sock.on('error', () => {
        done(false);
      });
    });
    if (open) return;
    if (Date.now() > deadline)
      throw new Error(`timed out waiting for port ${port}:
${log()}`);
    await new Promise((r) => setTimeout(r, 250));
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
  /** One per agent instance. With more than one, every turn of a call lands on the next one. */
  agentUrls: string[];
  /** What holds the shared call state when there are several instances. */
  sharedState: 'none' | 'redis' | 'fake-redis';
  token: string;
  stop: () => Promise<void>;
  /** Last few KB of each service's output, for diagnosing errored calls. */
  logs: () => { api: string; agent: string };
}

export async function startServices(opts: {
  fakeNowUtc: string;
  nlu: string;
  /** Sarvam chat model id when nlu is "sarvam". */
  model?: string;
  /** Agent instances. More than one needs Redis (REDIS_URL, else a local fake is started). */
  instances?: number;
}): Promise<RunningServices> {
  const instances = opts.instances ?? 1;
  const dir = mkdtempSync(join(tmpdir(), 'hawk-'));
  const token = `hawk-${randomBytes(12).toString('hex')}`;
  const apiPort = await freePort();
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
  const agentDir = join(REPO_ROOT, 'services/agent');
  const procs: { proc: ChildProcess; log: () => string }[] = [api];
  const stopAll = () => {
    for (const p of procs.slice().reverse()) killTree(p.proc);
  };

  // Several instances only make sense with shared state. A real Redis if one is configured;
  // otherwise a local Redis-protocol server, so the same code path runs on a laptop.
  let redisUrl = instances > 1 ? process.env.REDIS_URL : undefined;
  let sharedState: RunningServices['sharedState'] = redisUrl ? 'redis' : 'none';
  if (instances > 1 && !redisUrl) {
    const port = await freePort();
    const fake = start(
      uv,
      ['run', '--frozen', 'python', 'scripts/fake_redis.py', String(port)],
      agentDir,
      {
        ...base,
        UV_LINK_MODE: 'copy',
      },
    );
    procs.push(fake);
    await waitPort(port, fake.proc, fake.log);
    redisUrl = `redis://127.0.0.1:${port}/0`;
    sharedState = 'fake-redis';
  }

  const agentUrls: string[] = [];
  try {
    for (let i = 0; i < instances; i++) {
      const port = await freePort();
      const agent = start(uv, ['run', '--frozen', 'myna-agent'], agentDir, {
        ...base,
        API_BASE_URL: apiUrl,
        AGENT_PORT: String(port),
        LLM_PROVIDER: opts.nlu,
        ...(opts.model ? { SARVAM_MODEL: opts.model } : {}),
        ...(redisUrl ? { REDIS_URL: redisUrl } : {}),
        UV_LINK_MODE: 'copy',
      });
      procs.push(agent);
      const url = `http://127.0.0.1:${port}`;
      await waitHealthy(url, agent.proc, agent.log);
      agentUrls.push(url);
    }
  } catch (e) {
    stopAll();
    throw e;
  }

  return {
    apiUrl,
    agentUrls,
    sharedState,
    token,
    logs: () => ({
      api: api.log(),
      agent: procs
        .slice(1)
        .map((p) => p.log())
        .join('\n--\n'),
    }),
    stop: async () => {
      stopAll();
      await new Promise((r) => setTimeout(r, 500));
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    },
  };
}
