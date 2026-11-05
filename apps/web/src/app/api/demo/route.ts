import { NextResponse } from 'next/server';
import { ApiError, demoBusiness, demoKind, publicApi } from '@/lib/api';
import type { Demo } from '@/lib/types';

/** The demo business's busy/free grid (times only, never names). */
export async function GET(req: Request) {
  const business = demoBusiness(demoKind(new URL(req.url).searchParams.get('biz')));
  try {
    return NextResponse.json(await publicApi<Demo>(`/clinics/${business}/demo`));
  } catch (e) {
    const status = e instanceof ApiError ? e.status : 503;
    return NextResponse.json({ error: 'Schedule unavailable.' }, { status });
  }
}
