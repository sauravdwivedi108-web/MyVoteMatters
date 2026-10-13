import { NextResponse } from 'next/server';
import { db } from '@/lib/pool';
import { verifyReceipt } from '@/lib/core/voting';
import { throttle, clientKey } from '@/lib/voter';

export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function POST(req: Request) {
  if (!throttle(`verify:${clientKey(req)}`)) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  const { org, election, receipt } = await req.json().catch(() => ({}));
  if (!UUID.test(org ?? '') || !UUID.test(election ?? '') || typeof receipt !== 'string' || !/^[0-9a-f]{24}$/.test(receipt.trim())) {
    return NextResponse.json({ found: false });
  }
  const found = await verifyReceipt(await db(), org, election, receipt.trim());
  return NextResponse.json({ found });
}
