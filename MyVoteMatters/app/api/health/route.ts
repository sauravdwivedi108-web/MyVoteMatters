import { NextResponse } from 'next/server';
import { db, hasDatabase } from '@/lib/pool';

export const dynamic = 'force-dynamic';

/** Speed check: which Vercel region served this and how long one database round trip takes. */
export async function GET() {
  const region = process.env.VERCEL_REGION ?? 'local';
  if (!hasDatabase()) return NextResponse.json({ region, database: 'not connected' });
  const t0 = performance.now();
  const pool = await db();
  const ready = Math.round(performance.now() - t0);
  const t1 = performance.now();
  await pool.query('SELECT 1');
  const roundTripMs = Math.round(performance.now() - t1);
  return NextResponse.json({ region, roundTripMs, connectMs: ready }, { headers: { 'Cache-Control': 'no-store' } });
}
