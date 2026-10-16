'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { picksLabel, splitPicks, type BallotDefinition, type Choices } from '@/lib/core/ballot';
import { Brand } from '@/components/Brand';
import { LogOut, Eye, ArrowRight, CheckCircle2, ThumbsUp, ThumbsDown, MinusCircle, Lock, ArrowLeft, Send, Receipt, AlertTriangle, Clock } from 'lucide-react';

type Ballot = {
  title: string; org_name: string; status: string; starts_at: string; ends_at: string;
  version: number | null; definition: BallotDefinition | null; already_voted: boolean; voting_units: string; kind: string;
  voter_name?: string; units_total?: string;
};

/** Share of the total voting weight, e.g. "12.34%". */
const sharePct = (part: string, total: string) => total === '0' ? '0%' : `${(Number((BigInt(part) * 1000000n) / BigInt(total)) / 10000).toFixed(2)}%`;

const OPTIONS = [['for', 'For', ThumbsUp], ['against', 'Against', ThumbsDown], ['abstain', 'Abstain', MinusCircle]] as const;
const fmt = (d: string) => new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(d)) + ' IST';

export function VoterApp() {
  const [token, setToken] = useState<string | null>(null);
  const [ballot, setBallot] = useState<Ballot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choices, setChoices] = useState<Choices>({});
  const [stage, setStage] = useState<'loading' | 'ballot' | 'review' | 'sending' | 'done'>('loading');
  const [receipt, setReceipt] = useState<string | null>(null);
  const [step, setStep] = useState(0);

  useEffect(() => {
    let t = decodeURIComponent(window.location.hash.slice(1));
    if (t) { try { sessionStorage.setItem('mvm_voter', t); } catch { /* private mode */ } history.replaceState(null, '', '/vote'); }
    else { try { t = sessionStorage.getItem('mvm_voter') ?? ''; } catch { /* private mode */ } }
    if (!t) { window.location.replace('/voter'); return; }
    setToken(t);
    fetch('/api/vote/ballot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: t }) })
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 429 ? 'Too many attempts. Wait a minute and reload.' : 'This sign-in is no longer valid. Log in again with your voter ID and password.');
        return r.json();
      })
      .then((b: Ballot) => {
        // Agenda items start with no picks, which is a complete answer only where the minimum is zero.
        if (b.definition?.type === 'agenda') setChoices(Object.fromEntries(b.definition.items.map((it) => [it.id, ''])));
        setBallot(b); setStage('ballot');
      })
      .catch((e) => setError(e.message));
  }, []);

  const d0 = ballot?.definition;
  const okItem = (id: string, min: number, max: number) => {
    const n = splitPicks(choices[id] ?? '').length;
    return id in choices && n >= min && n <= max;
  };
  const answeredIds = !d0 ? [] : d0.type === 'resolutions' ? d0.resolutions.filter((r) => choices[r.id]).map((r) => r.id)
    : d0.type === 'agenda' ? d0.items.filter((it) => okItem(it.id, it.minChoices, it.maxChoices)).map((it) => it.id)
    : choices.candidate ? ['candidate'] : [];
  const total = !d0 ? 1 : d0.type === 'resolutions' ? d0.resolutions.length : d0.type === 'agenda' ? d0.items.length : 1;
  const answered = answeredIds.length;
  const complete = answered === total;

  /** Toggles an agenda option, keeping picks in ballot order. Picking in a one-choice item replaces the previous pick. */
  function toggle(itemId: string, optionId: string, order: string[], max: number) {
    const cur = splitPicks(choices[itemId] ?? '');
    let next = cur.includes(optionId) ? cur.filter((x) => x !== optionId) : max === 1 ? [optionId] : [...cur, optionId];
    if (next.length > max) return;
    next = next.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    setChoices({ ...choices, [itemId]: next.join(',') });
  }

  async function submit() {
    setStage('sending');
    setError(null);
    // Retries resend the same choices; the server returns the original receipt rather than a second ballot.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetch('/api/vote/cast', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, choices }) });
        const data = await r.json();
        if (r.ok) { setReceipt(data.receipt); setStage('done'); window.scrollTo(0, 0); return; }
        if (r.status < 500) { setError(data.error); setStage('review'); return; }
      } catch { /* network: retry */ }
      await new Promise((res) => setTimeout(res, 800 * (attempt + 1)));
    }
    setError('We could not confirm your vote because of a connection problem. Press Confirm again; you will not vote twice.');
    setStage('review');
  }

  const shell = (body: React.ReactNode) => (
    <div className="voter">
      <div className="voter-top"><Brand href="/vote" />
        <span className="voter-top-right">{ballot && <span className="small muted">{ballot.org_name}</span>}
          <button className="btn ghost small" onClick={() => { try { sessionStorage.removeItem('mvm_voter'); } catch { /* ignore */ } window.location.href = '/voter'; }}>
            <LogOut size={16} aria-hidden="true" /> Log out
          </button>
        </span>
      </div>
      {ballot && (ballot.kind === 'creditor_vote'
        ? <div className="notice warn small h-icon" style={{ marginTop: -8 }}><Eye size={16} aria-hidden="true" /> Open ballot: your name and your choices are recorded and shown to the administrator (resolution professional) after voting closes.</div>
        : <p className="small muted h-icon" style={{ gap: 6, marginTop: -8 }}><Lock size={14} aria-hidden="true" /> Secret ballot: nobody, including the company, can see how you vote.</p>)}
      {ballot?.voter_name && <p className="small" style={{ marginTop: 0 }}>Voting as <strong>{ballot.voter_name}</strong>{ballot.units_total && <> · {sharePct(ballot.voting_units, ballot.units_total)} of total voting share</>}</p>}
      {body}
    </div>
  );

  if (error && !ballot) return shell(<><div className="notice error" role="alert">{error}</div><Link className="btn secondary" href="/voter">Go to voter login</Link></>);
  if (!ballot || stage === 'loading') return shell(<p className="muted" aria-live="polite">Loading your ballot…</p>);

  if (stage === 'done' && receipt) {
    const verify = `/verify?o=${encodeURIComponent(token!.split('.')[0])}&e=${encodeURIComponent(token!.split('.')[1])}&r=${receipt}`;
    return shell(
      <div className="card" style={{ textAlign: 'center' }}>
        <div className="big-check" aria-hidden="true"><CheckCircle2 size={36} /></div>
        <h1>Your vote has been recorded</h1>
        <p className="muted">{ballot.title}</p>
        <p>Your receipt code:</p>
        <div className="receipt" aria-label="Receipt code">{receipt}</div>
        <p className="small muted" style={{ marginTop: 12 }}>
          {ballot.kind === 'creditor_vote'
            ? 'Keep this code. It proves your vote was accepted. Your choices are recorded under your name for the administrator.'
            : 'Keep this code. It proves your ballot was accepted. It does not show how you voted, and nobody can use it to find out.'}
        </p>
        <Link className="btn secondary" href={verify}><Receipt size={16} aria-hidden="true" /> Check my receipt</Link>
      </div>,
    );
  }

  if (ballot.already_voted) {
    return shell(
      <div className="card">
        <div className="big-check" aria-hidden="true"><CheckCircle2 size={36} /></div>
        <h1>You have already voted</h1>
        <p>A ballot has been recorded for this entitlement in <strong>{ballot.title}</strong>. Each entitlement votes once and votes cannot be changed.</p>
        <p className="small muted">If you did not vote, contact the company secretary straight away.</p>
      </div>,
    );
  }

  if (ballot.status !== 'open' || !ballot.definition) {
    const ended = ballot.status !== 'open' && ['closed', 'tallied', 'published'].includes(ballot.status);
    return shell(
      <div className="card">
        <div className="big-check" style={{ background: 'var(--amber-soft)', color: 'var(--amber)' }} aria-hidden="true"><Clock size={32} /></div>
        <h1>{ballot.title}</h1>
        <p>{ended ? 'Voting has closed.' : `Voting has not opened yet. It is scheduled from ${fmt(ballot.starts_at)} to ${fmt(ballot.ends_at)}.`}</p>
        {!ended && <p className="small muted">Keep this link and come back once voting opens.</p>}
      </div>,
    );
  }

  const def = ballot.definition;

  if (stage === 'review' || stage === 'sending') {
    return shell(
      <>
        <div className="progress" aria-hidden="true"><span className="on" /><span className="on" /><span /></div>
        <h1>Check your vote</h1>
        <p className="muted">Once you confirm, your vote is final and cannot be changed.</p>
        {error && <div className="notice error h-icon" role="alert"><AlertTriangle size={18} aria-hidden="true" />{error}</div>}
        <div className="card">
          {def.type === 'resolutions' ? (
            <table>
              <tbody>
                {def.resolutions.map((r, i) => (
                  <tr key={r.id}><td><span className="small muted">Resolution {i + 1}</span><br />{r.title}</td>
                    <td className="r"><strong>{OPTIONS.find((o) => o[0] === choices[r.id])?.[1]}</strong></td></tr>
                ))}
              </tbody>
            </table>
          ) : def.type === 'agenda' ? (
            <table>
              <tbody>
                {def.items.map((it, i) => {
                  const picks = splitPicks(choices[it.id] ?? '');
                  return (
                    <tr key={it.id}><td><span className="small muted">Item {i + 1}</span><br />{it.title}</td>
                      <td className="r">{picks.length
                        ? picks.map((p) => <div key={p}><strong>{it.options.find((o) => o.id === p)?.name}</strong></div>)
                        : <span className="muted">No choice</span>}</td></tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p>{def.question}<br /><strong>{def.candidates.find((c) => c.id === choices.candidate)?.name}</strong></p>
          )}
          {ballot.kind !== 'internal_poll' && <p className="small muted" style={{ marginTop: 12 }}>{ballot.units_total
            ? <>Cast with {sharePct(ballot.voting_units, ballot.units_total)} of the total voting share.</>
            : <>Cast with {BigInt(ballot.voting_units).toLocaleString('en-IN')} voting units.</>}</p>}
        </div>
        <div style={{ display: 'grid', gap: 10, marginTop: 18 }}>
          <button className="btn block" onClick={submit} disabled={stage === 'sending'}>{stage === 'sending' ? 'Recording your vote…' : <><Send size={18} aria-hidden="true" /> Confirm and cast my vote</>}</button>
          <button className="btn secondary block" onClick={() => setStage('ballot')} disabled={stage === 'sending'}><ArrowLeft size={18} aria-hidden="true" /> Go back and change</button>
        </div>
      </>,
    );
  }

  return shell(
    <>
      <div className="progress" aria-hidden="true"><span className="on" /><span /><span /></div>
      <h1>{ballot.title}</h1>
      <p className="muted">Voting closes {fmt(ballot.ends_at)}.{ballot.kind !== 'internal_poll' && ballot.kind !== 'creditor_vote' && <> You hold {BigInt(ballot.voting_units).toLocaleString('en-IN')} voting units.</>}</p>
      {def.type === 'resolutions' ? def.resolutions.map((r, i) => (
        <div className="question" key={r.id}>
          <fieldset>
            <legend>Resolution {i + 1}: {r.title}</legend>
            <div className="small muted" style={{ marginBottom: 6 }}>{r.majority === 'special' ? 'Special resolution' : 'Ordinary resolution'}</div>
            <p style={{ whiteSpace: 'pre-wrap' }}>{r.text}</p>
            {OPTIONS.map(([v, label, Icon]) => (
              <label key={v} className={`choice${choices[r.id] === v ? ' selected' : ''}`}>
                <input type="radio" name={r.id} value={v} checked={choices[r.id] === v} onChange={() => setChoices({ ...choices, [r.id]: v })} />
                <Icon size={20} className="choice-icon" aria-hidden="true" />
                {label}
                {v === 'abstain' && <span className="tag">not counted for or against</span>}
              </label>
            ))}
          </fieldset>
        </div>
      )) : def.type === 'agenda' ? def.items.filter((_, i) => i === step).map((it) => {
        const i = step;
        const picks = splitPicks(choices[it.id] ?? '');
        const order = it.options.map((o) => o.id);
        const full = picks.length >= it.maxChoices;
        const single = it.maxChoices === 1;
        return (
          <div className="question" key={it.id}>
            <fieldset>
              <div className="small muted" style={{ marginBottom: 4 }}>Item {i + 1} of {def.items.length}</div>
              <legend>{it.title}</legend>
              {it.description && <p style={{ whiteSpace: 'pre-wrap' }}>{it.description}</p>}
              <p className="small muted" aria-live="polite">
                <strong>{picksLabel(it.minChoices, it.maxChoices)}</strong>{!single && <> · {picks.length} of {it.maxChoices} chosen</>}
              </p>
              {it.options.map((o) => {
                const on = picks.includes(o.id);
                const blocked = !on && full && !single;
                return (
                  <label key={o.id} className={`choice${on ? ' selected' : ''}${blocked ? ' disabled' : ''}`}>
                    <input type={single ? 'radio' : 'checkbox'} name={it.id} value={o.id} checked={on} disabled={blocked}
                      onChange={() => toggle(it.id, o.id, order, it.maxChoices)} />
                    <span>{o.name}{o.detail && <span className="small muted" style={{ display: 'block', fontWeight: 400, whiteSpace: 'pre-wrap', marginTop: 2 }}>{o.detail}</span>}</span>
                  </label>
                );
              })}
            </fieldset>
          </div>
        );
      }) : (
        <div className="question">
          <fieldset>
            <legend>{def.question}</legend>
            <p className="small muted">Choose one.</p>
            {def.candidates.map((c) => (
              <label key={c.id} className={`choice${choices.candidate === c.id ? ' selected' : ''}`}>
                <input type="radio" name="candidate" value={c.id} checked={choices.candidate === c.id} onChange={() => setChoices({ candidate: c.id })} />
                {c.name}
              </label>
            ))}
          </fieldset>
        </div>
      )}
      {def.type === 'agenda' ? (() => {
        const it = def.items[step];
        const ok = okItem(it.id, it.minChoices, it.maxChoices);
        const last = step === def.items.length - 1;
        const go = (n: number) => { setStep(n); window.scrollTo(0, 0); };
        return (
          <div style={{ display: 'grid', gap: 10 }}>
            <button className="btn block" disabled={!ok} onClick={() => (last ? (setStage('review'), window.scrollTo(0, 0)) : go(step + 1))}>
              {!ok ? 'Make the required choice to continue' : last ? 'Review my vote' : <>Next item <ArrowRight size={18} aria-hidden="true" /></>}
            </button>
            {step > 0 && <button className="btn secondary block" onClick={() => go(step - 1)}><ArrowLeft size={18} aria-hidden="true" /> Previous item</button>}
          </div>
        );
      })() : (
        <>
          <p className="small muted" aria-live="polite">{answered} of {total} answered</p>
          <button className="btn block" disabled={!complete} onClick={() => { setStage('review'); window.scrollTo(0, 0); }}>
            {complete ? 'Review my vote' : 'Answer every item to continue'}
          </button>
        </>
      )}
    </>,
  );
}
