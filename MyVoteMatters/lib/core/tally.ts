import type pg from 'pg';
import { withTenant, audit } from './db';
import { BallotDefinition, validateChoices } from './ballot';
import { canonicalJson, decryptBallot, sha256Hex } from './crypto';
import { DomainError } from './elections';

type ResolutionResult = {
  id: string; majority: 'ordinary' | 'special';
  units: { for: string; against: string; abstain: string };
  ballots: { for: number; against: number; abstain: number };
  passed: boolean;
};
type CandidateResult = { id: string; name: string; votes: string };

export type TallyResult = {
  electionId: string;
  definitionHash: string;
  inputManifestHash: string;
  ballotCount: number;
  reconciliation: { consumptions: number; ballots: number; unitsConsumed: string; unitsInBallots: string };
  resolutions?: ResolutionResult[];
  candidates?: CandidateResult[];
  winner?: string | null;
};

/**
 * Ordinary resolution: votes for exceed votes against.
 * Special resolution: votes for are at least three times votes against
 * (Companies Act 2013, s.114(2)(c)). Abstentions count toward neither.
 * Counsel must confirm these rules for each customer's election type.
 */
const passes = (majority: 'ordinary' | 'special', f: bigint, a: bigint) =>
  majority === 'special' ? f > 0n && f >= 3n * a : f > a;

/**
 * Counts a closed election. Runs as vs_tally, the only role that can read the
 * ballot box, and only once the election is closed. Refuses to produce a
 * result unless the ballot box reconciles exactly with the entitlements
 * consumed on the identity side, by count and by voting units.
 */
export async function tallyElection(tallyPool: pg.Pool, orgId: string, actor: string, electionId: string,
                                    tallyPrivateKeyPem: string): Promise<TallyResult> {
  return withTenant(tallyPool, orgId, async (tx) => {
    const { rows: [def] } = await tx.query(
      `SELECT d.version, d.definition, d.definition_hash, el.approved_definition_hash
         FROM ballot_definitions d JOIN elections el ON el.id = d.election_id
        WHERE d.election_id = $1 AND d.published_at IS NOT NULL`, [electionId]);
    if (!def || def.definition_hash !== def.approved_definition_hash) throw new DomainError('definition_mismatch');
    const definition = def.definition as BallotDefinition;

    const input = (await tx.query('SELECT * FROM vs.tally_input($1)', [electionId])).rows;
    const t = (await tx.query('SELECT * FROM vs.turnout($1)', [electionId])).rows[0];

    const manifestHash = sha256Hex(canonicalJson({
      election: electionId, definition: def.definition_hash, ballots: input.map((b) => b.payload_hash),
    }));

    const resTotals = new Map<string, { units: Record<string, bigint>; ballots: Record<string, number> }>();
    const candTotals = new Map<string, bigint>();
    if (definition.type === 'resolutions') {
      for (const r of definition.resolutions) {
        resTotals.set(r.id, { units: { for: 0n, against: 0n, abstain: 0n }, ballots: { for: 0, against: 0, abstain: 0 } });
      }
    } else {
      for (const c of definition.candidates) candTotals.set(c.id, 0n);
    }

    let unitsInBallots = 0n;
    for (const b of input) {
      if (sha256Hex(b.encrypted_payload) !== b.payload_hash) throw new DomainError('payload_integrity_failure');
      const ballot = JSON.parse(decryptBallot(b.encrypted_payload, tallyPrivateKeyPem, electionId));
      if (ballot.election !== electionId || ballot.version !== def.version || b.definition_version !== def.version) {
        throw new DomainError('ballot_out_of_scope');
      }
      if (validateChoices(definition, ballot.choices)) throw new DomainError('invalid_ballot_in_box');
      const units = BigInt(ballot.units);
      unitsInBallots += units;
      if (definition.type === 'resolutions') {
        for (const [id, choice] of Object.entries(ballot.choices as Record<string, string>)) {
          const tot = resTotals.get(id)!;
          tot.units[choice] += units;
          tot.ballots[choice] += 1;
        }
      } else {
        // Weighted by voting units; a one-person-one-vote poll imports 1 unit each.
        candTotals.set(ballot.choices.candidate, candTotals.get(ballot.choices.candidate)! + units);
      }
    }

    const reconciliation = {
      consumptions: Number(t.voted), ballots: input.length,
      unitsConsumed: String(t.units_voted), unitsInBallots: unitsInBallots.toString(),
    };
    if (reconciliation.consumptions !== reconciliation.ballots || reconciliation.unitsConsumed !== reconciliation.unitsInBallots) {
      await audit(tx, orgId, actor, 'tally.reconciliation_failed', `election:${electionId}`, reconciliation);
      throw new DomainError('reconciliation_failed', JSON.stringify(reconciliation));
    }

    const result: TallyResult = {
      electionId, definitionHash: def.definition_hash, inputManifestHash: manifestHash,
      ballotCount: input.length, reconciliation,
    };
    if (definition.type === 'resolutions') {
      result.resolutions = definition.resolutions.map((r) => {
        const tot = resTotals.get(r.id)!;
        return {
          id: r.id, majority: r.majority,
          units: { for: tot.units.for.toString(), against: tot.units.against.toString(), abstain: tot.units.abstain.toString() },
          ballots: { for: tot.ballots.for, against: tot.ballots.against, abstain: tot.ballots.abstain },
          passed: passes(r.majority, tot.units.for, tot.units.against),
        };
      });
    } else {
      result.candidates = definition.candidates
        .map((c) => ({ id: c.id, name: c.name, votes: candTotals.get(c.id)!.toString() }));
      const sorted = [...result.candidates].sort((a, b) => (BigInt(b.votes) > BigInt(a.votes) ? 1 : -1));
      // A tie for first place is reported, never broken silently.
      result.winner = sorted.length > 1 && sorted[0].votes === sorted[1].votes ? null : sorted[0].id;
    }

    const resultHash = sha256Hex(canonicalJson(result));
    await tx.query(
      `INSERT INTO tally_runs (organization_id, election_id, definition_hash, input_manifest_hash, ballot_count, result, result_hash)
       VALUES (vs.current_org(), $1, $2, $3, $4, $5, $6)`,
      [electionId, def.definition_hash, manifestHash, input.length, canonicalJson(result), resultHash]);
    await tx.query(`UPDATE elections SET status = 'tallied' WHERE id = $1`, [electionId]);
    await audit(tx, orgId, actor, 'election.tallied', `election:${electionId}`,
      { input_manifest_hash: manifestHash, result_hash: resultHash });
    return result;
  }, 'vs_tally');
}
