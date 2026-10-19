import { NextResponse } from 'next/server';
import { db } from '@/lib/pool';
import { withTenant } from '@/lib/core/db';
import { credentialHash } from '@/lib/core/crypto';
import { parseVoterToken, throttle, clientKey } from '@/lib/voter';

export const dynamic = 'force-dynamic';

/** Returns the ballot a voting link entitles its holder to. */
export async function POST(req: Request) {
  if (!throttle(`ballot:${clientKey(req)}`)) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  const body = await req.json().catch(() => ({}));
  const t = parseVoterToken(body.token);
  if (!t) return NextResponse.json({ error: 'invalid_link' }, { status: 400 });

  const data = await withTenant(await db(), t.orgId, async (tx) => {
    const { rows: [ctx] } = await tx.query('SELECT * FROM vs.credential_context($1)', [credentialHash(t.secret)]);
    if (!ctx || ctx.election_id !== t.electionId) return null;
    await tx.query('SELECT vs.apply_schedule($1)', [t.electionId]);
    const { rows: [e] } = await tx.query(
      `SELECT e.title, e.kind, e.status, e.auto_start, e.starts_at, e.ends_at, o.name AS org_name, d.version, d.definition
         FROM elections e JOIN organizations o ON o.id = e.organization_id
         LEFT JOIN ballot_definitions d ON d.election_id = e.id AND d.published_at IS NOT NULL
        WHERE e.id = $1`, [t.electionId]);
    const { rows: [named] } = e.kind === 'creditor_vote'
      ? await tx.query('SELECT * FROM vs.open_voter_context($1)', [credentialHash(t.secret)]) : { rows: [] };
    return {
      ...e, already_voted: ctx.already_voted, voting_units: String(ctx.voting_units),
      ...(named ? { voter_name: named.eligibility_ref, units_total: String(named.units_total) } : {}),
    };
  });
  if (!data) return NextResponse.json({ error: 'invalid_link' }, { status: 404 });
  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
}
