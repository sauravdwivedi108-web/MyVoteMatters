import { NextResponse } from 'next/server';
import { db } from '@/lib/pool';
import { castVote } from '@/lib/core/voting';
import { parseVoterToken, throttle, clientKey } from '@/lib/voter';

export const dynamic = 'force-dynamic';

const REASONS: Record<string, string> = {
  invalid_credential: 'This voting link is not valid.',
  already_voted: 'A different ballot has already been cast with this link. Each entitlement can vote once.',
  voting_closed: 'Voting is not open for this election.',
  not_eligible: 'This entitlement is not eligible to vote.',
  stale_ballot: 'The ballot has changed. Reload the page and try again.',
  not_found: 'This election could not be found.',
};

/** Casts a ballot. Safe to retry with the same choices: the original receipt comes back. */
export async function POST(req: Request) {
  if (!throttle(`cast:${clientKey(req)}`, 20)) return NextResponse.json({ error: 'Too many attempts. Wait a minute and try again.' }, { status: 429 });
  const body = await req.json().catch(() => ({}));
  const t = parseVoterToken(body.token);
  if (!t || !body.choices || typeof body.choices !== 'object') {
    return NextResponse.json({ error: REASONS.invalid_credential }, { status: 400 });
  }
  try {
    const r = await castVote(await db(), t.orgId, { electionId: t.electionId, credentialSecret: t.secret, choices: body.choices });
    if (r.status === 'accepted') {
      return NextResponse.json({ receipt: r.receiptCode, replayed: r.replayed }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const reason = r.reason.startsWith('invalid_ballot') ? 'Please answer every item on the ballot.' : REASONS[r.reason] ?? 'Your vote could not be accepted.';
    return NextResponse.json({ error: reason }, { status: 409 });
  } catch (err) {
    console.error('cast failed', (err as Error).message); // never log the request body
    return NextResponse.json({ error: 'Your vote was not recorded because of a system error. Please try again.' }, { status: 500 });
  }
}
