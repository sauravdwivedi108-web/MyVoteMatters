import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Brand } from '@/components/Brand';
import { ActionForm, Submit } from '@/components/forms';
import { SetupNeeded } from '@/components/SetupNeeded';
import { signup } from '@/lib/actions';
import { getSession } from '@/lib/auth';
import { hasDatabase } from '@/lib/pool';

export const metadata = { title: 'Create an admin account' };
export const dynamic = 'force-dynamic';

export default async function Signup() {
  if (!hasDatabase()) return <SetupNeeded />;
  if (await getSession()) redirect('/app');
  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <Brand />
        <h1 style={{ fontSize: '1.5rem' }}>Create an admin account</h1>
        <p className="muted">For the company, insolvency professional or firm running the vote. You become the admin with full control.</p>
        <ActionForm action={signup}>
          <div className="field"><label htmlFor="org">Company or firm name</label><input id="org" name="org" type="text" required placeholder="e.g. ABC Steel Ltd (under CIRP) or your firm" /></div>
          <div className="field"><label htmlFor="name">Your name</label><input id="name" name="name" type="text" autoComplete="name" required /></div>
          <div className="field"><label htmlFor="email">Email or username</label><input id="email" name="email" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} required /></div>
          <div className="field">
            <label htmlFor="password">Password <span className="hint">at least 5 characters; longer is safer</span></label>
            <input id="password" name="password" type="password" autoComplete="new-password" minLength={5} required />
          </div>
          <Submit className="btn block" pendingText="Creating…">Create admin account</Submit>
        </ActionForm>
        <p className="small muted" style={{ marginTop: 16 }}>Already have an account? <Link href="/login">Admin login</Link></p>
      </div>
    </div>
  );
}
