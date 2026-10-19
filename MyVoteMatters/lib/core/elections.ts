import type pg from 'pg';
import { withTenant, audit } from './db';
import { BallotDefinition, validateDefinition } from './ballot';
import { canonicalJson, credentialHash, generateTallyKeyPair, newCredentialSecret, sha256Hex } from './crypto';

export class DomainError extends Error {
  constructor(public code: string, message?: string) { super(message ?? code); }
}

export type ElectionInput = {
  title: string;
  kind: 'agm_resolutions' | 'board_election' | 'internal_poll' | 'creditor_vote';
  startsAt: Date;
  endsAt: Date;
  recordDate?: string;
  /** Creditor votes: open by themselves at `startsAt` once locked. */
  autoStart?: boolean;
};

export async function createElection(pool: pg.Pool, orgId: string, actorId: string, input: ElectionInput) {
  return withTenant(pool, orgId, async (tx) => {
    const { rows } = await tx.query(
      `INSERT INTO elections (organization_id, title, kind, starts_at, ends_at, record_date, created_by, auto_start)
       VALUES (vs.current_org(), $1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [input.title, input.kind, input.startsAt, input.endsAt, input.recordDate ?? null, actorId, !!input.autoStart],
    );
    await audit(tx, orgId, `user:${actorId}`, 'election.created', `election:${rows[0].id}`);
    return rows[0].id as string;
  });
}

export type RollRow = { eligibilityRef: string; votingUnits: string | number };
export type RollReport = { accepted: number; rejected: { row: number; ref: string; reason: string }[] };

/** Imports voting entitlements. Bad rows are reported, never silently fixed. */
export async function importRoll(pool: pg.Pool, orgId: string, actorId: string, electionId: string, rows: RollRow[]) {
  const report: RollReport = { accepted: 0, rejected: [] };
  const seen = new Set<string>();
  const valid: RollRow[] = [];
  rows.forEach((r, i) => {
    const ref = String(r.eligibilityRef ?? '').trim();
    const units = String(r.votingUnits ?? '').trim();
    if (!ref) return report.rejected.push({ row: i + 1, ref, reason: 'missing reference' });
    if (!/^[1-9]\d{0,19}$/.test(units)) return report.rejected.push({ row: i + 1, ref, reason: 'voting units must be a positive whole number' });
    if (seen.has(ref)) return report.rejected.push({ row: i + 1, ref, reason: 'duplicate reference in file' });
    seen.add(ref);
    valid.push({ eligibilityRef: ref, votingUnits: units });
  });
  return withTenant(pool, orgId, async (tx) => {
    for (const r of valid) {
      const res = await tx.query(
        `INSERT INTO voter_eligibility (organization_id, election_id, eligibility_ref, voting_units)
         VALUES (vs.current_org(), $1, $2, $3) ON CONFLICT (election_id, eligibility_ref) DO NOTHING`,
        [electionId, r.eligibilityRef, r.votingUnits],
      );
      if (res.rowCount) report.accepted++;
      else report.rejected.push({ row: rows.indexOf(r) + 1, ref: r.eligibilityRef, reason: 'already on the roll' });
    }
    await audit(tx, orgId, `user:${actorId}`, 'roll.imported', `election:${electionId}`,
      { accepted: report.accepted, rejected: report.rejected.length, file_hash: sha256Hex(canonicalJson(rows)) });
    return report;
  });
}

export async function setBallotDefinition(pool: pg.Pool, orgId: string, actorId: string, electionId: string, def: BallotDefinition) {
  const errors = validateDefinition(def);
  if (errors.length) throw new DomainError('invalid_ballot', errors.join('; '));
  return withTenant(pool, orgId, async (tx) => {
    const { rows } = await tx.query(
      `INSERT INTO ballot_definitions (organization_id, election_id, version, definition, definition_hash)
       SELECT vs.current_org(), $1, coalesce(max(version), 0) + 1, $2, $3
         FROM ballot_definitions WHERE election_id = $1 RETURNING version`,
      [electionId, canonicalJson(def), sha256Hex(canonicalJson(def))],
    );
    await audit(tx, orgId, `user:${actorId}`, 'ballot.drafted', `election:${electionId}`, { version: rows[0].version });
    return rows[0].version as number;
  });
}

export async function submitForApproval(pool: pg.Pool, orgId: string, actorId: string, electionId: string) {
  return withTenant(pool, orgId, async (tx) => {
    const { rows } = await tx.query(
      `SELECT (SELECT count(*) FROM voter_eligibility WHERE election_id = $1) AS roll,
              (SELECT count(*) FROM ballot_definitions WHERE election_id = $1) AS ballots`, [electionId]);
    if (Number(rows[0].roll) === 0) throw new DomainError('empty_roll');
    if (Number(rows[0].ballots) === 0) throw new DomainError('no_ballot');
    await tx.query(`UPDATE elections SET status = 'pending_approval', submitted_by = $2 WHERE id = $1`, [electionId, actorId]);
    await audit(tx, orgId, `user:${actorId}`, 'election.submitted', `election:${electionId}`);
  });
}

/**
 * Second-person approval. Freezes the latest ballot version, records its hash
 * and creates the tally key pair. The private key is returned exactly once,
 * for the key custodians to place in KMS/HSM; it is never stored here.
 */
export async function approveElection(pool: pg.Pool, orgId: string, approverId: string, electionId: string) {
  return withTenant(pool, orgId, async (tx) => {
    const { rows } = await tx.query(
      `SELECT id, version, definition_hash FROM ballot_definitions WHERE election_id = $1
        ORDER BY version DESC LIMIT 1`, [electionId]);
    const keys = generateTallyKeyPair();
    await tx.query(`UPDATE ballot_definitions SET published_at = now() WHERE id = $1`, [rows[0].id]);
    await tx.query(
      `UPDATE elections SET status = 'approved', approved_by = $2, approved_definition_hash = $3, tally_public_key = $4
        WHERE id = $1`, [electionId, approverId, rows[0].definition_hash, keys.publicKeyPem]);
    await audit(tx, orgId, `user:${approverId}`, 'election.approved', `election:${electionId}`,
      { definition_version: rows[0].version, definition_hash: rows[0].definition_hash });
    return { tallyPrivateKeyPem: keys.privateKeyPem, definitionHash: rows[0].definition_hash as string };
  });
}

/** Creates one credential per entitlement. Secrets go to the invitation job, never to storage. */
export async function issueCredentials(pool: pg.Pool, orgId: string, actorId: string, electionId: string) {
  return withTenant(pool, orgId, async (tx) => {
    const { rows } = await tx.query(
      `SELECT e.id, e.eligibility_ref FROM voter_eligibility e
        JOIN elections el ON el.id = e.election_id AND el.status IN ('approved', 'open')
        WHERE e.election_id = $1 AND e.status = 'eligible'
          AND NOT EXISTS (SELECT 1 FROM voting_credentials c WHERE c.eligibility_id = e.id AND c.revoked_at IS NULL)`,
      [electionId]);
    const issued: { eligibilityRef: string; secret: string }[] = [];
    for (const r of rows) {
      const secret = newCredentialSecret();
      await tx.query(
        `INSERT INTO voting_credentials (organization_id, election_id, eligibility_id, credential_hash)
         VALUES (vs.current_org(), $1, $2, $3)`, [electionId, r.id, credentialHash(secret)]);
      issued.push({ eligibilityRef: r.eligibility_ref, secret });
    }
    await audit(tx, orgId, `user:${actorId}`, 'credentials.issued', `election:${electionId}`, { count: issued.length });
    return issued;
  });
}

export async function transition(pool: pg.Pool, orgId: string, actorId: string, electionId: string,
                                 to: 'open' | 'closed' | 'published') {
  return withTenant(pool, orgId, async (tx) => {
    // A creditor vote started before its scheduled time records the moment it actually opened.
    const res = await tx.query(
      `UPDATE elections SET status = $2,
              starts_at = CASE WHEN $2 = 'open' AND kind = 'creditor_vote' AND starts_at > now() THEN now() ELSE starts_at END
        WHERE id = $1`, [electionId, to]);
    if (!res.rowCount) throw new DomainError('not_found');
    await audit(tx, orgId, `user:${actorId}`, `election.${to}`, `election:${electionId}`);
  });
}

/**
 * Opens a locked creditor vote whose start time has come, or closes one whose
 * closing time has passed. Cheap; called whenever a meeting is looked at.
 */
export async function applySchedule(pool: pg.Pool, orgId: string, electionId: string): Promise<'open' | 'closed' | null> {
  return withTenant(pool, orgId, async (tx) => (await tx.query('SELECT vs.apply_schedule($1) AS s', [electionId])).rows[0].s);
}

/** Moves the closing time of a creditor vote later, before it has closed. The database rejects anything else. */
export async function extendVoting(pool: pg.Pool, orgId: string, actorId: string, electionId: string, endsAt: Date) {
  return withTenant(pool, orgId, async (tx) => {
    const { rows: [old] } = await tx.query(`SELECT ends_at FROM elections WHERE id = $1`, [electionId]);
    if (!old) throw new DomainError('not_found');
    await tx.query(`UPDATE elections SET ends_at = $2 WHERE id = $1`, [electionId, endsAt]);
    await audit(tx, orgId, `user:${actorId}`, 'election.extended', `election:${electionId}`,
      { from: new Date(old.ends_at).toISOString(), to: endsAt.toISOString() });
  });
}
