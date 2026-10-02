import { timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  type BusinessConfig,
  CallEvent,
  isToolFailure,
  StartCallInput,
  type ToolArgs,
  type ToolError,
  type ToolErrorCode,
  ToolFailure,
  type ToolName,
  type ToolOutput,
  TOOLS,
} from '@myna/shared';
import { SqliteSchedulingAdapter } from '../adapters/sqlite.js';
import type { SchedulingAdapter } from '../adapters/types.js';
import { appendCallEvent, listCallEvents, startCall } from '../core/calls.js';
import { type ToolContext, toolHandlers } from '../core/tools.js';
import type { Db } from '../db/client.js';

export interface AppDeps {
  db: Db;
  clinics: ReadonlyMap<string, BusinessConfig>;
  /** Shared secret the agent sends as `Authorization: Bearer <token>`. */
  agentToken: string;
  clock?: () => Date;
  logger?: boolean;
}

const STATUS: Record<ToolErrorCode, number> = {
  VALIDATION: 400,
  UNAUTHORIZED: 401,
  NOT_VERIFIED: 403,
  NOT_FOUND: 404,
  SLOT_UNAVAILABLE: 409,
  OUTSIDE_HOURS: 409,
  TOO_SOON: 409,
  TOO_FAR_AHEAD: 409,
  SERVICE_NOT_OFFERED: 409,
  ALREADY_CANCELLED: 409,
  IDEMPOTENCY_CONFLICT: 409,
  KILL_SWITCH: 423,
  INTERNAL: 500,
};

function sendError(reply: FastifyReply, error: ToolError) {
  return reply.code(STATUS[error.code]).send({ ok: false, error });
}

function tokensMatch(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function parseOrFail<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ToolFailure('VALIDATION', 'request does not match the contract', {
      issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return result.data;
}

/** Validates input, runs the handler, validates output. Output drift is a server bug (500). */
async function runTool<K extends ToolName>(
  name: K,
  ctx: ToolContext,
  raw: unknown,
): Promise<ToolOutput<K>> {
  const handler = toolHandlers[name];
  if (!handler) throw new ToolFailure('NOT_FOUND', `tool "${name}" is not available yet`);
  const args = parseOrFail(TOOLS[name].input, raw) as ToolArgs<K>;
  const out = await handler(ctx, args);
  const checked = TOOLS[name].output.safeParse(out);
  if (!checked.success)
    throw new ToolFailure('INTERNAL', `tool "${name}" produced an invalid result`);
  return checked.data as ToolOutput<K>;
}

const isToolName = (s: string): s is ToolName => Object.hasOwn(TOOLS, s);

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const clock = deps.clock ?? (() => new Date());
  const app = Fastify({
    logger: deps.logger ? { redact: ['req.headers.authorization'] } : false,
  });

  const adapters = new Map<string, SchedulingAdapter>();
  for (const [id, cfg] of deps.clinics) adapters.set(id, new SqliteSchedulingAdapter(deps.db, cfg));

  app.setErrorHandler((err, req, reply) => {
    if (isToolFailure(err)) return sendError(reply, err.toJSON());
    // Fastify's own body parsing errors (bad JSON etc.)
    const status = (err as { statusCode?: number }).statusCode;
    if (status !== undefined && status >= 400 && status < 500) {
      return sendError(reply, { code: 'VALIDATION', message: 'malformed request' });
    }
    req.log.error({ err }, 'unhandled error');
    return sendError(reply, { code: 'INTERNAL', message: 'internal error' });
  });

  app.get('/health', () => ({ ok: true }));

  await app.register(
    (v1, _opts, done) => {
      v1.addHook('onRequest', (req, _reply, next) => {
        const header = req.headers.authorization ?? '';
        const token = header.startsWith('Bearer ') ? header.slice(7) : '';
        next(
          tokensMatch(token, deps.agentToken)
            ? undefined
            : new ToolFailure('UNAUTHORIZED', 'missing or invalid token'),
        );
      });

      const clinicOf = (clinicId: string) => {
        const config = deps.clinics.get(clinicId);
        const adapter = adapters.get(clinicId);
        if (!config || !adapter) throw new ToolFailure('NOT_FOUND', `unknown clinic "${clinicId}"`);
        return { config, adapter };
      };

      v1.get<{ Params: { clinicId: string } }>('/clinics/:clinicId/config', (req) => {
        return { ok: true, data: clinicOf(req.params.clinicId).config };
      });

      v1.post<{ Params: { clinicId: string; tool: string } }>(
        '/clinics/:clinicId/tools/:tool',
        async (req) => {
          const { config, adapter } = clinicOf(req.params.clinicId);
          const name = req.params.tool;
          if (!isToolName(name)) throw new ToolFailure('NOT_FOUND', `unknown tool "${name}"`);
          const data = await runTool(name, { db: deps.db, adapter, config, clock }, req.body);
          return { ok: true, data };
        },
      );

      v1.post<{ Params: { clinicId: string } }>('/clinics/:clinicId/calls', async (req) => {
        const { config } = clinicOf(req.params.clinicId);
        const input = parseOrFail(StartCallInput, req.body ?? {});
        const callId = await startCall(deps.db, config.tenantId, input);
        return { ok: true, data: { callId } };
      });

      v1.post<{ Params: { clinicId: string; callId: string } }>(
        '/clinics/:clinicId/calls/:callId/events',
        async (req) => {
          const { config } = clinicOf(req.params.clinicId);
          const event = parseOrFail(CallEvent, req.body);
          await appendCallEvent(deps.db, config.tenantId, req.params.callId, event);
          return { ok: true, data: {} };
        },
      );

      v1.get<{ Params: { clinicId: string; callId: string } }>(
        '/clinics/:clinicId/calls/:callId/events',
        async (req) => {
          const { config } = clinicOf(req.params.clinicId);
          return {
            ok: true,
            data: { events: await listCallEvents(deps.db, config.tenantId, req.params.callId) },
          };
        },
      );

      done();
    },
    { prefix: '/v1' },
  );

  return app;
}
