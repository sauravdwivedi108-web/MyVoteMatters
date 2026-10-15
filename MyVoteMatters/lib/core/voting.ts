import type pg from 'pg';
import { withTenant } from './db';
import { BallotDefinition, Choices, normalizeChoices, validateChoices } from './ballot';
import { canonicalJson, credentialDerivations, credentialHash, encryptBallot, receiptCommitment, sha256Hex } from './crypto';

export type CastOutcome =
  | { status: 'accepted'; receiptCode: string; replayed: boolean }
  | { status: 'rejected'; reason: string };

/**
 * Casts a vote. Safe to retry: resubmitting the same choices with the same
 * credential returns the same receipt and creates nothing new, so a lost
 * response never leads to a second ballot or a false failure.
 *
 * Choices are never logged; they exist in plaintext only inside this call.
 */
export async function castVote(pool: pg.Pool, orgId: string, input: {
  electionId: string; credentialSecret: string; choices: Choices;
}): Promise<CastOutcome> {
  return withTenant(pool, orgId, async (tx) => {
    const ctx = await tx.query('SELECT * FROM vs.credential_context($1)', [credentialHash(input.credentialSecret)]);
    if (!ctx.rowCount || ctx.rows[0].election_id !== input.electionId) {
      return { status: 'rejected', reason: 'invalid_credential' };
    }
    const { rows: [ballot] } = await tx.query(
      `SELECT d.version, d.definition, el.tally_public_key, el.kind FROM ballot_definitions d
         JOIN elections el ON el.id = d.election_id
        WHERE d.election_id = $1 AND d.published_at IS NOT NULL`, [input.electionId]);
    if (!ballot) return { status: 'rejected', reason: 'voting_closed' };

    input = { ...input, choices: normalizeChoices(ballot.definition as BallotDefinition, input.choices) };
    const problem = validateChoices(ballot.definition as BallotDefinition, input.choices);
    if (problem) return { status: 'rejected', reason: `invalid_ballot: ${problem}` };

    const choicesHash = sha256Hex(canonicalJson(input.choices));
    const d = credentialDerivations(input.credentialSecret, input.electionId, choicesHash);
    const plaintext = canonicalJson({
      election: input.electionId,
      version: ballot.version,
      choices: input.choices,
      units: String(ctx.rows[0].voting_units),
    });
    const payload = encryptBallot(plaintext, ballot.tally_public_key, input.electionId);

    // A creditor vote is an open ballot: the choices are also recorded against the voter.
    const open = ballot.kind === 'creditor_vote';
    const { rows: [r] } = await tx.query(
      // FROM-clause call on purpose: `SELECT (f()).*` would run f once per column.
      open ? 'SELECT * FROM vs.cast_open_vote($1, $2, $3, $4, $5, $6, $7)' : 'SELECT * FROM vs.cast_ballot($1, $2, $3, $4, $5, $6)',
      [input.electionId, d.credentialHash, d.retryTag, d.receiptCommitment, ballot.version, payload,
       ...(open ? [canonicalJson(input.choices)] : [])]);
    if (r.outcome !== 'accepted') return { status: 'rejected', reason: r.outcome };
    return { status: 'accepted', receiptCode: d.receiptCode, replayed: r.replayed };
  });
}

/** Confirms a receipt was accepted into the ballot box. Reveals nothing about the choice. */
export async function verifyReceipt(pool: pg.Pool, orgId: string, electionId: string, receiptCode: string) {
  return withTenant(pool, orgId, async (tx) => {
    const { rows } = await tx.query('SELECT vs.verify_receipt($1, $2) AS ok', [electionId, receiptCommitment(receiptCode)]);
    return rows[0].ok as boolean;
  });
}

export async function turnout(pool: pg.Pool, orgId: string, electionId: string) {
  return withTenant(pool, orgId, async (tx) => (await tx.query('SELECT * FROM vs.turnout($1)', [electionId])).rows[0]);
}
