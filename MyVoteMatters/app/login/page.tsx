import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Brand } from '@/components/Brand';
import { ActionForm, Submit } from '@/components/forms';
import { SetupNeeded } from '@/components/SetupNeeded';
import { login } from '@/lib/actions';
import { getSession } from '@/lib/auth';
import { hasDatabase } from '@/lib/pool';
import { Building2, LogIn } from 'lucide-react';

export const metadata = { title: 'Admin login' };
export const dynamic = 'force-dynamic';

export default async function Login() {
  if (!hasDatabase()) return <SetupNeeded />;
  if (await getSession()) redirect('/app');
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <Brand />
        <div className="card">
        <div className="auth-badge"><Building2 size={22} aria-hidden="true" /></div>
        <h1 style={{ fontSize: '1.5rem' }}>Admin login</h1>
        <p className="muted">For administrators who set up meetings and voters. Voters log in at the <Link href="/voter">voter login</Link>.</p>
        <ActionForm action={login}>
          <div className="field"><label htmlFor="email">Email or username</label><input id="email" name="email" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} required /></div>
          <div className="field"><label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete="current-password" required /></div>
          <Submit className="btn block" pendingText="Signing in…"><LogIn size={18} aria-hidden="true" /> Log in</Submit>
        </ActionForm>
        <p className="small muted" style={{ marginTop: 16 }}>New organisation? <Link href="/signup">Create an admin account</Link></p>
        </div>
      </div>
    </div>
  );
}
