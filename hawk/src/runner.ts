import type { CreateHawkTenantOutput, HawkTenantState } from '@myna/shared';
import type { Language, Persona, Scenario } from './schema.js';
import { type AgentReply, ScriptedPatient } from './simulator.js';

export interface Endpoints {
  apiUrl: string;
  /** Agent instances. Each call starts on one and every later turn goes to the next. */
  agentUrls: string[];
  token: string;
  baseClinicId: string;
}

export interface Turn {
  speaker: 'caller' | 'agent';
  text: string;
  state?: string;
  expecting?: string;
  /** Agent turns: caller text sent → reply received, as seen by the caller. */
  latencyMs?: number;
}

export interface CallEventRecord {
  type: string;
  [key: string]: unknown;
}

export interface CallRecord {
  scenarioId: string;
  title: string;
  flow: Scenario['flow'];
  type: string;
  language: Language;
  clinicId: string;
  callId: string;
  turns: Turn[];
  endedBy: 'agent' | 'max_turns' | 'error';
  error?: string;
  events: CallEventRecord[];
  state: HawkTenantState;
  handoffTo: string | null;
}

async function json<T>(url: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  // A hang must become a failed call, not a stuck run.
  const res = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(20_000) });
  const body: unknown = await res.json();
  if (!res.ok)
    throw new Error(`${init.method ?? 'GET'} ${url} → ${res.status}: ${JSON.stringify(body)}`);
  return body as T;
}

async function createTenant(env: Endpoints, scenario: Scenario, lang: Language) {
  const config = { ...scenario.seed.config };
  // A clinic places reminder calls in the patient's language; inbound calls are greeted in
  // the clinic's own language and the caller's language takes over from there.
  if (scenario.direction === 'outbound') config.greetingLanguage = lang;
  const res = await json<{ data: CreateHawkTenantOutput }>(`${env.apiUrl}/v1/hawk/tenants`, {
    method: 'POST',
    token: env.token,
    body: JSON.stringify({
      baseClinicId: env.baseClinicId,
      config,
      patients: scenario.seed.patients,
      appointments: scenario.seed.appointments,
    }),
  });
  return res.data;
}

interface AgentTurnResponse {
  callId?: string;
  reply: AgentReply & { handoffTo?: string | null };
}

/** Runs one scenario in one language, start to finish, in its own tenant. */
export async function runScenario(
  env: Endpoints,
  scenario: Scenario,
  persona: Persona,
  lang: Language,
): Promise<CallRecord> {
  const tenant = await createTenant(env, scenario, lang);
  const turns: Turn[] = [];
  const sim = new ScriptedPatient(scenario, persona, lang);
  const agents = env.agentUrls;
  const nextAgent = rotation(agents);
  let callId = '';
  let endedBy: CallRecord['endedBy'] = 'agent';
  let error: string | undefined;
  let handoffTo: string | null = null;

  try {
    const started = performance.now();
    const first =
      scenario.direction === 'outbound'
        ? await json<AgentTurnResponse>(`${nextAgent()}/v1/outbound`, {
            method: 'POST',
            body: JSON.stringify({ clinicId: tenant.clinicId, source: 'hawk' }),
          })
        : await json<AgentTurnResponse>(`${nextAgent()}/v1/calls`, {
            method: 'POST',
            body: JSON.stringify({
              clinicId: tenant.clinicId,
              source: 'hawk',
              ...(scenario.callerPhone ? { callerPhone: scenario.callerPhone } : {}),
            }),
          });
    callId = first.callId ?? '';
    let reply = first.reply;
    turns.push({
      speaker: 'agent',
      text: reply.text,
      state: reply.state,
      expecting: reply.expecting,
      latencyMs: Math.round(performance.now() - started),
    });

    for (let i = 0; ; i++) {
      if (reply.ended) {
        handoffTo = reply.handoffTo ?? null;
        break;
      }
      if (i >= scenario.maxTurns) {
        endedBy = 'max_turns';
        break;
      }
      const said = sim.respond(reply);
      if (said === null) break;
      turns.push({ speaker: 'caller', text: said });
      const t0 = performance.now();
      const next = await json<AgentTurnResponse>(`${nextAgent()}/v1/calls/${callId}/turns`, {
        method: 'POST',
        body: JSON.stringify({ text: said }),
      });
      reply = next.reply;
      turns.push({
        speaker: 'agent',
        text: reply.text,
        state: reply.state,
        expecting: reply.expecting,
        latencyMs: Math.round(performance.now() - t0),
      });
    }
  } catch (e) {
    endedBy = 'error';
    error = e instanceof Error ? e.message : String(e);
  }

  const events = callId
    ? (
        await json<{ data: { events: CallEventRecord[] } }>(
          `${env.apiUrl}/v1/clinics/${tenant.clinicId}/calls/${callId}/events`,
          { token: env.token },
        )
      ).data.events
    : [];
  const state = (
    await json<{ data: HawkTenantState }>(
      `${env.apiUrl}/v1/hawk/tenants/${tenant.clinicId}/state`,
      {
        token: env.token,
      },
    )
  ).data;

  return {
    scenarioId: scenario.id,
    title: scenario.title,
    flow: scenario.flow,
    type: scenario.type,
    language: lang,
    clinicId: tenant.clinicId,
    callId,
    turns,
    endedBy,
    ...(error ? { error } : {}),
    events,
    state,
    handoffTo,
  };
}

let started = 0;
/**
 * Round-robin over the agent instances, offset per call so every instance also opens calls.
 * With one instance it's constant; with several, a call's turns hop between them, which only
 * works if call state really is shared.
 */
function rotation(urls: string[]): () => string {
  let i = started++;
  return () => urls[i++ % urls.length] as string;
}
