'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Brand } from '@/components/Brand';
import { KeyRound, LogIn, ShieldCheck, UserRound } from 'lucide-react';

export function VoterLogin() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setPending(true); setError(null);
    try {
      const r = await fetch('/api/voter/login', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ loginId: fd.get('loginId'), password: fd.get('password') }),
      });
      const data = await r.json();
      if (!r.ok) { setError(data.error); setPending(false); return; }
      try { sessionStorage.setItem('mvm_voter', data.token); } catch { /* falls back to the link below */ }
      window.location.href = `/vote#${encodeURIComponent(data.token)}`;
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      setPending(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <Brand />
        <div className="card">
          <div className="auth-badge"><UserRound size={22} aria-hidden="true" /></div>
          <h1 style={{ fontSize: '1.5rem' }}>Voter login</h1>
          <p className="muted">Enter the voter ID and password the administrator gave you.</p>
          {error && <div className="notice error" role="alert">{error}</div>}
          <form onSubmit={submit}>
            <div className="field">
              <label htmlFor="loginId">Voter ID</label>
              <input id="loginId" name="loginId" type="text" required autoComplete="username" autoCapitalize="characters"
                placeholder="MV-XXXX-XXXX" className="mono" style={{ fontSize: '1rem', letterSpacing: '0.05em' }} />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input id="password" name="password" type="password" required autoComplete="current-password" placeholder="xxxxx-xxxxx" />
            </div>
            <button className="btn block" disabled={pending}>{pending ? 'Checking…' : <><LogIn size={18} aria-hidden="true" /> Log in and vote</>}</button>
          </form>
          <ul className="trust-list small">
            <li><ShieldCheck size={16} aria-hidden="true" /> One ID casts one vote. A vote cannot be changed once confirmed.</li>
            <li><KeyRound size={16} aria-hidden="true" /> Your password is never stored; only a one-way hash is kept.</li>
          </ul>
        </div>
        <p className="small muted" style={{ textAlign: 'center', marginTop: 16 }}>
          Administrator? <Link href="/login">Admin login</Link>
        </p>
      </div>
    </div>
  );
}
