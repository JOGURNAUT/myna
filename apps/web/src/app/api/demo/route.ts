import { NextResponse } from 'next/server';
import { ApiError, DEMO_CLINIC, publicApi } from '@/lib/api';
import type { Demo } from '@/lib/types';

/** The demo clinic's busy/free grid (times only, never names). */
export async function GET() {
  try {
    return NextResponse.json(await publicApi<Demo>(`/clinics/${DEMO_CLINIC}/demo`));
  } catch (e) {
    const status = e instanceof ApiError ? e.status : 503;
    return NextResponse.json({ error: 'Schedule unavailable.' }, { status });
  }
}
