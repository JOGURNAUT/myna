/** Shapes the web app reads from the API (a subset of what the API sends). */

export type Hours = Partial<
  Record<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun', { start: string; end: string }[]>
>;

export interface Me {
  clinicId: string;
  name: string;
  timezone: string;
  killSwitch: boolean;
  hours: Hours;
  today: string;
}

export interface CallSummary {
  id: string;
  startedAt: string;
  direction: string;
  source: string;
  callerPhoneMasked: string | null;
  language: string | null;
  firstRequest: string | null;
  outcome: string | null;
  handoffReason: string | null;
  durationSec: number | null;
  label: { correct: boolean; failureType: string | null } | null;
}

export type CallEvent =
  | {
      type: 'turn';
      speaker: 'agent' | 'caller';
      text: string;
      language?: string;
      state: string;
      latencyMs?: number;
      at: string;
    }
  | {
      type: 'tool_call';
      tool: string;
      ok: boolean;
      errorCode?: string;
      latencyMs: number;
      at: string;
    }
  | { type: 'handoff'; reason: string; summary: string; at: string }
  | { type: 'end'; outcome: string; handoffReason?: string; at: string };

export interface CallDetail {
  id: string;
  startedAt: string;
  endedAt: string | null;
  direction: string;
  source: string;
  callerPhoneMasked: string | null;
  outcome: string | null;
  handoffReason: string | null;
  events: CallEvent[];
  label: {
    correct: boolean;
    failureType: string | null;
    notes: string | null;
    labeledAt: string;
  } | null;
}

export interface Metric {
  id: string;
  label: string;
  value: number | null;
  unit: '%' | 'calls' | 'hours' | 'count';
  formula: string;
}

export interface Task {
  id: string;
  callId: string;
  category: string;
  summary: string;
  urgency: 'urgent' | 'today' | 'routine';
  patientName: string | null;
  callerName: string | null;
  verified: boolean;
  callbackNumberMasked: string;
  callbackBy: string;
  status: 'open' | 'done';
}

export interface PendingBooking {
  id: string;
  patientName: string;
  resourceName: string;
  serviceName: string;
  start: string;
  end: string;
}

export interface Demo {
  name: string;
  today: string;
  hours: Hours;
  closedDates: string[];
  resources: { id: string; name: string; hours: Hours }[];
  services: { id: string; name: string; durationMin: number }[];
  busy: { resourceId: string; start: string; end: string; status: string }[];
}

export type Verdict = 'SAFE TO LAUNCH' | 'LAUNCH WITH HANDOFF' | 'NOT SAFE';
export interface Turn {
  speaker: 'caller' | 'agent';
  text: string;
  state?: string;
}
export interface Rate {
  calls: number;
  passed: number;
  passRate: number;
}
export interface HawkReport {
  runId: string;
  createdAt: string;
  clinic: string;
  setup: { clock: string; nlu: string; patient: string; judge: string; caveat: string };
  totals: Rate;
  flows: Record<string, Rate & { verdict: Verdict; why: string }>;
  languages: Record<string, Rate>;
  types: Record<string, Rate>;
  failureModes: {
    check: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    count: number;
    scenarios: string[];
    example: { scenarioId: string; language: string; detail: string; transcript: Turn[] };
  }[];
  latency: { p50Ms: number; p95Ms: number; note: string };
  cost: { perCallInr: number; note: string };
}
