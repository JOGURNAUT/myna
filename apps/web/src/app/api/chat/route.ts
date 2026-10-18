import { NextResponse } from 'next/server';
import { agentCall, ApiError, DEMO_CLINIC } from '@/lib/api';

/**
 * The public demo's way to Myna. Runs on the server, so the agent's address stays private, and
 * every demo call is tagged `manual_test` (kept out of a clinic's real call metrics).
 */

interface Reply {
  text: string;
  state: string;
  language: string;
  ended: boolean;
  handoffTo: string | null;
  expecting: string;
}

// Crude per-IP limits: enough to stop a loop from burning the model budget.
const hits = new Map<string, number[]>();
function limited(ip: string, kind: 'start' | 'turn'): boolean {
  const [limit, windowMs] = kind === 'start' ? [8, 10 * 60_000] : [40, 60_000];
  const key = `${kind}:${ip}`;
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(key, recent);
  return recent.length > limit;
}

export async function POST(req: Request) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  const body = (await req.json().catch(() => null)) as { callId?: unknown; text?: unknown } | null;
  const callId = typeof body?.callId === 'string' ? body.callId : null;
  const text = typeof body?.text === 'string' ? body.text.trim().slice(0, 500) : '';

  if (limited(ip, callId ? 'turn' : 'start')) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait a minute.' },
      { status: 429 },
    );
  }
  if (callId && !/^call_[0-9a-f-]{36}$/.test(callId)) {
    return NextResponse.json({ error: 'Bad call id.' }, { status: 400 });
  }
  if (callId && !text) return NextResponse.json({ error: 'Say something first.' }, { status: 400 });

  const started = performance.now();
  try {
    const out = callId
      ? await agentCall<{ reply: Reply }>(`/v1/calls/${callId}/turns`, { text })
      : await agentCall<{ callId: string; reply: Reply }>('/v1/calls', {
          clinicId: DEMO_CLINIC,
          source: 'manual_test',
        });
    return NextResponse.json({
      callId: 'callId' in out ? out.callId : callId,
      reply: out.reply,
      latencyMs: Math.round(performance.now() - started),
    });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404 && callId) {
      return NextResponse.json({ error: 'This call has ended. Start a new one.' }, { status: 410 });
    }
    return NextResponse.json({ error: 'Myna is not available right now.' }, { status: 503 });
  }
}
