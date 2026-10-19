import { NextResponse } from 'next/server';
import { db } from '@/lib/pool';
import { verifyReceipt } from '@/lib/core/voting';
import { withTenant } from '@/lib/core/db';
import { throttle, clientKey } from '@/lib/voter';

export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function POST(req: Request) {
  if (!throttle(`verify:${clientKey(req)}`)) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  const { org, election, receipt } = await req.json().catch(() => ({}));
  if (!UUID.test(org ?? '') || !UUID.test(election ?? '') || typeof receipt !== 'string' || !/^[0-9a-f]{24}$/.test(receipt.trim())) {
    return NextResponse.json({ found: false });
  }
  const pool = await db();
  const found = await verifyReceipt(pool, org, election, receipt.trim());
  // On an open ballot the voter may then ask to see their own choices (after logging in again).
  const openBallot = found && await withTenant(pool, org, async (tx) =>
    (await tx.query(`SELECT kind = 'creditor_vote' AS open FROM elections WHERE id = $1`, [election])).rows[0]?.open === true);
  return NextResponse.json({ found, openBallot });
}
