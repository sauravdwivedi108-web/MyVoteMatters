import Link from 'next/link';
import { headers } from 'next/headers';
import type { Session } from '@/lib/auth';
import { can } from '@/lib/auth';
import { getMeetingVoters, auditChainBreak, type ElectionDetail } from '@/lib/queries';
import { saveBallot, uploadRoll, removeVoters, deleteElection } from '@/lib/actions';
import { addVoter, lockAndIssueIds, resetVoterPassword, issueMissingIds, startVoting, endVoting, extendVoting } from '@/lib/meetingActions';
import { picksLabel, type AgendaBallot } from '@/lib/core/ballot';
import { countAgenda } from '@/lib/core/agendaResults';
import { displayLoginId } from '@/lib/core/voterLogins';
import { ActionForm, ActionButton, Submit } from '../forms';
import { BallotBuilder } from '../BallotBuilder';
import { OpenVoteReport } from '../OpenVoteReport';
import { ist, units } from '../Status';
import { LockPanel, ResetPassword, IssueMissing, PrintButton, CopyButton, LoginChoiceFields } from './Credentials';
import {
  ListChecks, Users, KeyRound, Radio, BarChart3, History, PlayCircle, StopCircle, ShieldCheck, ShieldAlert, Trash2, X,
  CheckCircle2, CircleDot, Circle, ArrowRight, Link2, UserPlus, Upload, Scale, Clock, LayoutDashboard, CalendarClock,
} from 'lucide-react';

export const MEETING_STATUS: Record<string, [string, string]> = {
  draft: ['Setting up', 'draft'], pending_approval: ['Setting up', 'draft'], approved: ['Ready to start', 'approved'],
  open: ['Voting live', 'open'], closed: ['Voting closed', 'closed'], tallied: ['Voting closed', 'closed'], published: ['Voting closed', 'closed'],
};

const share = (part: string | bigint, total: bigint) =>
  total === 0n ? '0.00%' : `${(Number((BigInt(part) * 1000000n) / total) / 10000).toFixed(2)}%`;

export async function Meeting({ e, s, tab }: { e: ElectionDetail; s: Session; tab: string }) {
  const manage = can(s, 'manage');
  const voters = await getMeetingVoters(s, e.id);
  const broken = tab === 'audit' || tab === 'results' ? await auditChainBreak(s) : null;
  const closedAt = e.audit.find((a) => a.action === 'election.closed')?.event_time ?? null;
  const h = await headers();
  const loginUrl = `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('x-forwarded-host') ?? h.get('host')}/voter`;

  const def = e.ballot?.definition.type === 'agenda' ? (e.ballot.definition as AgendaBallot) : null;
  const total = voters.reduce((n, v) => n + BigInt(v.voting_units), 0n);
  const voted = voters.filter((v) => v.voted);
  const votedUnits = voted.reduce((n, v) => n + BigInt(v.voting_units), 0n);
  const draft = e.status === 'draft' || e.status === 'pending_approval';
  const closed = ['closed', 'tallied', 'published'].includes(e.status);
  const [label, badge] = MEETING_STATUS[e.status] ?? [e.status, 'draft'];
  const missingIds = voters.filter((v) => !v.has_login).length;

  const steps = [
    { key: 'questions', tab: 'questions', label: 'Questions', icon: ListChecks, done: !!def },
    { key: 'voters', tab: 'voters', label: 'Voters', icon: Users, done: voters.length > 0 },
    { key: 'ids', tab: 'overview', label: 'Voter IDs', icon: KeyRound, done: !draft },
    { key: 'voting', tab: 'overview', label: 'Voting', icon: Radio, done: closed, live: e.status === 'open' },
    { key: 'results', tab: 'results', label: 'Results', icon: BarChart3, done: false, live: closed },
  ];
  const current = steps.findIndex((st) => !st.done);

  const tabs = [
    ['overview', 'Overview', LayoutDashboard], ['questions', `Questions${def ? ` (${def.items.length})` : ''}`, ListChecks],
    ['voters', `Voters (${voters.length})`, Users], ['results', 'Results', BarChart3], ['audit', 'Audit log', History],
  ] as const;
  const active = tabs.some(([k]) => k === tab) ? tab : 'overview';

  return (
    <>
      <div className="page-head">
        <div>
          <div className="small muted"><Link href="/app/elections">Meetings</Link> / Open ballot</div>
          <h1 style={{ marginTop: 4 }}>{e.title}</h1>
          <div className="meta-row">
            <span className={`badge ${badge}`}>{label}</span>
            <span className="small muted h-icon" style={{ gap: 6 }}><Clock size={14} aria-hidden="true" /> {closedAt ? <>Voting ended {ist(closedAt)}</> : e.auto_start && !['open'].includes(e.status)
              ? <>Voting {ist(e.starts_at)} to {ist(e.ends_at)}</> : <>Voting closes {ist(e.ends_at)}</>}</span>
            {e.record_date && <span className="small muted">Record date {new Date(e.record_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>}
          </div>
        </div>
        {draft && manage && (
          <ActionButton action={deleteElection.bind(null, e.id)} className="btn ghost small"
            confirm={`Delete "${e.title}" with its questions and voters? This cannot be undone.`}>
            <Trash2 size={16} aria-hidden="true" /> Delete meeting
          </ActionButton>
        )}
      </div>

      <ol className="tracker" aria-label="Progress">
        {steps.map((st, i) => {
          const state = st.done ? 'done' : i === current ? 'current' : '';
          const Icon = st.done ? CheckCircle2 : i === current ? CircleDot : Circle;
          return (
            <li key={st.key} className={`${state}${st.tab === active ? ' viewing' : ''}`} aria-current={i === current ? 'step' : undefined}>
              <Link href={`?tab=${st.tab}`} title={`Go to ${st.label}`}><Icon size={18} aria-hidden="true" /><span>{i + 1}. {st.label}</span></Link>
            </li>
          );
        })}
      </ol>

      {/* ---------- What to do next ---------- */}
      {manage && (
        <div className="card next-card">
          {draft && !def && <Next icon={ListChecks} title="Add the questions" text="Write each question voters must answer, with its options and their descriptions.">
            <Link className="btn" href="?tab=questions">Add questions <ArrowRight size={18} aria-hidden="true" /></Link></Next>}
          {draft && def && !voters.length && <Next icon={Users} title="Add the voters" text="Add each shareholder or creditor with their voting weight, such as shares held or admitted claim.">
            <Link className="btn" href="?tab=voters">Add voters <ArrowRight size={18} aria-hidden="true" /></Link></Next>}
          {draft && def && voters.length > 0 && <Next icon={KeyRound} title="Lock the meeting and create voter IDs"
            text={`${def.items.length} question${def.items.length === 1 ? '' : 's'} and ${voters.length} voter${voters.length === 1 ? '' : 's'} are ready. Locking freezes them and gives every voter a login ID and password.`}>
            <LockPanel action={lockAndIssueIds.bind(null, e.id)} meeting={e.title} org={s.orgName} loginUrl={loginUrl} /></Next>}
          {e.status === 'approved' && <Next icon={PlayCircle} title={e.auto_start ? `Share the voter IDs. Voting opens by itself on ${ist(e.starts_at)}` : 'Share the voter IDs, then start voting'}
            text={e.auto_start
              ? `Voters log in at ${loginUrl}. They can vote from ${ist(e.starts_at)} until ${ist(e.ends_at)}. You can also start it earlier.`
              : `Voters log in at ${loginUrl}. Nobody can vote until you start.`}>
            <ActionButton action={startVoting.bind(null, e.id)} className="btn teal" confirm="Start voting now? Voters can log in and vote straight away.">
              <PlayCircle size={18} aria-hidden="true" /> {e.auto_start ? 'Start voting now' : 'Start voting'}</ActionButton></Next>}
          {e.status === 'open' && <Next icon={Radio} title="Voting is live"
            text={`${voted.length} of ${voters.length} voters have voted, holding ${share(votedUnits, total)} of the total voting share. Results unlock when you end voting.`}>
            <ActionButton action={endVoting.bind(null, e.id)} className="btn danger" confirm="End voting now? Nobody will be able to vote after this, and results will be shown.">
              <StopCircle size={18} aria-hidden="true" /> End voting</ActionButton>
            {voters.length > voted.length && (
              <details className="pending-list">
                <summary>Not voted yet ({voters.length - voted.length})</summary>
                <ul>{voters.filter((v) => !v.voted).map((v) => <li key={v.eligibility_ref}><span>{v.eligibility_ref}</span><span className="small muted">{v.login_id ? displayLoginId(v.login_id) : 'no ID'} · {share(BigInt(v.voting_units), total)}</span></li>)}</ul>
                <CopyButton label="Copy reminder list" text={`Reminder: please vote in "${e.title}" before ${ist(e.ends_at)}. Log in at ${loginUrl}\n\n` + voters.filter((v) => !v.voted).map((v) => `${v.eligibility_ref} (${v.login_id ? displayLoginId(v.login_id) : 'no ID'})`).join('\n')} />
              </details>
            )}
            {manage && <ExtendForm id={e.id} endsAt={e.ends_at} />}</Next>}
          {closed && <Next icon={BarChart3} title="Voting has closed. Results are final."
            text={`${voted.length} of ${voters.length} voters voted, holding ${share(votedUnits, total)} of the total voting share.`}>
            <Link className="btn" href="?tab=results">See results <ArrowRight size={18} aria-hidden="true" /></Link></Next>}
        </div>
      )}

      <nav className="tabs" aria-label="Meeting sections">
        {tabs.map(([k, l, Icon]) => (
          <Link key={k} href={`?tab=${k}`} className={k === active ? 'on' : ''} aria-current={k === active ? 'page' : undefined}>
            <Icon size={16} aria-hidden="true" />{l}
          </Link>
        ))}
      </nav>

      {active === 'overview' && (
        <div className="stack">
          <div className="stats">
            <Stat icon={ListChecks} v={def ? def.items.length : 0} k="Questions" />
            <Stat icon={Users} v={voters.length} k="Voters" />
            <Stat icon={Scale} v={units(total)} k="Total voting weight" />
            <Stat icon={Radio} v={voters.length ? `${Math.round((voted.length / voters.length) * 100)}%` : '0%'} k={`Voted (${share(votedUnits, total)} of share)`} tone="teal" />
          </div>
          <div className="grid-2">
            <div className="card">
              <h2 className="h-icon"><Link2 size={20} aria-hidden="true" />How voters take part</h2>
              <ol className="plain-steps">
                <li>You give each voter their <strong>voter ID and password</strong> (from the sheet created when you lock the meeting).</li>
                <li>They open <span className="mono">{loginUrl}</span> on any phone or computer and log in.</li>
                <li>They answer one question at a time, review, and confirm. Each ID votes once.</li>
                <li>You see who has voted live, and every choice by name once voting ends.</li>
              </ol>
            </div>
            <div className="card">
              <h2 className="h-icon"><ShieldCheck size={20} aria-hidden="true" />Controls in place</h2>
              <ul className="check-list">
                <li><CheckCircle2 size={16} aria-hidden="true" /> Questions and voters are frozen before voting, with their fingerprint recorded.</li>
                <li><CheckCircle2 size={16} aria-hidden="true" /> One vote per voter ID, enforced by the database; votes cannot be edited or deleted.</li>
                <li><CheckCircle2 size={16} aria-hidden="true" /> Individual choices stay hidden until voting ends.</li>
                <li><CheckCircle2 size={16} aria-hidden="true" /> Every action is written to a tamper-evident, hash-chained audit log.</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {active === 'questions' && (
        <div className="card">
          <div className="card-head">
            <h2 className="h-icon"><ListChecks size={20} aria-hidden="true" />Questions</h2>
            {!draft && <span className="small muted h-icon" style={{ gap: 6 }}><ShieldCheck size={14} aria-hidden="true" /> Locked</span>}
          </div>
          {draft && manage ? (
            <BallotBuilder kind="creditor_vote" initial={e.ballot?.definition ?? null} action={saveBallot.bind(null, e.id)} />
          ) : def ? (
            <ol className="q-list">
              {def.items.map((it) => (
                <li key={it.id}>
                  <strong>{it.title}</strong>
                  <div className="small muted">{picksLabel(it.minChoices, it.maxChoices)}{it.thresholdPct !== undefined && ` · needs ${it.thresholdPct}% of total voting share`}</div>
                  {it.description && <p className="small" style={{ whiteSpace: 'pre-wrap', margin: '6px 0' }}>{it.description}</p>}
                  <ul>{it.options.map((o) => <li key={o.id}>{o.name}{o.detail && <div className="small muted" style={{ whiteSpace: 'pre-wrap' }}>{o.detail}</div>}</li>)}</ul>
                </li>
              ))}
            </ol>
          ) : <p className="muted">No questions yet.</p>}
        </div>
      )}

      {active === 'voters' && (
        <div className="stack">
          {draft && manage && (
            <div className="grid-2">
              <div className="card">
                <h2 className="h-icon"><UserPlus size={20} aria-hidden="true" />Add a voter</h2>
                <ActionForm action={addVoter.bind(null, e.id)}>
                  <div className="field"><label htmlFor="vname">Name</label><input id="vname" name="name" type="text" required placeholder="e.g. State Bank of India" /></div>
                  <div className="field"><label htmlFor="vweight">Voting weight <span className="hint">shares held or admitted claim in ₹, whole number</span></label>
                    <input id="vweight" name="weight" type="text" inputMode="numeric" required placeholder="e.g. 4,50,00,000" /></div>
                  <LoginChoiceFields />
                  <Submit pendingText="Adding…"><UserPlus size={18} aria-hidden="true" /> Add voter</Submit>
                </ActionForm>
              </div>
              <div className="card">
                <h2 className="h-icon"><Upload size={20} aria-hidden="true" />Add many at once</h2>
                <ActionForm action={uploadRoll.bind(null, e.id)}>
                  <div className="field">
                    <label htmlFor="csv">Paste rows: name, voting weight</label>
                    <textarea id="csv" name="csv" className="mono" style={{ minHeight: 104 }} placeholder={'State Bank of India, 4500000000\nAxis Bank, 1800000000\nRamesh Gupta, 2500'} />
                    <div className="hint">Copy two columns straight from Excel. Each voter’s % share is worked out for you.</div>
                  </div>
                  <Submit className="btn secondary" pendingText="Importing…">Import rows</Submit>
                </ActionForm>
              </div>
            </div>
          )}
          <div className="card">
            <div className="card-head">
              <h2 className="h-icon"><Users size={20} aria-hidden="true" />Voters</h2>
              <span className="small muted">{voters.length} voters · total weight {units(total)}</span>
            </div>
            {!draft && missingIds > 0 && manage && !closed && (
              <div className="notice warn">{missingIds} voter{missingIds === 1 ? ' has' : 's have'} no working ID. <IssueMissing action={issueMissingIds.bind(null, e.id)} meeting={e.title} org={s.orgName} loginUrl={loginUrl} /></div>
            )}
            {voters.length ? (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Voter</th><th className="r">Weight</th><th className="r">Share</th>{!draft && <th>Voter ID</th>}{!draft && <th>Status</th>}<th aria-label="Actions" /></tr></thead>
                  <tbody>
                    {voters.map((v) => (
                      <tr key={v.eligibility_ref}>
                        <td><strong>{v.eligibility_ref}</strong>{draft && v.chosen_login_id && <div className="small muted">Your chosen ID: <span className="mono">{displayLoginId(v.chosen_login_id)}</span></div>}</td>
                        <td className="r num">{units(v.voting_units)}</td>
                        <td className="r num">{share(v.voting_units, total)}</td>
                        {!draft && <td className="mono">{v.login_id ? displayLoginId(v.login_id) : '—'}</td>}
                        {!draft && <td>{v.voted ? <span className="badge open">Voted</span> : <span className="badge draft">Not yet</span>}</td>}
                        <td className="r">
                          {draft && manage && (
                            <ActionButton action={removeVoters.bind(null, e.id, v.eligibility_ref)} className="row-remove">
                              <X size={16} aria-label={`Remove ${v.eligibility_ref}`} />
                            </ActionButton>
                          )}
                          {!draft && !closed && manage && !v.voted && v.login_id && (
                            <ResetPassword action={resetVoterPassword.bind(null, e.id, v.eligibility_ref)} name={v.eligibility_ref} />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="muted">No voters yet.</p>}
          </div>
        </div>
      )}

      {active === 'results' && (
        <div className="stack">
          {!closed ? (
            <div className="card empty">
              <BarChart3 size={30} aria-hidden="true" />
              <h2>Results unlock when voting ends</h2>
              <p className="muted">{e.status === 'open'
                ? `${voted.length} of ${voters.length} voters have voted so far (${share(votedUnits, total)} of the total voting share). See who on the Voters tab.`
                : 'Voting has not started yet.'}</p>
            </div>
          ) : def && (
            <>
              <div className="print-only report-head">
                <div className="small">MyVoteMatters · Results report</div>
                <h1>{e.title}</h1>
                <div>{s.orgName}</div>
                <div className="small">{closedAt ? <>Voting ended {ist(closedAt)} · </> : null}Report generated {ist(new Date())} · {voted.length} of {voters.length} voters voted ({share(votedUnits, total)} of the total voting share)</div>
                <div className="small">Audit log: {broken === null ? 'hash chain verified, no entry changed or removed' : `chain break at entry ${broken}`}</div>
              </div>
              <div className="card">
                <div className="card-head">
                  <h2 className="h-icon"><BarChart3 size={20} aria-hidden="true" />Results</h2>
                  <PrintButton />
                </div>
                <p className="small muted" style={{ marginTop: -6 }}>
                  {voted.length} of {voters.length} voters voted, holding {share(votedUnits, total)} of the total voting share of {units(total)}.
                  Percentages of total voting share count every voter on the list, including those who did not vote.
                </p>
                <MeetingResults def={def} voters={voters} total={total} />
              </div>
              <div className="card">
                <div className="card-head"><h2 className="h-icon"><Users size={20} aria-hidden="true" />Who voted for what</h2></div>
                <OpenVoteReport title={e.title} definition={def} rows={voters} />
              </div>
              <div className="print-only report-sign">
                <div><span />Resolution professional / Administrator</div>
                <div><span />Scrutinizer</div>
                <div><span />Date and place</div>
              </div>
            </>
          )}
        </div>
      )}

      {active === 'audit' && (
        <div className="card">
          <div className="card-head">
            <h2 className="h-icon"><History size={20} aria-hidden="true" />Audit log</h2>
            {broken === null
              ? <span className="badge open"><ShieldCheck size={14} aria-hidden="true" /> Chain verified</span>
              : <span className="badge pending_approval"><ShieldAlert size={14} aria-hidden="true" /> Break at entry {broken}</span>}
          </div>
          <p className="small muted" style={{ marginTop: -6 }}>
            Each entry includes the fingerprint (hash) of the one before it, so changing or removing any entry breaks the chain. The chain is re-checked every time this page opens.
          </p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>When (IST)</th><th>Action</th><th>By</th><th>Fingerprint</th></tr></thead>
              <tbody>
                {e.audit.map((a) => (
                  <tr key={a.hash}><td className="small">{ist(a.event_time)}</td><td>{auditLabel(a.action)}{auditNote(a)}</td><td>{a.actor}</td><td className="mono small">{a.hash.slice(0, 16)}…</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

const AUDIT: Record<string, string> = {
  'election.created': 'Meeting created', 'ballot.drafted': 'Questions saved', 'roll.imported': 'Voters added',
  'roll.entry_removed': 'Voter removed', 'roll.cleared': 'Voter list cleared', 'election.submitted': 'Meeting locked',
  'election.approved': 'Questions and voters frozen', 'voter_ids.issued': 'Voter IDs created', 'voter.password_reset': 'Voter password reset',
  'election.open': 'Voting started', 'election.closed': 'Voting ended', 'election.deleted': 'Meeting deleted',
  'vote.cast': 'Vote cast', 'election.extended': 'Closing time extended',
};
const auditLabel = (a: string) => AUDIT[a] ?? a;
const auditNote = (a: { action: string; detail: Record<string, unknown> }) => {
  const d = a.detail ?? {};
  if (a.action === 'vote.cast' && (d.ip || d.device)) return <div className="small muted">IP {String(d.ip ?? '?')} · {String(d.device ?? '')}</div>;
  if (a.action === 'election.extended' && d.to) return <div className="small muted">New closing time {ist(String(d.to))}</div>;
  return null;
};

function Next({ icon: Icon, title, text, children }: { icon: typeof ListChecks; title: string; text: string; children: React.ReactNode }) {
  return (
    <div className="next">
      <span className="next-icon" aria-hidden="true"><Icon size={22} /></span>
      <div className="next-body">
        <div className="small muted" style={{ fontWeight: 650, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Next step</div>
        <h2 style={{ margin: '2px 0 4px' }}>{title}</h2>
        <p className="muted" style={{ marginBottom: 12 }}>{text}</p>
        {children}
      </div>
    </div>
  );
}

function Stat({ icon: Icon, v, k, tone }: { icon: typeof ListChecks; v: React.ReactNode; k: string; tone?: string }) {
  return <div className="stat"><span className={`stat-icon ${tone ?? ''}`} aria-hidden="true"><Icon size={18} /></span><div className="v">{v}</div><div className="k">{k}</div></div>;
}


function MeetingResults({ def, voters, total }: { def: AgendaBallot; voters: { voting_units: string; choices: Record<string, string> | null }[]; total: bigint }) {
  const ballots = voters.filter((v) => v.choices).map((v) => ({ units: v.voting_units, choices: v.choices! }));
  const results = countAgenda(def, ballots, total.toString());
  return (
    <div className="stack">
      {results.map((r, i) => (
        <div key={r.id} className="item" style={{ background: '#fff' }}>
          <div className="item-head" style={{ alignItems: 'flex-start' }}>
            <div>
              <div className="small muted">Question {i + 1}{r.thresholdPct !== undefined ? ` · needs ${r.thresholdPct}% of total voting share` : ` · top ${r.seats} ${r.seats === 1 ? 'wins' : 'win'}`}</div>
              <strong>{r.title}</strong>
            </div>
            {r.selected.length
              ? <span className="badge open">{r.thresholdPct !== undefined ? 'Approved' : 'Decided'}</span>
              : <span className="badge pending_approval">{r.tiedAtCutoff ? 'Tie' : 'Not approved'}</span>}
          </div>
          {r.tiedAtCutoff && <div className="notice warn">Two or more options are tied for the last place. Ties are reported, never broken automatically.</div>}
          {r.thresholdPct !== undefined && !r.selected.length && !r.tiedAtCutoff && <div className="notice warn">No option reached {r.thresholdPct}% of the total voting share.</div>}
          <div className="table-wrap">
            <table>
              <thead><tr><th>Option</th><th className="r">Weight</th><th className="r">% of total share</th><th className="r">% of votes cast</th><th className="r">Voters</th></tr></thead>
              <tbody>
                {[...r.options].sort((a, b) => b.pctOfTotal - a.pctOfTotal).map((o) => (
                  <tr key={o.id}>
                    <td>{o.name} {r.selected.includes(o.id) && <span className="badge open" style={{ marginLeft: 6 }}>{r.thresholdPct !== undefined ? 'Approved' : 'Selected'}</span>}
                      {o.abstain && <span className="badge draft" style={{ marginLeft: 6 }}>Not counted for approval</span>}
                      <div className="meter" aria-hidden="true" style={{ marginTop: 6 }}>
                        <span style={{ width: `${o.pctOfTotal}%` }} />
                        {r.thresholdPct !== undefined && <i className="meter-mark" style={{ left: `${r.thresholdPct}%` }} />}
                      </div></td>
                    <td className="r num">{units(o.units)}</td>
                    <td className="r num"><strong>{o.pctOfTotal.toFixed(2)}%</strong></td>
                    <td className="r num">{o.pctOfCast.toFixed(2)}%</td>
                    <td className="r num">{o.voters}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {r.blank > 0 && <p className="small muted" style={{ marginBottom: 0 }}>{r.blank} voter{r.blank === 1 ? '' : 's'} made no choice on this question.</p>}
        </div>
      ))}
    </div>
  );
}

const toIstInput = (d: string | Date) => new Date(new Date(d).getTime() + 5.5 * 3600_000).toISOString().slice(0, 16);

function ExtendForm({ id, endsAt }: { id: string; endsAt: string | Date }) {
  return (
    <details className="pending-list">
      <summary className="h-icon" style={{ gap: 6 }}><CalendarClock size={16} aria-hidden="true" /> Extend closing time</summary>
      <ActionForm action={extendVoting.bind(null, id)}>
        <div className="field">
          <label htmlFor="ext_ends">New closing time <span className="hint">IST, later than {ist(endsAt)}</span></label>
          <input id="ext_ends" name="ends_at" type="datetime-local" required defaultValue={toIstInput(new Date(new Date(endsAt).getTime() + 24 * 3600_000))} />
        </div>
        <Submit className="btn secondary" pendingText="Saving…"><CalendarClock size={16} aria-hidden="true" /> Extend voting</Submit>
      </ActionForm>
    </details>
  );
}
