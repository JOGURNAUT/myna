import { randomUUID, timingSafeEqual } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  type BusinessConfig,
  CallEvent,
  isToolFailure,
  StartCallInput,
  StoredReportInput,
  type ToolArgs,
  type ToolError,
  type ToolErrorCode,
  ToolFailure,
  type ToolName,
  type ToolOutput,
  TOOLS,
} from '@myna/shared';
import { appendCallEvent, listCallEvents, startCall } from '../core/calls.js';
import { dueReminders } from '../core/reminders.js';
import { completeTask, listTasks } from '../core/tasks.js';
import { type ToolContext, toolHandlers } from '../core/tools.js';
import type { Db } from '../db/client.js';
import { hawkReports } from '../db/schema.js';
import { registerHawkRoutes } from './hawk.js';
import { registerPublicRoutes } from './public.js';
import { ClinicRegistry } from './registry.js';
import { registerStaffRoutes, type StaffAuthConfig } from './staff.js';
import { parseOrFail } from './validate.js';

export interface AppDeps {
  db: Db;
  clinics: ReadonlyMap<string, BusinessConfig>;
  /** Shared secret the agent sends as `Authorization: Bearer <token>`. */
  agentToken: string;
  clock?: () => Date;
  logger?: boolean;
  /** Mount Hawk's test-only routes. main.ts refuses this in production. */
  hawk?: boolean;
  /** Dashboard sign-in. Without it, staff routes refuse every request. */
  staff?: StaffAuthConfig;
}

const TaskStatusQuery = z.enum(['open', 'done']).optional();

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

  const registry = new ClinicRegistry(deps.db, deps.clinics.values());
  await registry.loadOverrides();

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
    (staff, _opts, done) => {
      registerStaffRoutes(staff, { db: deps.db, registry, clock, auth: deps.staff });
      done();
    },
    { prefix: '/v1/staff' },
  );
  await app.register(
    (pub, _opts, done) => {
      registerPublicRoutes(pub, { db: deps.db, registry, clock });
      done();
    },
    { prefix: '/v1/public' },
  );

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
        const entry = registry.get(clinicId);
        if (!entry) throw new ToolFailure('NOT_FOUND', `unknown clinic "${clinicId}"`);
        return entry;
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
        const callId = await startCall(deps.db, config.tenantId, input, clock());
        return { ok: true, data: { callId } };
      });

      v1.post<{ Params: { clinicId: string; callId: string } }>(
        '/clinics/:clinicId/calls/:callId/events',
        async (req) => {
          const { config } = clinicOf(req.params.clinicId);
          const event = parseOrFail(CallEvent, req.body);
          await appendCallEvent(deps.db, config.tenantId, req.params.callId, event, clock());
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

      // ---- flow (b): the staff task queue
      v1.get<{ Params: { clinicId: string }; Querystring: { status?: string } }>(
        '/clinics/:clinicId/tasks',
        async (req) => {
          const { adapter } = clinicOf(req.params.clinicId);
          const status = parseOrFail(TaskStatusQuery, req.query.status);
          return { ok: true, data: { tasks: await listTasks(deps.db, adapter, status) } };
        },
      );

      v1.post<{ Params: { clinicId: string; taskId: string } }>(
        '/clinics/:clinicId/tasks/:taskId/done',
        async (req) => {
          const { config } = clinicOf(req.params.clinicId);
          await completeTask(deps.db, config.tenantId, req.params.taskId);
          return { ok: true, data: {} };
        },
      );

      // ---- flow (c): who to call now
      v1.get<{ Params: { clinicId: string } }>('/clinics/:clinicId/reminders/due', async (req) => {
        const { config, adapter } = clinicOf(req.params.clinicId);
        return { ok: true, data: { due: await dueReminders(deps.db, adapter, config, clock()) } };
      });

      // ---- Hawk go-live reports
      v1.post<{ Params: { clinicId: string } }>('/clinics/:clinicId/reports', async (req) => {
        const { config } = clinicOf(req.params.clinicId);
        const report = parseOrFail(StoredReportInput, req.body);
        const id = `rep_${randomUUID()}`;
        await deps.db
          .insert(hawkReports)
          .values({ id, tenantId: config.tenantId, reportJson: JSON.stringify(report) });
        return { ok: true, data: { reportId: id } };
      });

      v1.get<{ Params: { clinicId: string; reportId: string } }>(
        '/clinics/:clinicId/reports/:reportId',
        async (req) => {
          const { config } = clinicOf(req.params.clinicId);
          const [row] = await deps.db
            .select()
            .from(hawkReports)
            .where(
              and(
                eq(hawkReports.tenantId, config.tenantId),
                eq(hawkReports.id, req.params.reportId),
              ),
            );
          if (!row) throw new ToolFailure('NOT_FOUND', 'unknown report');
          return { ok: true, data: JSON.parse(row.reportJson) as unknown };
        },
      );

      if (deps.hawk) {
        registerHawkRoutes(v1, { db: deps.db, registry });
      }

      done();
    },
    { prefix: '/v1' },
  );

  return app;
}
