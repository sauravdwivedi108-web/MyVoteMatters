'use client';

import { useActionState, useEffect, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import type { FormState } from '@/lib/actions';

export function Notice({ state }: { state: FormState }) {
  if (!state) return null;
  if (state.error) return <div className="notice error" role="alert">{state.error}</div>;
  if (state.ok) return <div className="notice ok" role="status">{state.ok}</div>;
  return null;
}

export function Submit({ children, className = 'btn', pendingText = 'Working…' }:
  { children: React.ReactNode; className?: string; pendingText?: string }) {
  const { pending } = useFormStatus();
  return <button className={className} type="submit" disabled={pending}>{pending ? pendingText : children}</button>;
}

/** A form bound to a server action, showing its result inline. */
export function ActionForm({ action, children, className }: {
  action: (s: FormState, fd: FormData) => Promise<FormState>; children: React.ReactNode; className?: string;
}) {
  const [state, formAction] = useActionState(action, undefined);
  useEffect(() => {
    // A voter who signed in on the admin page: hand the token to the ballot page.
    if (!state?.voterToken) return;
    try { sessionStorage.setItem('mvm_voter', state.voterToken); } catch { /* private mode: the fragment below still works */ }
    window.location.assign(`/vote#${state.voterToken}`);
  }, [state]);
  return (
    <form action={formAction} className={className}>
      <Notice state={state} />
      {children}
    </form>
  );
}

/** A single button running a server action, with an optional confirmation. */
export function ActionButton({ action, children, confirm, className = 'btn' }: {
  action: () => Promise<FormState>; children: React.ReactNode; confirm?: string; className?: string;
}) {
  const [state, setState] = useState<FormState>();
  const [pending, start] = useTransition();
  return (
    <div>
      <button className={className} disabled={pending} onClick={() => {
        if (confirm && !window.confirm(confirm)) return;
        start(async () => setState(await action()));
      }}>{pending ? 'Working…' : children}</button>
      {state?.error && <Notice state={state} />}
    </div>
  );
}
