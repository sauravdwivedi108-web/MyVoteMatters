import 'server-only';
import { db } from './pool';
import { withTenant } from './core/db';
import type { Session } from './auth';
import type { BallotDefinition } from './core/ballot';
import type { TallyResult } from './core/tally';

export type ElectionStatus = 'draft' | 'pending_approval' | 'approved' | 'open' | 'closed' | 'tallied' | 'published';

export type ElectionSummary = {
  id: string; title: string; kind: string; status: ElectionStatus;
  starts_at: Date; ends_at: Date; eligible: number; voted: number;
};

export async function listElections(s: Session): Promise<ElectionSummary[]> {
  return withTenant(await db(), s.orgId, async (tx) => {
    const { rows } = await tx.query(
      `SELECT e.id, e.title, e.kind, e.status, e.starts_at, e.ends_at, t.eligible::int, t.voted::int
         FROM elections e CROSS JOIN LATERAL vs.turnout(e.id) t
        ORDER BY e.starts_at DESC`);
    return rows;
  });
}

export type ElectionDetail = ElectionSummary & {
  record_date: string | null;
  created_by: string; submitted_by: string | null; approved_by: string | null;
  submitted_by_name: string | null; approved_by_name: string | null;
  units_eligible: string; units_voted: string;
  ballot: { version: number; definition: BallotDefinition; published: boolean } | null;
  credentials: number;
  roll: { eligibility_ref: string; voting_units: string }[];
  tally: (TallyResult & { result_hash: string; completed_at: Date }) | null;
  audit: { action: string; actor: string; event_time: Date; hash: string }[];
};

export async function getElection(s: Session, id: string): Promise<ElectionDetail | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  return withTenant(await db(), s.orgId, async (tx) => {
    const { rows: [e] } = await tx.query(
      `SELECT e.*, su.display_name AS submitted_by_name, ap.display_name AS approved_by_name,
              t.eligible::int, t.voted::int, t.units_eligible::text, t.units_voted::text
         FROM elections e CROSS JOIN LATERAL vs.turnout(e.id) t
         LEFT JOIN users su ON su.id = e.submitted_by LEFT JOIN users ap ON ap.id = e.approved_by
        WHERE e.id = $1`, [id]);
    if (!e) return null;
    const { rows: [b] } = await tx.query(
      `SELECT version, definition, published_at IS NOT NULL AS published FROM ballot_definitions
        WHERE election_id = $1 ORDER BY version DESC LIMIT 1`, [id]);
    const { rows: [c] } = await tx.query(
      `SELECT count(*)::int AS n FROM voting_credentials WHERE election_id = $1 AND revoked_at IS NULL`, [id]);
    const { rows: roll } = await tx.query(
      `SELECT eligibility_ref, voting_units::text FROM voter_eligibility WHERE election_id = $1
        ORDER BY eligibility_ref LIMIT 200`, [id]);
    const { rows: [t] } = await tx.query(
      `SELECT result, result_hash, completed_at FROM tally_runs WHERE election_id = $1
        ORDER BY completed_at DESC LIMIT 1`, [id]);
    const { rows: audit } = await tx.query(
      `SELECT a.action, coalesce(u.display_name, a.actor_ref) AS actor, a.event_time, a.hash
         FROM audit_events a LEFT JOIN users u ON 'user:' || u.id = a.actor_ref
        WHERE a.resource_ref = $1 ORDER BY a.seq DESC LIMIT 30`, [`election:${id}`]);
    return {
      ...e,
      ballot: b ?? null,
      credentials: c.n,
      roll,
      tally: t ? { ...t.result, result_hash: t.result_hash, completed_at: t.completed_at } : null,
      audit,
    };
  });
}

export async function listTeam(s: Session) {
  return withTenant(await db(), s.orgId, async (tx) => (await tx.query(
    `SELECT u.id, u.email_normalized AS email, u.display_name AS name, m.role
       FROM memberships m JOIN users u ON u.id = m.user_id ORDER BY m.role, u.email_normalized`)).rows as
    { id: string; email: string; name: string | null; role: string }[]);
}

/** Published results only; anything not yet published is indistinguishable from not found. */
export async function getPublishedResult(orgId: string, electionId: string) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  if (!uuid.test(orgId) || !uuid.test(electionId)) return null;
  return withTenant(await db(), orgId, async (tx) => {
    const { rows: [r] } = await tx.query(
      `SELECT e.title, e.kind, o.name AS org_name, d.definition, t.result, t.result_hash, t.completed_at
         FROM elections e JOIN organizations o ON o.id = e.organization_id
         JOIN ballot_definitions d ON d.election_id = e.id AND d.published_at IS NOT NULL
         JOIN LATERAL (SELECT * FROM tally_runs WHERE election_id = e.id ORDER BY completed_at DESC LIMIT 1) t ON true
        WHERE e.id = $1 AND e.status = 'published'`, [electionId]);
    if (!r) return null;
    const tally = (await tx.query(`SELECT * FROM vs.turnout($1)`, [electionId])).rows[0];
    return { ...r, turnout: tally } as {
      title: string; kind: string; org_name: string; definition: BallotDefinition;
      result: TallyResult; result_hash: string; completed_at: Date;
      turnout: { eligible: string; voted: string; units_eligible: string; units_voted: string };
    };
  });
}
