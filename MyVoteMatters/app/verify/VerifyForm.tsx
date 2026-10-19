'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ShieldAlert, Eye, EyeOff, LogIn } from 'lucide-react';

type MyVote = { name: string; castAt: string; items: { title: string; picks: string[] }[] };

export function VerifyForm() {
  const q = useSearchParams();
  const [result, setResult] = useState<boolean | null>(null);
  const [openBallot, setOpenBallot] = useState(false);
  const [busy, setBusy] = useState(false);
  const org = q.get('o') ?? '';
  const election = q.get('e') ?? '';

  async function check(fd: FormData) {
    setBusy(true);
    const r = await fetch('/api/verify', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ org, election, receipt: String(fd.get('receipt') ?? '').toLowerCase() }) });
    const data = await r.json();
    setResult(data.found); setOpenBallot(!!data.openBallot);
    setBusy(false);
  }

  if (!org || !election) {
    return <div className="notice info">Open this page from the “Check my receipt” button shown after voting, so we know which election to check.</div>;
  }
  return (
    <>
      <form action={check} className="card">
        <div className="field">
          <label htmlFor="receipt">Receipt code</label>
          <input id="receipt" name="receipt" type="text" className="mono" defaultValue={q.get('r') ?? ''} required pattern="[0-9a-fA-F]{24}" />
        </div>
        <button className="btn" disabled={busy}>{busy ? 'Checking…' : 'Check receipt'}</button>
        {result === true && <div className="notice ok" role="status">✓ This receipt matches a ballot accepted into the ballot box.</div>}
        {result === false && <div className="notice error" role="alert">No accepted ballot matches this receipt for this election.</div>}
      </form>
      {result === true && openBallot && <ShowMyVote org={org} election={election} />}
    </>
  );
}

/** Shows the voter whom they voted for, only after they log in again. */
function ShowMyVote({ org, election }: { org: string; election: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vote, setVote] = useState<MyVote | null>(null);

  async function show(fd: FormData) {
    setBusy(true); setError(null);
    const r = await fetch('/api/verify/my-vote', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ org, election, loginId: String(fd.get('loginId') ?? ''), password: String(fd.get('password') ?? '') }) });
    const data = await r.json().catch(() => ({ error: 'Something went wrong. Try again.' }));
    if (r.ok) setVote(data); else setError(data.error);
    setBusy(false);
  }

  if (vote) {
    return (
      <div className="card my-vote" style={{ marginTop: 18 }}>
        <div className="notice warn h-icon"><ShieldAlert size={18} aria-hidden="true" /> Your vote is private. Make sure nobody else can see this screen.</div>
        <h2 className="h-icon"><Eye size={20} aria-hidden="true" />Your vote</h2>
        <p className="small muted">Voted as <strong>{vote.name}</strong> on {new Date(vote.castAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })} IST</p>
        <table className="table">
          <thead><tr><th>Question</th><th>You voted for</th></tr></thead>
          <tbody>{vote.items.map((it) => <tr key={it.title}><td>{it.title}</td><td><strong>{it.picks.length ? it.picks.join(', ') : 'No choice'}</strong></td></tr>)}</tbody>
        </table>
        <button className="btn secondary" onClick={() => setVote(null)}><EyeOff size={18} aria-hidden="true" /> Hide my vote</button>
      </div>
    );
  }
  return (
    <div className="card" style={{ marginTop: 18 }}>
      <h2 className="h-icon"><Eye size={20} aria-hidden="true" />Show your vote</h2>
      <div className="notice warn h-icon" style={{ alignItems: 'flex-start' }}>
        <ShieldAlert size={18} aria-hidden="true" style={{ marginTop: 2, flex: 'none' }} />
        <span><strong>Your vote should stay secret.</strong> Check that nobody is watching your screen. To see whom you voted for, log in again with your voter ID and password.</span>
      </div>
      {!open ? (
        <button className="btn secondary" onClick={() => setOpen(true)}><Eye size={18} aria-hidden="true" /> Show my vote</button>
      ) : (
        // onSubmit (not a form action) so the typed ID is kept after a wrong password.
        <form onSubmit={(ev) => { ev.preventDefault(); show(new FormData(ev.currentTarget)); }}>
          <div className="field"><label htmlFor="mv-id">Voter ID</label>
            <input id="mv-id" name="loginId" type="text" required autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="e.g. Gauredit6" /></div>
          <div className="field"><label htmlFor="mv-pw">Password</label>
            <input id="mv-pw" name="password" type="password" required autoComplete="current-password" /></div>
          {error && <div className="notice error" role="alert">{error}</div>}
          <button className="btn" disabled={busy}><LogIn size={18} aria-hidden="true" /> {busy ? 'Checking…' : 'Log in and show my vote'}</button>
        </form>
      )}
    </div>
  );
}
