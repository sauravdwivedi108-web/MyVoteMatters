import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Brand } from '@/components/Brand';
import { ActionForm, Submit } from '@/components/forms';
import { SetupNeeded } from '@/components/SetupNeeded';
import { login } from '@/lib/actions';
import { getSession } from '@/lib/auth';
import { hasDatabase } from '@/lib/pool';

export const metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

export default async function Login() {
  if (!hasDatabase()) return <SetupNeeded />;
  if (await getSession()) redirect('/app');
  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <Brand />
        <h1>Sign in</h1>
        <p className="muted">For election administrators, approvers and scrutinizers. Voters use the link they were sent.</p>
        <ActionForm action={login}>
          <div className="field"><label htmlFor="email">Work email</label><input id="email" name="email" type="email" autoComplete="email" required /></div>
          <div className="field"><label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete="current-password" required /></div>
          <Submit className="btn block" pendingText="Signing in…">Sign in</Submit>
        </ActionForm>
        <p className="small muted" style={{ marginTop: 16 }}>New organisation? <Link href="/signup">Create a workspace</Link></p>
      </div>
    </div>
  );
}
