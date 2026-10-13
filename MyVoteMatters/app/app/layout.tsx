import { Brand } from '@/components/Brand';
import { NavLink } from '@/components/NavLink';
import { SetupNeeded } from '@/components/SetupNeeded';
import { requireSession } from '@/lib/auth';
import { hasDatabase } from '@/lib/pool';
import { logout } from '@/lib/actions';
import { LogOut } from 'lucide-react';

export const dynamic = 'force-dynamic';

const ROLE: Record<string, string> = {
  owner: 'Owner', election_admin: 'Election admin', approver: 'Approver', scrutinizer: 'Scrutinizer', viewer: 'Viewer',
};

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!hasDatabase()) return <SetupNeeded />;
  const s = await requireSession();
  return (
    <div className="shell">
      <aside className="sidebar" aria-label="Workspace">
        <Brand href="/app" />
        <NavLink href="/app" exact icon="overview">Overview</NavLink>
        <NavLink href="/app/elections" icon="elections">Elections</NavLink>
        <NavLink href="/app/team" icon="team">Team</NavLink>
        <form action={logout}>
          <button className="nav nav-button"><LogOut size={18} aria-hidden="true" />Sign out</button>
        </form>
        <div className="org">
          <strong>{s.orgName}</strong>
          {s.name} · {ROLE[s.role] ?? s.role}
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
