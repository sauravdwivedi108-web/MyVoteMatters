import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Brand } from '@/components/Brand';
import { ActionForm, Submit } from '@/components/forms';
import { SetupNeeded } from '@/components/SetupNeeded';
import { signup } from '@/lib/actions';
import { getSession } from '@/lib/auth';
import { hasDatabase } from '@/lib/pool';

export const metadata = { title: 'Create a workspace' };
export const dynamic = 'force-dynamic';

export default async function Signup() {
  if (!hasDatabase()) return <SetupNeeded />;
  if (await getSession()) redirect('/app');
  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <Brand />
        <h1>Create your workspace</h1>
        <p className="muted">You become the owner. Add an approver afterwards so elections can be independently approved.</p>
        <ActionForm action={signup}>
          <div className="field"><label htmlFor="org">Organisation name</label><input id="org" name="org" type="text" required placeholder="Acme Industries Ltd" /></div>
          <div className="field"><label htmlFor="name">Your name</label><input id="name" name="name" type="text" autoComplete="name" required /></div>
          <div className="field"><label htmlFor="email">Work email</label><input id="email" name="email" type="email" autoComplete="email" required /></div>
          <div className="field">
            <label htmlFor="password">Password <span className="hint">at least 10 characters</span></label>
            <input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required />
          </div>
          <Submit className="btn block" pendingText="Creating…">Create workspace</Submit>
        </ActionForm>
        <p className="small muted" style={{ marginTop: 16 }}>Already have an account? <Link href="/login">Sign in</Link></p>
      </div>
    </div>
  );
}
