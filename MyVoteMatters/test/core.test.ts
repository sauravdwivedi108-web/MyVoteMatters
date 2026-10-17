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

test('board agenda: admin sets how many picks, each pick carries the voter\'s units, ties at the cut-off are reported', async () => {
  const org = await seedOrg(h.admin, 'agenda');
  const electionId = await createElection(h.app, org.orgId, org.maker, {
    title: 'Board 2026', kind: 'board_election', startsAt: new Date(Date.now() - 1000), endsAt: new Date(Date.now() + 60_000),
  });
  await importRoll(h.app, org.orgId, org.maker, electionId,
    [{ eligibilityRef: 'A', votingUnits: 100 }, { eligibilityRef: 'B', votingUnits: 40 }, { eligibilityRef: 'C', votingUnits: 5 }]);
  const def: BallotDefinition = { type: 'agenda', items: [
    { id: 'A1', title: 'Directors', description: '', minChoices: 1, maxChoices: 2,
      options: [{ id: 'O1', name: 'Asha' }, { id: 'O2', name: 'Ravi' }, { id: 'O3', name: 'Meera' }] },
    { id: 'A2', title: 'Chair', description: '', minChoices: 0, maxChoices: 1,
      options: [{ id: 'O1', name: 'Asha' }, { id: 'O2', name: 'Ravi' }] },
  ] };
  await assert.rejects(setBallotDefinition(h.app, org.orgId, org.maker, electionId,
    { type: 'agenda', items: [{ ...def.items[0], maxChoices: 4 }] }), /picks must be between/);
  await setBallotDefinition(h.app, org.orgId, org.maker, electionId, def);
  await submitForApproval(h.app, org.orgId, org.maker, electionId);
  const { tallyPrivateKeyPem } = await approveElection(h.app, org.orgId, org.checker, electionId);
  const creds = Object.fromEntries((await issueCredentials(h.app, org.orgId, org.maker, electionId)).map((c) => [c.eligibilityRef, c.secret]));
  await transition(h.app, org.orgId, org.maker, electionId, 'open');
  const cast = (ref: string, choices: Record<string, string>) => castVote(h.app, org.orgId, { electionId, credentialSecret: creds[ref], choices });

  // Too many picks, an unknown option, a missing item and too few picks are all refused.
  assert.equal((await cast('A', { A1: 'O1,O2,O3', A2: '' })).status, 'rejected');
  assert.equal((await cast('A', { A1: 'O9', A2: '' })).status, 'rejected');
  assert.equal((await cast('A', { A1: 'O1' })).status, 'rejected');
  assert.equal((await cast('A', { A1: '', A2: '' })).status, 'rejected');

  // Picks in any order are the same vote, so a retry in a different order is a replay, not a conflict.
  const a = await cast('A', { A1: 'O2,O1', A2: 'O1' });
  const again = await cast('A', { A1: 'O1,O2', A2: 'O1' });
  assert.equal(a.status, 'accepted'); assert.equal(again.status, 'accepted');
  assert.equal((again as { replayed: boolean }).replayed, true);
  assert.equal((await cast('B', { A1: 'O3', A2: '' })).status, 'accepted');
  assert.equal((await cast('C', { A1: 'O3', A2: 'O2' })).status, 'accepted');

  await transition(h.app, org.orgId, org.maker, electionId, 'closed');
  const r = await tallyElection(h.tally, org.orgId, 'svc:tally', electionId, tallyPrivateKeyPem);
  const [dir, chair] = r.agenda!;
  assert.deepEqual(dir.options.map((o) => [o.id, o.votes, o.ballots]), [['O1', '100', 1], ['O2', '100', 1], ['O3', '45', 2]]);
  assert.equal(dir.tiedAtCutoff, false);
  assert.deepEqual(dir.selected, ['O1', 'O2']);
  assert.deepEqual(chair.selected, ['O1']);
  assert.equal(chair.blankBallots, 1);
});

test('creditor vote: open ballot recorded by name, hidden until close, threshold on the whole roll', async () => {
  const org = await seedOrg(h.admin, 'coc');
  const electionId = await createElection(h.app, org.orgId, org.maker, {
    title: 'CoC meeting 4', kind: 'creditor_vote', startsAt: new Date(Date.now() - 1000), endsAt: new Date(Date.now() + 60_000),
  });
  await importRoll(h.app, org.orgId, org.maker, electionId, [
    { eligibilityRef: 'State Bank', votingUnits: 600 }, { eligibilityRef: 'Axis Bank', votingUnits: 300 }, { eligibilityRef: 'ARC One', votingUnits: 100 }]);
  await setBallotDefinition(h.app, org.orgId, org.maker, electionId, { type: 'agenda', items: [
    { id: 'A1', title: 'Resolution plan', description: '', minChoices: 1, maxChoices: 1, thresholdPct: 66,
      options: [{ id: 'O1', name: 'Plan by X Ltd', detail: 'Upfront 40%' }, { id: 'O2', name: 'Plan by Y Ltd' }] },
  ] });
  await submitForApproval(h.app, org.orgId, org.maker, electionId);
  const { tallyPrivateKeyPem } = await approveElection(h.app, org.orgId, org.checker, electionId);
  const creds = Object.fromEntries((await issueCredentials(h.app, org.orgId, org.maker, electionId)).map((c) => [c.eligibilityRef, c.secret]));
  await transition(h.app, org.orgId, org.maker, electionId, 'open');
  const report = () => withTenant(h.app, org.orgId, async (tx) => (await tx.query('SELECT * FROM vs.open_vote_report($1)', [electionId])).rows);

  assert.equal((await castVote(h.app, org.orgId, { electionId, credentialSecret: creds['State Bank'], choices: { A1: 'O1' } })).status, 'accepted');
  assert.equal((await castVote(h.app, org.orgId, { electionId, credentialSecret: creds['Axis Bank'], choices: { A1: 'O2' } })).status, 'accepted');

  const live = await report();
  assert.deepEqual(live.map((r) => [r.eligibility_ref, r.voted, r.choices]),
    [['State Bank', true, null], ['Axis Bank', true, null], ['ARC One', false, null]]);

  await transition(h.app, org.orgId, org.maker, electionId, 'closed');
  const after = await report();
  assert.deepEqual(after.map((r) => [r.eligibility_ref, r.choices]), [['State Bank', { A1: 'O1' }], ['Axis Bank', { A1: 'O2' }], ['ARC One', null]]);

  const r = await tallyElection(h.tally, org.orgId, 'svc:tally', electionId, tallyPrivateKeyPem);
  assert.equal(r.unitsEligible, '1000');
  // 600 of 1000 is 60%, below 66% of the whole committee, so nothing is approved.
  assert.deepEqual(r.agenda![0].selected, []);
});

test('creditor vote: a consumption without a named record is refused at commit', async () => {
  const org = await seedOrg(h.admin, 'coc2');
  const electionId = await createElection(h.app, org.orgId, org.maker, {
    title: 'CoC', kind: 'creditor_vote', startsAt: new Date(Date.now() - 1000), endsAt: new Date(Date.now() + 60_000),
  });
  await importRoll(h.app, org.orgId, org.maker, electionId, [{ eligibilityRef: 'Bank', votingUnits: 1 }]);
  await setBallotDefinition(h.app, org.orgId, org.maker, electionId, { type: 'agenda', items: [
    { id: 'A1', title: 'Plan', description: '', minChoices: 1, maxChoices: 1, options: [{ id: 'O1', name: 'For' }, { id: 'O2', name: 'Against' }] }] });
  await submitForApproval(h.app, org.orgId, org.maker, electionId);
  await approveElection(h.app, org.orgId, org.checker, electionId);
  const [c] = await issueCredentials(h.app, org.orgId, org.maker, electionId);
  await transition(h.app, org.orgId, org.maker, electionId, 'open');
  const { credentialHash } = await import('../lib/core/crypto');
  await assert.rejects(withTenant(h.app, org.orgId, (tx) => tx.query(
    `SELECT * FROM vs.cast_ballot($1, $2, 'tag', 'receipt', 1, '\\x00')`, [electionId, credentialHash(c.secret)])), /open_vote_missing/);
});

test('meeting: single admin locks, voters log in with ID and password, named results count against the whole roll', async () => {
  const { issueVoterLogins, resolveVoterLogin } = await import('../lib/core/voterLogins');
  const { countAgenda } = await import('../lib/core/agendaResults');
  const org = await seedOrg(h.admin, 'meet');
  const electionId = await createElection(h.app, org.orgId, org.maker, {
    title: 'CoC 3', kind: 'creditor_vote', startsAt: new Date(Date.now() - 1000), endsAt: new Date(Date.now() + 60_000),
  });
  await importRoll(h.app, org.orgId, org.maker, electionId, [
    { eligibilityRef: 'Bank A', votingUnits: 700 }, { eligibilityRef: 'Bank B', votingUnits: 200 }, { eligibilityRef: 'Bank C', votingUnits: 100 }]);
  const def: BallotDefinition = { type: 'agenda', items: [{ id: 'A1', title: 'Plan', description: '', minChoices: 1, maxChoices: 1, thresholdPct: 66,
    options: [{ id: 'O1', name: 'For' }, { id: 'O2', name: 'Against' }] }] };
  await setBallotDefinition(h.app, org.orgId, org.maker, electionId, def);
  // IDs cannot be issued before the meeting is locked.
  await assert.rejects(issueVoterLogins(h.app, org.orgId, org.maker, electionId), /forbidden/);
  await submitForApproval(h.app, org.orgId, org.maker, electionId);
  await approveElection(h.app, org.orgId, org.maker, electionId); // same person: allowed for creditor votes only
  const logins = await issueVoterLogins(h.app, org.orgId, org.maker, electionId);
  assert.equal(logins.length, 3);
  assert.match(logins[0].loginId, /^MV-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  const byName = Object.fromEntries(logins.map((l) => [l.eligibilityRef, l]));

  assert.equal(await resolveVoterLogin(h.app, byName['Bank A'].loginId, 'wrong-pass1'), null);
  // Reset gives a new password with the same ID; the old one stops working.
  const [reset] = await issueVoterLogins(h.app, org.orgId, org.maker, electionId, 'Bank B');
  assert.equal(reset.loginId, byName['Bank B'].loginId);
  assert.equal(await resolveVoterLogin(h.app, byName['Bank B'].loginId, byName['Bank B'].password), null);
  byName['Bank B'] = reset;

  await transition(h.app, org.orgId, org.maker, electionId, 'open');
  const vote = async (name: string, pick: string) => {
    const t = await resolveVoterLogin(h.app, byName[name].loginId.toLowerCase(), byName[name].password);
    assert.ok(t, `${name} can log in`);
    return castVote(h.app, org.orgId, { electionId, credentialSecret: t!.secret, choices: { A1: pick } });
  };
  assert.equal((await vote('Bank A', 'O1')).status, 'accepted');
  assert.equal((await vote('Bank B', 'O2')).status, 'accepted');
  assert.equal((await vote('Bank A', 'O2')).status, 'rejected');
  await transition(h.app, org.orgId, org.maker, electionId, 'closed');

  const rows = await withTenant(h.app, org.orgId, async (tx) => (await tx.query('SELECT * FROM vs.open_vote_report($1)', [electionId])).rows);
  const ballots = rows.filter((r) => r.choices).map((r) => ({ units: String(r.voting_units), choices: r.choices }));
  const [r] = countAgenda(def as never, ballots, '1000');
  assert.deepEqual(r.options.map((o) => [o.id, o.units, o.pctOfTotal]), [['O1', '700', 70], ['O2', '200', 20]]);
  assert.deepEqual(r.selected, ['O1']);
});

test('secret-ballot elections still need a second person to approve', async () => {
  const org = await seedOrg(h.admin, 'mc');
  const electionId = await createElection(h.app, org.orgId, org.maker, {
    title: 'AGM', kind: 'agm_resolutions', startsAt: new Date(Date.now() - 1000), endsAt: new Date(Date.now() + 60_000) });
  await importRoll(h.app, org.orgId, org.maker, electionId, [{ eligibilityRef: 'F1', votingUnits: 1 }]);
  await setBallotDefinition(h.app, org.orgId, org.maker, electionId, agmBallot);
  await submitForApproval(h.app, org.orgId, org.maker, electionId);
  await assert.rejects(approveElection(h.app, org.orgId, org.maker, electionId), /maker_checker/);
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

test('meeting: closing time can only be extended, and not after voting ends', async () => {
  const { extendVoting } = await import('../lib/core/elections');
  const org = await seedOrg(h.admin, 'ext');
  const end = new Date(Date.now() + 60_000);
  const electionId = await createElection(h.app, org.orgId, org.maker, {
    title: 'CoC ext', kind: 'creditor_vote', startsAt: new Date(Date.now() - 1000), endsAt: end,
  });
  await importRoll(h.app, org.orgId, org.maker, electionId, [{ eligibilityRef: 'Bank A', votingUnits: 10 }]);
  await setBallotDefinition(h.app, org.orgId, org.maker, electionId, { type: 'agenda', items: [{ id: 'A1', title: 'Plan', description: '', minChoices: 1, maxChoices: 1,
    options: [{ id: 'O1', name: 'For' }, { id: 'O2', name: 'Against' }] }] });
  await submitForApproval(h.app, org.orgId, org.maker, electionId);
  await approveElection(h.app, org.orgId, org.maker, electionId);
  await transition(h.app, org.orgId, org.maker, electionId, 'open');
  await assert.rejects(extendVoting(h.app, org.orgId, org.maker, electionId, new Date(end.getTime() - 30_000)), /config_frozen/);
  await extendVoting(h.app, org.orgId, org.maker, electionId, new Date(end.getTime() + 3600_000));
  await transition(h.app, org.orgId, org.maker, electionId, 'closed');
  await assert.rejects(extendVoting(h.app, org.orgId, org.maker, electionId, new Date(end.getTime() + 7200_000)), /config_frozen/);
});
