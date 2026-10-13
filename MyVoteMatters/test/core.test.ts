import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, seedOrg, Harness } from './harness';
import {
  createElection, importRoll, setBallotDefinition, submitForApproval, approveElection,
  issueCredentials, transition,
} from '../lib/core/elections';
import { castVote, verifyReceipt, turnout } from '../lib/core/voting';
import { tallyElection } from '../lib/core/tally';
import { withTenant } from '../lib/core/db';
import { encryptBallot, generateTallyKeyPair } from '../lib/core/crypto';
import type { BallotDefinition } from '../lib/core/ballot';

let h: Harness;
before(async () => { h = await setup(); });
after(async () => { await h.end(); });

const agmBallot: BallotDefinition = {
  type: 'resolutions',
  resolutions: [
    { id: 'R1', title: 'Adopt financial statements', text: 'To receive and adopt the audited accounts.', majority: 'ordinary' },
    { id: 'R2', title: 'Amend articles', text: 'To alter the Articles of Association.', majority: 'special' },
  ],
};

/** An approved, open AGM with credentials issued. */
async function openAgm(slug: string, roll = [
  { eligibilityRef: 'FOLIO-001', votingUnits: 100 },
  { eligibilityRef: 'FOLIO-002', votingUnits: 50 },
  { eligibilityRef: 'FOLIO-003', votingUnits: 25 },
]) {
  const org = await seedOrg(h.admin, slug);
  const electionId = await createElection(h.app, org.orgId, org.maker, {
    title: 'AGM 2026', kind: 'agm_resolutions',
    startsAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() + 3_600_000),
  });
  await importRoll(h.app, org.orgId, org.maker, electionId, roll);
  await setBallotDefinition(h.app, org.orgId, org.maker, electionId, agmBallot);
  await submitForApproval(h.app, org.orgId, org.maker, electionId);
  const { tallyPrivateKeyPem } = await approveElection(h.app, org.orgId, org.checker, electionId);
  const creds = Object.fromEntries(
    (await issueCredentials(h.app, org.orgId, org.maker, electionId)).map((c) => [c.eligibilityRef, c.secret]));
  await transition(h.app, org.orgId, org.maker, electionId, 'open');
  return { ...org, electionId, tallyPrivateKeyPem, creds };
}

test('AGM end to end: vote, close, reconcile and count weighted resolutions', async () => {
  const e = await openAgm('acme');
  const vote = (ref: string, R1: string, R2: string) =>
    castVote(h.app, e.orgId, { electionId: e.electionId, credentialSecret: e.creds[ref], choices: { R1, R2 } });

  const a = await vote('FOLIO-001', 'for', 'for');
  const b = await vote('FOLIO-002', 'against', 'against');
  const c = await vote('FOLIO-003', 'abstain', 'for');
  for (const r of [a, b, c]) assert.equal(r.status, 'accepted');

  // Receipts verify, and a made-up receipt does not.
  assert.equal(await verifyReceipt(h.app, e.orgId, e.electionId, (a as any).receiptCode), true);
  assert.equal(await verifyReceipt(h.app, e.orgId, e.electionId, 'not-a-receipt'), false);

  const t = await turnout(h.app, e.orgId, e.electionId);
  assert.equal(Number(t.voted), 3);
  assert.equal(String(t.units_voted), '175');

  // No counting while voting is open.
  await assert.rejects(tallyElection(h.tally, e.orgId, 'svc:tally', e.electionId, e.tallyPrivateKeyPem), /results_suppressed/);

  await transition(h.app, e.orgId, e.maker, e.electionId, 'closed');
  const result = await tallyElection(h.tally, e.orgId, 'svc:tally', e.electionId, e.tallyPrivateKeyPem);

  assert.equal(result.ballotCount, 3);
  assert.deepEqual(result.reconciliation, { consumptions: 3, ballots: 3, unitsConsumed: '175', unitsInBallots: '175' });
  const [r1, r2] = result.resolutions!;
  assert.deepEqual(r1.units, { for: '100', against: '50', abstain: '25' });
  assert.equal(r1.passed, true);                 // ordinary: 100 > 50
  assert.deepEqual(r2.units, { for: '125', against: '50', abstain: '0' });
  assert.equal(r2.passed, false);                // special: 125 < 3 x 50

  // Re-running the count is not possible once tallied; the recorded run is immutable.
  await assert.rejects(h.tally.query(`UPDATE vs.tally_runs SET ballot_count = 0`), /permission denied|immutable/);
  await transition(h.app, e.orgId, e.maker, e.electionId, 'published');
});

test('one vote per entitlement under concurrent submissions', async () => {
  const e = await openAgm('race');
  const attempts = await Promise.all(Array.from({ length: 12 }, (_, i) =>
    castVote(h.app, e.orgId, {
      electionId: e.electionId, credentialSecret: e.creds['FOLIO-001'],
      choices: { R1: i % 2 ? 'for' : 'against', R2: 'abstain' },
    })));
  const accepted = attempts.filter((r) => r.status === 'accepted' && !r.replayed);
  assert.equal(accepted.length, 1);
  for (const r of attempts) {
    if (r.status === 'rejected') assert.equal(r.reason, 'already_voted');
  }
  const t = await turnout(h.app, e.orgId, e.electionId);
  assert.equal(Number(t.voted), 1);
});

test('retrying the same ballot returns the original receipt and stores nothing new', async () => {
  const e = await openAgm('retry');
  const input = { electionId: e.electionId, credentialSecret: e.creds['FOLIO-002'], choices: { R1: 'for', R2: 'against' } };
  const first = await castVote(h.app, e.orgId, input);
  const again = await castVote(h.app, e.orgId, input);
  assert.equal(first.status, 'accepted');
  assert.equal(again.status, 'accepted');
  assert.equal((again as any).replayed, true);
  assert.equal((again as any).receiptCode, (first as any).receiptCode);

  const changed = await castVote(h.app, e.orgId, { ...input, choices: { R1: 'against', R2: 'against' } });
  assert.deepEqual(changed, { status: 'rejected', reason: 'already_voted' });

  await transition(h.app, e.orgId, e.maker, e.electionId, 'closed');
  const result = await tallyElection(h.tally, e.orgId, 'svc:tally', e.electionId, e.tallyPrivateKeyPem);
  assert.equal(result.ballotCount, 1);
});

test('an invalid ballot is refused without consuming the entitlement', async () => {
  const e = await openAgm('partial');
  const partial = await castVote(h.app, e.orgId, {
    electionId: e.electionId, credentialSecret: e.creds['FOLIO-001'], choices: { R1: 'for' } });
  assert.equal(partial.status, 'rejected');
  const bogus = await castVote(h.app, e.orgId, {
    electionId: e.electionId, credentialSecret: e.creds['FOLIO-001'], choices: { R1: 'for', R2: 'maybe' } });
  assert.equal(bogus.status, 'rejected');
  const ok = await castVote(h.app, e.orgId, {
    electionId: e.electionId, credentialSecret: e.creds['FOLIO-001'], choices: { R1: 'for', R2: 'for' } });
  assert.equal(ok.status, 'accepted');
});

test('votes are refused before opening and after closing', async () => {
  const org = await seedOrg(h.admin, 'timing');
  const electionId = await createElection(h.app, org.orgId, org.maker, {
    title: 'Early', kind: 'agm_resolutions', startsAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() + 60_000),
  });
  await importRoll(h.app, org.orgId, org.maker, electionId, [{ eligibilityRef: 'F1', votingUnits: 1 }]);
  await setBallotDefinition(h.app, org.orgId, org.maker, electionId, agmBallot);
  await submitForApproval(h.app, org.orgId, org.maker, electionId);
  await approveElection(h.app, org.orgId, org.checker, electionId);
  const [cred] = await issueCredentials(h.app, org.orgId, org.maker, electionId);
  const v = () => castVote(h.app, org.orgId, { electionId, credentialSecret: cred.secret, choices: { R1: 'for', R2: 'for' } });

  assert.deepEqual(await v(), { status: 'rejected', reason: 'voting_closed' });   // approved, not open
  await transition(h.app, org.orgId, org.maker, electionId, 'open');
  await transition(h.app, org.orgId, org.maker, electionId, 'closed');
  assert.deepEqual(await v(), { status: 'rejected', reason: 'voting_closed' });
  // Closed cannot be reopened.
  await assert.rejects(transition(h.app, org.orgId, org.maker, electionId, 'open'), /invalid_transition/);
});

test('secret ballot: the API role cannot read ballots and the tally role cannot read identities', async () => {
  const e = await openAgm('secrecy');
  await castVote(h.app, e.orgId, { electionId: e.electionId, credentialSecret: e.creds['FOLIO-001'], choices: { R1: 'for', R2: 'for' } });

  for (const table of ['ballot_submissions', 'vote_receipts', 'eligibility_consumptions']) {
    await assert.rejects(withTenant(h.app, e.orgId, (tx) => tx.query(`SELECT * FROM vs.${table}`)), /permission denied/, table);
  }
  for (const table of ['voter_eligibility', 'voting_credentials', 'eligibility_consumptions', 'audit_events']) {
    await assert.rejects(withTenant(h.tally, e.orgId, (tx) => tx.query(`SELECT * FROM vs.${table}`), 'vs_tally'), /permission denied/, table);
  }

  // Structural check: no column on the ballot side refers to a voter, an
  // eligibility record, a credential or a time of submission.
  const { rows } = await h.admin.query(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'vs' AND table_name IN ('ballot_submissions', 'vote_receipts')`);
  const cols = rows.map((r) => r.column_name);
  for (const forbidden of ['eligibility_id', 'credential_hash', 'user_id', 'retry_tag', 'accepted_at', 'created_at', 'consumed_at']) {
    assert.ok(!cols.includes(forbidden), `ballot side must not have ${forbidden}`);
  }
  const fks = await h.admin.query(
    `SELECT conrelid::regclass::text AS tbl, confrelid::regclass::text AS ref FROM pg_constraint
      WHERE contype = 'f' AND conrelid::regclass::text IN ('vs.ballot_submissions', 'vs.vote_receipts')`);
  for (const fk of fks.rows) assert.equal(fk.ref, 'vs.elections');
});

test('ciphertext length does not depend on the choices made', () => {
  const { publicKeyPem } = generateTallyKeyPair();
  const a = encryptBallot(JSON.stringify({ R1: 'for' }), publicKeyPem, 'e');
  const b = encryptBallot(JSON.stringify({ R1: 'abstain' }), publicKeyPem, 'e');
  assert.equal(a.length, b.length);
});

test('accepted ballots, receipts and published ballots are immutable even for the schema owner', async () => {
  const e = await openAgm('immutable');
  await castVote(h.app, e.orgId, { electionId: e.electionId, credentialSecret: e.creds['FOLIO-001'], choices: { R1: 'for', R2: 'for' } });
  await assert.rejects(h.owner.query(`UPDATE vs.ballot_submissions SET definition_version = 9`), /immutable_record/);
  await assert.rejects(h.owner.query(`DELETE FROM vs.ballot_submissions`), /immutable_record/);
  await assert.rejects(h.owner.query(`DELETE FROM vs.eligibility_consumptions`), /immutable_record/);
  await assert.rejects(h.owner.query(`DELETE FROM vs.vote_receipts`), /immutable_record/);
  await assert.rejects(h.owner.query(`UPDATE vs.ballot_definitions SET definition = '{}'`), /immutable_record/);

  // The voter roll and election configuration are frozen after approval.
  await assert.rejects(importRoll(h.app, e.orgId, e.maker, e.electionId, [{ eligibilityRef: 'LATE', votingUnits: 1_000_000 }]), /roll_frozen/);
  await assert.rejects(withTenant(h.app, e.orgId, (tx) =>
    tx.query(`UPDATE vs.voter_eligibility SET voting_units = 999999 WHERE eligibility_ref = 'FOLIO-002'`)), /roll_frozen/);
  await assert.rejects(withTenant(h.app, e.orgId, (tx) =>
    tx.query(`UPDATE vs.elections SET ends_at = ends_at + interval '1 day' WHERE id = $1`, [e.electionId])), /config_frozen/);
  await assert.rejects(withTenant(h.app, e.orgId, (tx) =>
    tx.query(`UPDATE vs.elections SET tally_public_key = 'x' WHERE id = $1`, [e.electionId])), /config_frozen/);
});

test('the API role cannot fake a tally', async () => {
  const e = await openAgm('faketally');
  await transition(h.app, e.orgId, e.maker, e.electionId, 'closed');
  await assert.rejects(withTenant(h.app, e.orgId, (tx) =>
    tx.query(`UPDATE vs.elections SET status = 'tallied' WHERE id = $1`, [e.electionId])), /only the tally worker/);
  await assert.rejects(withTenant(h.app, e.orgId, (tx) =>
    tx.query(`INSERT INTO vs.tally_runs (organization_id, election_id, definition_hash, input_manifest_hash, ballot_count, result, result_hash)
              VALUES (vs.current_org(), $1, 'x', 'x', 0, '{}', 'x')`, [e.electionId])), /permission denied/);
});

test('maker-checker: the submitter cannot approve their own election', async () => {
  const org = await seedOrg(h.admin, 'makerchecker');
  const electionId = await createElection(h.app, org.orgId, org.maker, {
    title: 'Self approve', kind: 'internal_poll', startsAt: new Date(), endsAt: new Date(Date.now() + 60_000),
  });
  await importRoll(h.app, org.orgId, org.maker, electionId, [{ eligibilityRef: 'E1', votingUnits: 1 }]);
  await setBallotDefinition(h.app, org.orgId, org.maker, electionId, {
    type: 'single_choice', question: 'Venue', candidates: [{ id: 'a', name: 'Delhi' }, { id: 'b', name: 'Mumbai' }] });
  await submitForApproval(h.app, org.orgId, org.maker, electionId);
  await assert.rejects(approveElection(h.app, org.orgId, org.maker, electionId), /maker_checker/);
});

test('tenant isolation: one organisation cannot see or vote in another', async () => {
  const a = await openAgm('tenant-a');
  const b = await seedOrg(h.admin, 'tenant-b');

  const seen = await withTenant(h.app, b.orgId, (tx) => tx.query(`SELECT id FROM vs.elections`));
  assert.equal(seen.rowCount, 0);
  const roll = await withTenant(h.app, b.orgId, (tx) => tx.query(`SELECT id FROM vs.voter_eligibility`));
  assert.equal(roll.rowCount, 0);

  const crossVote = await castVote(h.app, b.orgId, {
    electionId: a.electionId, credentialSecret: a.creds['FOLIO-001'], choices: { R1: 'for', R2: 'for' } });
  assert.equal(crossVote.status, 'rejected');

  await assert.rejects(withTenant(h.app, b.orgId, (tx) =>
    tx.query(`INSERT INTO vs.elections (organization_id, title, kind, starts_at, ends_at, created_by)
              VALUES ($1, 'x', 'internal_poll', now(), now() + interval '1h', $2)`, [a.orgId, b.maker])), /row-level security/);

  // Without a tenant set, nothing is visible at all.
  const none = await withTenant(h.app, null, (tx) => tx.query(`SELECT count(*)::int AS n FROM vs.elections`));
  assert.equal(none.rows[0].n, 0);
});

test('board election: single choice, weighted, ties are reported not broken', async () => {
  const org = await seedOrg(h.admin, 'board');
  const electionId = await createElection(h.app, org.orgId, org.maker, {
    title: 'Chair', kind: 'board_election', startsAt: new Date(Date.now() - 1000), endsAt: new Date(Date.now() + 60_000),
  });
  await importRoll(h.app, org.orgId, org.maker, electionId,
    [{ eligibilityRef: 'A', votingUnits: 10 }, { eligibilityRef: 'B', votingUnits: 10 }]);
  await setBallotDefinition(h.app, org.orgId, org.maker, electionId, {
    type: 'single_choice', question: 'Chair', candidates: [{ id: 'x', name: 'Asha' }, { id: 'y', name: 'Ravi' }] });
  await submitForApproval(h.app, org.orgId, org.maker, electionId);
  const { tallyPrivateKeyPem } = await approveElection(h.app, org.orgId, org.checker, electionId);
  const creds = await issueCredentials(h.app, org.orgId, org.maker, electionId);
  await transition(h.app, org.orgId, org.maker, electionId, 'open');
  await castVote(h.app, org.orgId, { electionId, credentialSecret: creds[0].secret, choices: { candidate: 'x' } });
  await castVote(h.app, org.orgId, { electionId, credentialSecret: creds[1].secret, choices: { candidate: 'y' } });
  await transition(h.app, org.orgId, org.maker, electionId, 'closed');
  const result = await tallyElection(h.tally, org.orgId, 'svc:tally', electionId, tallyPrivateKeyPem);
  assert.deepEqual(result.candidates!.map((c) => c.votes), ['10', '10']);
  assert.equal(result.winner, null);
});

test('roll import reports bad rows instead of guessing', async () => {
  const org = await seedOrg(h.admin, 'import');
  const electionId = await createElection(h.app, org.orgId, org.maker, {
    title: 'Import', kind: 'agm_resolutions', startsAt: new Date(), endsAt: new Date(Date.now() + 60_000),
  });
  const report = await importRoll(h.app, org.orgId, org.maker, electionId, [
    { eligibilityRef: 'OK-1', votingUnits: 10 },
    { eligibilityRef: 'OK-1', votingUnits: 10 },
    { eligibilityRef: '', votingUnits: 5 },
    { eligibilityRef: 'NEG', votingUnits: -3 },
    { eligibilityRef: 'FRAC', votingUnits: '2.5' },
  ]);
  assert.equal(report.accepted, 1);
  assert.deepEqual(report.rejected.map((r) => r.row), [2, 3, 4, 5]);
});

test('audit log is hash-chained and tampering is detected', async () => {
  const e = await openAgm('audit');
  const ok = await withTenant(h.app, e.orgId, (tx) => tx.query('SELECT vs.verify_audit_chain($1) AS bad', [e.orgId]));
  assert.equal(ok.rows[0].bad, null);

  // Even a superuser edit (bypassing the immutability trigger) is detected.
  await h.admin.query(`ALTER TABLE vs.audit_events DISABLE TRIGGER audit_immutable`);
  await h.admin.query(`UPDATE vs.audit_events SET actor_ref = 'user:someone-else'
                        WHERE seq = (SELECT min(seq) FROM vs.audit_events WHERE organization_id = $1)`, [e.orgId]);
  await h.admin.query(`ALTER TABLE vs.audit_events ENABLE TRIGGER audit_immutable`);
  const bad = await withTenant(h.app, e.orgId, (tx) => tx.query('SELECT vs.verify_audit_chain($1) AS bad', [e.orgId]));
  assert.notEqual(bad.rows[0].bad, null);
});
