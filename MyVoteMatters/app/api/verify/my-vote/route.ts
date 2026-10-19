import { NextResponse } from 'next/server';
import { db } from '@/lib/pool';
import { withTenant } from '@/lib/core/db';
import { credentialHash } from '@/lib/core/crypto';
import { checkVoterLogin } from '@/lib/core/voterLogins';
import { splitPicks, type BallotDefinition } from '@/lib/core/ballot';
import { throttle, clientKey } from '@/lib/voter';

export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Shows a voter their own recorded choices on an open ballot, only after they
 * log in again with their voter ID and password for this same meeting.
 */
export async function POST(req: Request) {
  if (!throttle(`myvote:${clientKey(req)}`, 10)) return NextResponse.json({ error: 'Too many attempts. Wait a minute and try again.' }, { status: 429 });
  const { org, election, loginId, password } = await req.json().catch(() => ({}));
  if (!UUID.test(org ?? '') || !UUID.test(election ?? '') || typeof loginId !== 'string' || typeof password !== 'string') {
    return NextResponse.json({ error: 'Enter your voter ID and password.' }, { status: 400 });
  }
  const pool = await db();
  const login = await checkVoterLogin(pool, loginId, password);
  if (!login.ok || login.orgId !== org || login.electionId !== election) {
    return NextResponse.json({ error: 'The voter ID or password is not right for this meeting.' }, { status: 401 });
  }
  const vote = await withTenant(pool, org, async (tx) => {
    const { rows: [v] } = await tx.query('SELECT * FROM vs.own_open_vote($1)', [credentialHash(login.secret)]);
    if (!v || v.election_id !== election) return null;
    const { rows: [d] } = await tx.query(
      `SELECT definition FROM ballot_definitions WHERE election_id = $1 AND published_at IS NOT NULL ORDER BY version DESC LIMIT 1`, [election]);
    return { name: v.eligibility_ref as string, castAt: v.cast_at as Date, choices: v.choices as Record<string, string>, def: d?.definition as BallotDefinition };
  });
  if (!vote) return NextResponse.json({ error: 'No vote is recorded for this voter ID yet.' }, { status: 404 });
  const items = vote.def?.type === 'agenda'
    ? vote.def.items.map((it) => ({
        title: it.title,
        picks: splitPicks(vote.choices[it.id] ?? '').map((id) => it.options.find((o) => o.id === id)?.name ?? id),
      }))
    : Object.entries(vote.choices).map(([title, v]) => ({ title, picks: splitPicks(v) }));
  return NextResponse.json({ name: vote.name, castAt: vote.castAt, items }, { headers: { 'Cache-Control': 'no-store' } });
}
