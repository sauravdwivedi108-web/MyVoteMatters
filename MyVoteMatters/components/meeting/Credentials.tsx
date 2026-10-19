'use client';

import { useState, useTransition } from 'react';
import type { FormState } from '@/lib/actions';
import type { IssuedLogin } from '@/lib/core/voterLogins';
import { csvCell, download } from '../Panels';
import { Notice } from '../forms';
import { Copy, Check, Download, KeyRound, Lock, Printer, RotateCcw } from 'lucide-react';

type Result = FormState & { logins?: IssuedLogin[] };

/** Voter IDs and passwords, shown once with download and print. Passwords are never stored. */
export function LoginSheet({ logins, meeting, org, loginUrl }: { logins: IssuedLogin[]; meeting: string; org: string; loginUrl: string }) {
  const file = `voter-ids-${meeting.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.csv`;
  const csv = ['Voter,Voting weight,Voter ID,Password,Login at', ...logins.map((l) =>
    [l.eligibilityRef, l.votingUnits, l.loginId, l.chosen ? '(chosen by administrator)' : l.password, loginUrl].map(csvCell).join(','))].join('\n');
  return (
    <div className="login-sheet">
      <div className="notice warn no-print">
        <strong>Save these now.</strong> Passwords are shown only once and are not stored anywhere. Download or print the sheet and give each
        voter their own ID and password privately. If one is lost, use <em>Reset password</em> on the Voters tab.
      </div>
      <div className="btn-row no-print">
        <button className="btn" onClick={() => download(file, csv, 'text/csv')}><Download size={18} aria-hidden="true" /> Download sheet (CSV)</button>
        <button className="btn secondary" onClick={() => window.print()}><Printer size={18} aria-hidden="true" /> Print voter slips</button>
      </div>
      <div className="slips">
        {logins.map((l) => (
          <div className="slip" key={l.loginId}>
            <div className="small muted">{org} · {meeting}</div>
            <strong>{l.eligibilityRef}</strong>
            <dl>
              <dt>Voter ID</dt><dd className="mono">{l.loginId}</dd>
              <dt>Password</dt>{l.chosen ? <dd className="muted">Chosen by you when adding</dd> : <dd className="mono">{l.password}</dd>}
            </dl>
            <div className="small muted">Log in at {loginUrl}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The step that freezes the meeting and creates voter IDs. */
export function LockPanel({ action, meeting, org, loginUrl, disabled }: {
  action: () => Promise<Result>; meeting: string; org: string; loginUrl: string; disabled?: boolean;
}) {
  const [state, setState] = useState<Result>();
  const [pending, start] = useTransition();
  if (state?.logins?.length) {
    return (
      <>
        <div className="notice ok no-print">{state.ok} Next: share them, then press <strong>Start voting</strong> (reload this page after saving the sheet).</div>
        <LoginSheet logins={state.logins} meeting={meeting} org={org} loginUrl={loginUrl} />
        <button className="btn secondary no-print" style={{ marginTop: 14 }} onClick={() => window.location.reload()}>I have saved the sheet, continue</button>
      </>
    );
  }
  return (
    <div>
      <Notice state={state} />
      <button className="btn" disabled={pending || disabled} onClick={() => {
        if (!window.confirm('Lock the questions and voter list and create voter IDs? After this, questions and voters cannot be changed.')) return;
        start(async () => setState(await action()));
      }}><Lock size={18} aria-hidden="true" />{pending ? 'Creating voter IDs…' : 'Lock and create voter IDs'}</button>
    </div>
  );
}

/** Resets one voter's password, to a generated one or one the administrator types, and shows it once. */
export function ResetPassword({ action, name }: { action: (password?: string) => Promise<Result>; name: string }) {
  const [state, setState] = useState<Result>();
  const [pending, start] = useTransition();
  const [typing, setTyping] = useState(false);
  const [pw, setPw] = useState('');
  const l = state?.logins?.[0];
  if (l) return <div className="reset-out"><KeyRound size={14} aria-hidden="true" /> New password: <span className="mono"><strong>{l.password}</strong></span></div>;
  return (
    <div className="row-btns">
      {typing ? (
        <form className="set-pw" onSubmit={(ev) => {
          ev.preventDefault();
          if (!window.confirm(`Set this password for ${name}? Their old password stops working.`)) return;
          start(async () => setState(await action(pw)));
        }}>
          <input aria-label={`New password for ${name}`} value={pw} onChange={(ev) => setPw(ev.target.value)} minLength={5} maxLength={64}
                 required autoComplete="off" spellCheck={false} placeholder="New password" />
          <button className="btn small" disabled={pending}>{pending ? 'Saving…' : 'Save'}</button>
          <button type="button" className="btn ghost small" onClick={() => setTyping(false)}>Cancel</button>
        </form>
      ) : (
        <>
          <button className="btn ghost small" disabled={pending} onClick={() => {
            if (!window.confirm(`Create a new password for ${name}? Their old password stops working.`)) return;
            start(async () => setState(await action()));
          }}><RotateCcw size={14} aria-hidden="true" />{pending ? 'Resetting…' : 'Reset password'}</button>
          <button className="btn ghost small" onClick={() => setTyping(true)}><KeyRound size={14} aria-hidden="true" />Set password</button>
        </>
      )}
      {state?.error && <Notice state={state} />}
    </div>
  );
}

/** For meetings where some voters have no live ID. */
export function IssueMissing({ action, meeting, org, loginUrl }: { action: () => Promise<Result>; meeting: string; org: string; loginUrl: string }) {
  const [state, setState] = useState<Result>();
  const [pending, start] = useTransition();
  if (state?.logins?.length) return <LoginSheet logins={state.logins} meeting={meeting} org={org} loginUrl={loginUrl} />;
  return (
    <>
      <button className="btn secondary small" disabled={pending} onClick={() => start(async () => setState(await action()))}>
        <KeyRound size={16} aria-hidden="true" />{pending ? 'Creating…' : 'Create missing voter IDs'}
      </button>
      <Notice state={state} />
    </>
  );
}

export function PrintButton({ label = 'Print / save as PDF' }: { label?: string }) {
  return <button className="btn secondary small no-print" onClick={() => window.print()}><Printer size={16} aria-hidden="true" /> {label}</button>;
}

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="btn secondary small" onClick={async () => {
      try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 2000); } catch { /* clipboard blocked */ }
    }}>
      {done ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />} {done ? 'Copied' : label}
    </button>
  );
}

/**
 * "Create ID and password automatically" is ticked by default; unticking it
 * lets the administrator type this voter's own login ID and password.
 */
export function LoginChoiceFields() {
  const [auto, setAuto] = useState(true);
  return (
    <>
      <label className="check">
        <input type="checkbox" name="auto_login" checked={auto} onChange={(ev) => setAuto(ev.target.checked)} />
        <span>Create voter ID and password automatically <span className="hint">e.g. Gauredit6 / Gaur7k2m9</span></span>
      </label>
      {!auto && (
        <div className="grid-2 tight">
          <div className="field"><label htmlFor="vlogin">Voter ID <span className="hint">3–32 letters or digits</span></label>
            <input id="vlogin" name="login_id" type="text" required autoComplete="off" autoCapitalize="none" spellCheck={false} pattern="[A-Za-z0-9\-]{3,32}" placeholder="e.g. SBI2026" /></div>
          <div className="field"><label htmlFor="vpass">Password <span className="hint">at least 5 characters</span></label>
            <input id="vpass" name="password" type="text" required minLength={5} maxLength={64} autoComplete="new-password" spellCheck={false} placeholder="e.g. sbi@55555" /></div>
        </div>
      )}
    </>
  );
}
