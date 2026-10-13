'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { BallotDefinition, Choices } from '@/lib/core/ballot';
import { Brand } from '@/components/Brand';
import { CheckCircle2, ThumbsUp, ThumbsDown, MinusCircle, Lock, ArrowLeft, Send, Receipt, AlertTriangle, Clock } from 'lucide-react';

type Ballot = {
  title: string; org_name: string; status: string; starts_at: string; ends_at: string;
  version: number | null; definition: BallotDefinition | null; already_voted: boolean; voting_units: string; kind: string;
};

const OPTIONS = [['for', 'For', ThumbsUp], ['against', 'Against', ThumbsDown], ['abstain', 'Abstain', MinusCircle]] as const;
const fmt = (d: string) => new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(d)) + ' IST';

export function VoterApp() {
  const [token, setToken] = useState<string | null>(null);
  const [ballot, setBallot] = useState<Ballot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choices, setChoices] = useState<Choices>({});
  const [stage, setStage] = useState<'loading' | 'ballot' | 'review' | 'sending' | 'done'>('loading');
  const [receipt, setReceipt] = useState<string | null>(null);

  useEffect(() => {
    const t = decodeURIComponent(window.location.hash.slice(1));
    if (!t) { setError('Open the voting link you were sent. It contains your private code.'); return; }
    setToken(t);
    fetch('/api/vote/ballot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: t }) })
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 429 ? 'Too many attempts. Wait a minute and reload.' : 'This voting link is not valid. Check you opened the full link.');
        return r.json();
      })
      .then((b: Ballot) => { setBallot(b); setStage('ballot'); })
      .catch((e) => setError(e.message));
  }, []);

  const items = ballot?.definition?.type === 'resolutions' ? ballot.definition.resolutions : [];
  const complete = ballot?.definition?.type === 'resolutions'
    ? items.every((r) => choices[r.id]) : Boolean(choices.candidate);
  const answered = ballot?.definition?.type === 'resolutions' ? items.filter((r) => choices[r.id]).length : choices.candidate ? 1 : 0;
  const total = ballot?.definition?.type === 'resolutions' ? items.length : 1;

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
      <div className="voter-top"><Brand href="/vote" />{ballot && <span className="small muted">{ballot.org_name}</span>}</div>
      {ballot && <p className="small muted h-icon" style={{ gap: 6, marginTop: -8 }}><Lock size={14} aria-hidden="true" /> Secret ballot: nobody, including the company, can see how you vote.</p>}
      {body}
    </div>
  );

  if (error && !ballot) return shell(<div className="notice error" role="alert">{error}</div>);
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
          Keep this code. It proves your ballot was accepted. It does not show how you voted, and nobody can use it to find out.
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
          ) : (
            <p>{def.question}<br /><strong>{def.candidates.find((c) => c.id === choices.candidate)?.name}</strong></p>
          )}
          {ballot.kind !== 'internal_poll' && <p className="small muted" style={{ marginTop: 12 }}>Cast with {BigInt(ballot.voting_units).toLocaleString('en-IN')} voting units.</p>}
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
      <p className="muted">Voting closes {fmt(ballot.ends_at)}.{ballot.kind !== 'internal_poll' && <> You hold {BigInt(ballot.voting_units).toLocaleString('en-IN')} voting units.</>}</p>
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
      )) : (
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
      <p className="small muted" aria-live="polite">{answered} of {total} answered</p>
      <button className="btn block" disabled={!complete} onClick={() => { setStage('review'); window.scrollTo(0, 0); }}>
        {complete ? 'Review my vote' : 'Answer every item to continue'}
      </button>
    </>,
  );
}
