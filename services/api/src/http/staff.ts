import type { FastifyInstance } from 'fastify';
import type { ConfigBus } from '../infra/config-bus.js';
import type { RateLimiter } from '@myna/shared/rate-limit';
import { z } from 'zod';
import { addDays, nowIn, splitDateTime, ToolFailure } from '@myna/shared';
import { phoneKey } from '../core/identity.js';
import {
  callDetail,
  FAILURE_TYPES,
  handoffAlerts,
  listCalls,
  markHandoffSeen,
  metrics,
  pendingBookings,
  setLabel,
} from '../core/dashboard.js';
import {
  issueSession,
  LoginThrottle,
  type StaffSession,
  verifyPassword,
  verifySession,
} from '../core/staff-auth.js';
import { completeTask, insertTask, listTasks } from '../core/tasks.js';
import type { Db } from '../db/client.js';
import type { ClinicRegistry } from './registry.js';
import { parseOrFail } from './validate.js';

export interface StaffAuthConfig {
  /** HMAC secret for session tokens (32+ chars, from env / Secret Manager). */
  secret: string;
  /** clinicId → scrypt hash. */
  logins: ReadonlyMap<string, string>;
}

const Login = z.object({ clinicId: z.string().min(1), password: z.string().min(1).max(200) });
const DateQuery = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});
const Label = z.object({
  correct: z.boolean(),
  failureType: z.enum(FAILURE_TYPES).optional(),
  notes: z.string().max(1000).optional(),
});
const KillSwitch = z.object({ on: z.boolean() });
const TaskStatus = z.enum(['open', 'done']).optional();

declare module 'fastify' {
  interface FastifyRequest {
    staff?: StaffSession;
  }
}

/**
 * The clinic dashboard's API. Signed-in staff see and act on their own clinic only; the clinic
 * comes from the session, never from the URL, so one clinic can't address another's data.
 */
export function registerStaffRoutes(
  app: FastifyInstance,
  deps: {
    db: Db;
    registry: ClinicRegistry;
    clock: () => Date;
    auth: StaffAuthConfig | undefined;
    limiter: RateLimiter;
    configBus: ConfigBus;
  },
): void {
  const throttle = new LoginThrottle(deps.limiter);

  app.post('/login', async (req) => {
    const auth = deps.auth;
    if (!auth) throw new ToolFailure('NOT_FOUND', 'dashboard sign-in is not configured');
    const { clinicId, password } = parseOrFail(Login, req.body);
    const now = deps.clock().getTime();
    if (await throttle.blocked(clinicId)) {
      throw new ToolFailure('UNAUTHORIZED', 'too many attempts; try again in 15 minutes');
    }
    const hash = auth.logins.get(clinicId);
    // Same answer for an unknown clinic and a wrong password.
    if (!hash || !deps.registry.get(clinicId) || !verifyPassword(password, hash)) {
      await throttle.fail(clinicId);
      throw new ToolFailure('UNAUTHORIZED', 'wrong clinic or password');
    }
    await throttle.succeed(clinicId);
    const { token, session } = issueSession(auth.secret, clinicId, now);
    return {
      ok: true,
      data: { token, clinicId, expiresAt: new Date(session.expiresAt).toISOString() },
    };
  });

  void app.register((staff, _opts, done) => {
    staff.addHook('onRequest', (req, _reply, next) => {
      const header = req.headers.authorization ?? '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : '';
      const session = deps.auth
        ? verifySession(deps.auth.secret, token, deps.clock().getTime())
        : null;
      if (!session || !deps.registry.get(session.clinicId)) {
        next(new ToolFailure('UNAUTHORIZED', 'sign in again'));
        return;
      }
      req.staff = session;
      next();
    });

    const clinic = (req: { staff?: StaffSession }) => {
      const entry = req.staff ? deps.registry.get(req.staff.clinicId) : undefined;
      if (!entry) throw new ToolFailure('UNAUTHORIZED', 'sign in again');
      return entry;
    };
    const today = (tz: string) => splitDateTime(nowIn(tz, deps.clock())).date;

    staff.get('/me', (req) => {
      const { config } = clinic(req);
      return {
        ok: true,
        data: {
          clinicId: config.id,
          name: config.name,
          timezone: config.timezone,
          killSwitch: config.killSwitch,
          hours: config.hours,
          today: today(config.timezone),
        },
      };
    });

    // The clinic's own configuration, read-only: what Myna was set up to do (the YAML is the
    // source of truth; changing it is a deliberate, reviewed act, not a dashboard form).
    staff.get('/setup', (req) => {
      const { config: c } = clinic(req);
      return {
        ok: true,
        data: {
          name: c.name,
          timezone: c.timezone,
          phone: c.phone,
          humanHandoffNumber: c.humanHandoffNumber,
          languages: c.languages,
          schedulingMode: c.schedulingMode,
          scheduleStore: c.scheduleStore.backend,
          hours: c.hours,
          closedDates: c.closedDates,
          resources: c.resources,
          services: c.services,
          booking: c.booking,
          bookingApproval: c.bookingApproval,
          faq: c.faq,
          callbackPromiseHours: c.callbackPromiseHours,
          outboundReminders: c.outboundReminders,
          recordCalls: c.recordCalls,
        },
      };
    });

    staff.get('/calls', async (req) => {
      const { config } = clinic(req);
      const q = parseOrFail(DateQuery, req.query);
      const to = q.to ?? today(config.timezone);
      const from = q.from ?? to;
      if (from > to || from < addDays(to, -31)) {
        throw new ToolFailure('VALIDATION', 'date range must be 1–31 days');
      }
      return { ok: true, data: { calls: await listCalls(deps.db, config, { from, to }) } };
    });

    staff.get<{ Params: { callId: string } }>('/calls/:callId', async (req) => {
      const { config } = clinic(req);
      return { ok: true, data: await callDetail(deps.db, config, req.params.callId) };
    });

    staff.put<{ Params: { callId: string } }>('/calls/:callId/label', async (req) => {
      const { config } = clinic(req);
      await setLabel(deps.db, config, req.params.callId, parseOrFail(Label, req.body));
      return { ok: true, data: {} };
    });

    staff.post<{ Params: { callId: string } }>('/calls/:callId/handoff-seen', async (req) => {
      const { config } = clinic(req);
      await markHandoffSeen(deps.db, config, req.params.callId, deps.clock());
      return { ok: true, data: {} };
    });

    staff.get('/handoffs', async (req) => {
      const { config } = clinic(req);
      return { ok: true, data: { handoffs: await handoffAlerts(deps.db, config, deps.clock()) } };
    });

    staff.get('/metrics', async (req) => {
      const { config } = clinic(req);
      return { ok: true, data: await metrics(deps.db, config, deps.clock()) };
    });

    staff.get('/tasks', async (req) => {
      const { adapter } = clinic(req);
      const status = parseOrFail(TaskStatus, (req.query as { status?: string }).status);
      return { ok: true, data: { tasks: await listTasks(deps.db, adapter, status) } };
    });

    staff.post<{ Params: { taskId: string } }>('/tasks/:taskId/done', async (req) => {
      const { config } = clinic(req);
      await completeTask(deps.db, config.tenantId, req.params.taskId);
      return { ok: true, data: {} };
    });

    staff.get('/pending', async (req) => {
      const { adapter } = clinic(req);
      return { ok: true, data: { pending: await pendingBookings(adapter, deps.clock()) } };
    });

    staff.post<{ Params: { appointmentId: string } }>(
      '/pending/:appointmentId/approve',
      async (req) => {
        const { adapter } = clinic(req);
        const appt = await adapter.decidePending(req.params.appointmentId, 'confirmed');
        return { ok: true, data: { appointment: appt } };
      },
    );

    staff.post<{ Params: { appointmentId: string } }>(
      '/pending/:appointmentId/reject',
      async (req) => {
        const { config, adapter } = clinic(req);
        const appt = await adapter.decidePending(req.params.appointmentId, 'cancelled');
        // The patient thinks they're booked: someone must call them with other times.
        const patient = await adapter.getPatient(appt.patientId);
        const phone = patient ? phoneKey(patient.phone) : null;
        if (patient && phone) {
          await insertTask(deps.db, config, deps.clock(), {
            callId: 'dashboard',
            patientId: patient.id,
            callerName: null,
            category: 'other',
            summary: `After-hours booking for ${appt.start.replace('T', ' ')} was not approved: offer other times.`,
            urgency: 'today',
            callbackNumber: phone,
          });
        }
        return { ok: true, data: { appointment: appt } };
      },
    );

    staff.get('/kill-switch', (req) => ({ ok: true, data: { on: clinic(req).config.killSwitch } }));

    staff.put('/kill-switch', async (req) => {
      const { config } = clinic(req);
      const { on } = parseOrFail(KillSwitch, req.body);
      const updated = await deps.registry.setKillSwitch(config.id, on);
      // Tell the other instances and flush cached copies. The switch itself is already saved, so a
      // broken bus must not fail the request: the dashboard owner still gets their "on".
      await deps.configBus.publish(config.id).catch((e: unknown) => {
        req.log.error({ err: e, clinicId: config.id }, 'could not announce kill-switch change');
      });
      req.log.warn({ clinicId: config.id, killSwitch: on }, 'kill switch changed from dashboard');
      return { ok: true, data: { on: updated.killSwitch } };
    });

    done();
  });
}
