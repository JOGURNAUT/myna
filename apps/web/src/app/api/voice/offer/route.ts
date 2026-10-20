import { NextResponse } from 'next/server';
import { AGENT_URL, DEMO_CLINIC } from '@/lib/api';
import { limiter } from '@/lib/limiter';

/**
 * WebRTC signalling for the browser voice demo: the browser POSTs its offer here and we pass it
 * to the agent, so the agent's address stays private. (Audio itself flows peer to peer between the
 * browser and the agent once connected; a deployment behind a NAT needs a TURN server.)
 *
 * Voice calls are metered (Sarvam speech) so they are limited per IP like the text chat, and are
 * always tagged `manual_test` and pinned to the demo clinic.
 */

async function forward(method: 'POST' | 'PATCH', body: unknown): Promise<Response> {
  try {
    return await fetch(`${AGENT_URL}/api/offer`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json({ error: 'Voice is not available right now.' }, { status: 503 });
  }
}

export async function POST(req: Request) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  if ((await limiter.hit(`voice:${ip}`, 10 * 60_000)) > 5) {
    return NextResponse.json(
      { error: 'Too many voice calls. Please wait a few minutes.' },
      { status: 429 },
    );
  }
  const offer = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!offer || typeof offer.sdp !== 'string') {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
  }
  // The browser may not choose the clinic or the call source.
  const res = await forward('POST', {
    ...offer,
    request_data: { clinicId: DEMO_CLINIC, source: 'manual_test' },
  });
  return new NextResponse(await res.text(), {
    status: res.status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function PATCH(req: Request) {
  const body = (await req.json().catch(() => null)) as unknown;
  if (!body) return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
  const res = await forward('PATCH', body);
  return new NextResponse(await res.text(), {
    status: res.status,
    headers: { 'content-type': 'application/json' },
  });
}
