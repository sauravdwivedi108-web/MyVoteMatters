import Link from 'next/link';
import { can, type Session } from '@/lib/auth';
import { getOpenVoteReport, type ElectionDetail } from '@/lib/queries';
import { OpenVoteReport } from '@/components/OpenVoteReport';
import {
  uploadRoll, saveBallot, submitElection, returnToDraft, approve, issueInvitations, openVoting, closeVoting, count, publish,
  deleteElection, removeVoters,
} from '@/lib/actions';
import { StatusBadge, kindLabel, ist, units } from '@/components/Status';
import { ActionForm, ActionButton, Submit } from '@/components/forms';
import { BallotBuilder } from '@/components/BallotBuilder';
import { picksLabel } from '@/lib/core/ballot';
import { ApprovePanel, InvitePanel } from '@/components/Panels';
import { Results, Reconciliation } from '@/components/Results';
import {
  Send, ShieldCheck, Link2, PlayCircle, Activity, KeyRound, BarChart3, Users, ListChecks, History, Globe, StopCircle, Trash2, X,
} from 'lucide-react';


const ORDER = ['draft', 'pending_approval', 'approved', 'open', 'closed', 'tallied', 'published'];
const STEPS = ['Set up', 'Approval', 'Links sent', 'Voting', 'Closed', 'Counted', 'Published'];

/** The original election screen, kept for secret-ballot elections created before meetings. */
export async function LegacyElection({ e, s }: { e: ElectionDetail; s: Session }) {

  const at = ORDER.indexOf(e.status);
  const draft = e.status === 'draft';
  const manage = can(s, 'manage');
  const creditor = e.kind === 'creditor_vote';
  const report = creditor && ['open', 'closed', 'tallied', 'published'].includes(e.status) ? await getOpenVoteReport(s, e.id) : null;
  const now = Date.now();
  const inWindow = now >= +new Date(e.starts_at) && now < +new Date(e.ends_at);
  const turnoutPct = e.eligible ? Math.round((e.voted / e.eligible) * 100) : 0;
  const publicUrl = `/results/${s.orgId}/${e.id}`;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="small muted"><Link href="/app/elections">Elections</Link> / {kindLabel(e.kind)}</div>
          <h1 style={{ marginTop: 4 }}>{e.title}</h1>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <StatusBadge status={e.status} />
            <span className="small muted">{ist(e.starts_at)} to {ist(e.ends_at)}</span>
            {e.record_date && <span className="small muted">· Record date {String(e.record_date).slice(0, 10)}</span>}
          </div>
        </div>
        {draft && manage && (
          <ActionButton action={deleteElection.bind(null, e.id)} className="btn danger small"
            confirm={`Delete "${e.title}" with its voter roll and ballot? This cannot be undone.`}>
            <Trash2 size={16} aria-hidden="true" /> Delete election
          </ActionButton>
        )}
      </div>

      <ol className="stepper" aria-label="Progress">
        {STEPS.map((label, i) => (
          <li key={label} className={i < at ? 'done' : i === at ? 'current' : ''} aria-current={i === at ? 'step' : undefined}>{label}</li>
        ))}
      </ol>

      <div className="stack">
        {/* ---------------- Next action ---------------- */}
        {e.status === 'draft' && manage && (
          <div className="card">
            <div className="card-head"><h2 className="h-icon"><Send size={20} aria-hidden="true" />Submit for approval</h2></div>
            <p className="muted">
              {e.eligible === 0 ? 'Import the voter roll first. ' : ''}{!e.ballot ? 'Build and save the ballot first. ' : ''}
              A second person will review and approve. After approval nothing below can change.
            </p>
            <ActionButton action={submitElection.bind(null, e.id)}>Submit for approval</ActionButton>
          </div>
        )}

        {e.status === 'pending_approval' && (
          <div className="card">
            <div className="card-head"><h2 className="h-icon"><ShieldCheck size={20} aria-hidden="true" />Approval</h2></div>
            <p>Submitted by <strong>{e.submitted_by_name ?? 'a colleague'}</strong>. Check the voter roll and ballot below before approving.</p>
            {can(s, 'approve') && e.submitted_by !== s.userId ? (
              <ApprovePanel action={approve.bind(null, e.id)} title={e.title} />
            ) : (
              <p className="notice info">
                {e.submitted_by === s.userId ? 'You submitted this election, so a different person must approve it.' : 'An approver needs to approve this election.'}
                {' '}<Link href="/app/team">Add an approver</Link> if you do not have one.
              </p>
            )}
            {manage && (
              <div style={{ marginTop: 12 }}>
                <ActionButton className="btn secondary small" action={returnToDraft.bind(null, e.id)}>Withdraw and edit</ActionButton>
              </div>
            )}
          </div>
        )}

        {(e.status === 'approved' || e.status === 'open') && manage && (
          <div className="card">
            <div className="card-head">
              <h2 className="h-icon"><Link2 size={20} aria-hidden="true" />Voting links</h2>
              <span className="small muted">{e.credentials} of {e.eligible} created</span>
            </div>
            <p className="muted">Each voter gets a private link to their ballot. It works on any phone or computer.</p>
            <InvitePanel action={issueInvitations.bind(null, e.id)} title={e.title} />
          </div>
        )}

        {e.status === 'approved' && manage && (
          <div className="card">
            <div className="card-head"><h2 className="h-icon"><PlayCircle size={20} aria-hidden="true" />Open voting</h2></div>
            {inWindow ? <p className="muted">The voting window has started. Open voting when the links have been sent.</p>
              : <p className="notice warn">The voting window {now < +new Date(e.starts_at) ? `starts ${ist(e.starts_at)}` : 'has ended'}. Votes are only accepted inside it.</p>}
            <ActionButton className="btn teal" action={openVoting.bind(null, e.id)} confirm="Open voting now?"><PlayCircle size={18} aria-hidden="true" /> Open voting</ActionButton>
          </div>
        )}

        {['open', 'closed', 'tallied', 'published'].includes(e.status) && (
          <div className="card">
            <div className="card-head">
              <h2 className="h-icon"><Activity size={20} aria-hidden="true" />Turnout</h2>
              {e.status === 'open' && manage && (
                <ActionButton className="btn danger small" action={closeVoting.bind(null, e.id)}
                  confirm="Close voting now? No more ballots will be accepted. This cannot be undone."><StopCircle size={16} aria-hidden="true" /> Close voting</ActionButton>
              )}
            </div>
            <div className="stats" style={{ marginBottom: 12 }}>
              <div className="stat"><div className="v">{e.voted} <span className="small muted">/ {e.eligible}</span></div><div className="k">Entitlements voted</div></div>
              <div className="stat"><div className="v">{turnoutPct}%</div><div className="k">Turnout</div></div>
              <div className="stat"><div className="v" style={{ fontSize: '1.2rem' }}>{units(e.units_voted)}</div><div className="k">of {units(e.units_eligible)} voting units</div></div>
            </div>
            <div className="meter" role="img" aria-label={`${turnoutPct}% turnout`}><span style={{ width: `${turnoutPct}%` }} /></div>
            {e.status === 'open' && <p className="small muted" style={{ marginTop: 10 }}>Results stay sealed until voting closes. Only turnout is visible.</p>}
          </div>
        )}

        {e.status === 'closed' && (
          <div className="card">
            <div className="card-head"><h2 className="h-icon"><KeyRound size={20} aria-hidden="true" />Count the votes</h2></div>
            {can(s, 'count') ? (
              <ActionForm action={count.bind(null, e.id)}>
                <p className="muted">Provide the tally key file saved at approval. The key is used for this count only and is not stored.</p>
                <div className="field"><label htmlFor="keyfile">Tally key file (.pem)</label><input id="keyfile" name="keyfile" type="file" accept=".pem,text/plain" /></div>
                <details className="field"><summary className="small">Or paste the key</summary>
                  <textarea name="key" className="mono" placeholder="-----BEGIN PRIVATE KEY-----" /></details>
                <Submit className="btn teal" pendingText="Decrypting and counting…">Count and reconcile</Submit>
              </ActionForm>
            ) : <p className="muted">A scrutinizer, election admin or owner holding the tally key can count.</p>}
          </div>
        )}

        {e.tally && e.ballot && (
          <div className="card">
            <div className="card-head">
              <h2 className="h-icon"><BarChart3 size={20} aria-hidden="true" />Results</h2>
              {e.status === 'tallied' && can(s, 'publish') && (
                <ActionButton action={publish.bind(null, e.id)} confirm="Publish these results? Anyone with the results link will be able to see them.">Publish results</ActionButton>
              )}
              {e.status === 'published' && <Link className="btn secondary small" href={publicUrl} target="_blank"><Globe size={16} aria-hidden="true" /> Public results page</Link>}
            </div>
            <Reconciliation result={e.tally} resultHash={e.tally.result_hash} />
            <Results definition={e.ballot.definition} result={e.tally} />
          </div>
        )}

        {report && e.ballot?.definition.type === 'agenda' && (
          <div className="card">
            <div className="card-head"><h2 className="h-icon"><Users size={20} aria-hidden="true" />Who voted for what</h2><span className="small muted">Open ballot</span></div>
            <OpenVoteReport title={e.title} definition={e.ballot.definition} rows={report} />
          </div>
        )}

        {/* ---------------- Configuration ---------------- */}
        <div className="grid-2">
          <div className="card">
            <div className="card-head">
              <h2 className="h-icon"><Users size={20} aria-hidden="true" />Voter roll</h2>
              <span className="small muted">{e.eligible} entitlements · {units(e.units_eligible)} units</span>
            </div>
            {draft && manage && (
              <ActionForm action={uploadRoll.bind(null, e.id)}>
                <div className="field">
                  {creditor ? <>
                    <label htmlFor="csv">Paste rows: creditor or stakeholder name, voting weight</label>
                    <textarea id="csv" name="csv" className="mono" placeholder={'State Bank of India, 4500000000\nAxis Bank, 1800000000\nOperational creditors (authorised rep), 320000000'} />
                  </> : <>
                    <label htmlFor="csv">Paste rows: reference, voting units</label>
                    <textarea id="csv" name="csv" className="mono" placeholder={'FOLIO-0001, 1500\nFOLIO-0002, 250\nDP-IN301234-5678, 10000'} />
                  </>}
                  <div className="hint">{creditor
                    ? 'One row per creditor or stakeholder. Use the admitted claim in rupees (or any weight); each voter\'s share of the total is worked out for you. Copy straight from Excel.'
                    : 'One row per entitlement (folio, client ID or member number). For a one-person-one-vote poll use 1 unit each. Copy straight from Excel.'}</div>
                </div>
                <Submit className="btn secondary" pendingText="Importing…">Import rows</Submit>
              </ActionForm>
            )}
            {!draft && <p className="small muted">Locked since approval.</p>}
            {e.roll.length > 0 && (
              <div className="table-wrap" style={{ maxHeight: 300, overflow: 'auto', marginTop: 12 }}>
                <table>
                  <thead><tr><th>Reference</th><th className="r">Units</th>{draft && manage && <th aria-label="Remove" />}</tr></thead>
                  <tbody>{e.roll.map((r) => (
                    <tr key={r.eligibility_ref}><td className="mono">{r.eligibility_ref}</td><td className="r num">{units(r.voting_units)}</td>
                      {draft && manage && (
                        <td className="r">
                          <ActionButton action={removeVoters.bind(null, e.id, r.eligibility_ref)} className="row-remove">
                            <X size={16} aria-label={`Remove ${r.eligibility_ref}`} />
                          </ActionButton>
                        </td>
                      )}
                    </tr>
                  ))}</tbody>
                </table>
                {e.eligible > e.roll.length && <p className="small muted">Showing the first {e.roll.length}.</p>}
              </div>
            )}
            {draft && manage && e.eligible > 0 && (
              <div style={{ marginTop: 12 }}>
                <ActionButton action={removeVoters.bind(null, e.id, undefined)} className="btn ghost small"
                  confirm={`Remove all ${e.eligible} voters from this roll?`}>
                  <Trash2 size={14} aria-hidden="true" /> Clear voter roll
                </ActionButton>
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-head">
              <h2 className="h-icon"><ListChecks size={20} aria-hidden="true" />Ballot</h2>
              {e.ballot && <span className="small muted">Version {e.ballot.version}{e.ballot.published ? ' · locked' : ''}</span>}
            </div>
            {draft && manage ? (
              <BallotBuilder kind={e.kind} initial={e.ballot?.definition ?? null} action={saveBallot.bind(null, e.id)} />
            ) : e.ballot ? (
              e.ballot.definition.type === 'resolutions' ? (
                <ol style={{ paddingLeft: 18, margin: 0 }}>
                  {e.ballot.definition.resolutions.map((r) => (
                    <li key={r.id} style={{ marginBottom: 10 }}><strong>{r.title}</strong> <span className="small muted">({r.majority})</span><div className="small muted">{r.text}</div></li>
                  ))}
                </ol>
              ) : e.ballot.definition.type === 'agenda' ? (
                <ol style={{ paddingLeft: 18, margin: 0 }}>
                  {e.ballot.definition.items.map((it) => (
                    <li key={it.id} style={{ marginBottom: 12 }}><strong>{it.title}</strong> <span className="small muted">({picksLabel(it.minChoices, it.maxChoices)})</span>
                      {it.description && <div className="small muted">{it.description}</div>}
                      <ul className="small">{it.options.map((o) => <li key={o.id}>{o.name}{o.detail ? <span className="muted"> · {o.detail}</span> : null}</li>)}</ul>
                    </li>
                  ))}
                </ol>
              ) : (
                <><p><strong>{e.ballot.definition.question}</strong></p><ul>{e.ballot.definition.candidates.map((c) => <li key={c.id}>{c.name}</li>)}</ul></>
              )
            ) : <p className="muted">No ballot yet.</p>}
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h2 className="h-icon"><History size={20} aria-hidden="true" />Audit trail</h2><span className="small muted">Hash-chained</span></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>When</th><th>Action</th><th>By</th><th>Hash</th></tr></thead>
              <tbody>
                {e.audit.map((a, i) => (
                  <tr key={i}><td className="small">{ist(a.event_time)}</td><td>{a.action}</td><td className="small">{a.actor}</td><td className="mono small muted">{a.hash.slice(0, 12)}…</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
