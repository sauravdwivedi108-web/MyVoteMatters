import Link from 'next/link';
import { requireSession, can } from '@/lib/auth';
import { listElections } from '@/lib/queries';
import { MeetingCards } from '@/components/meeting/MeetingCards';
import { Plus, Radio, PlayCircle, PencilRuler, CheckCircle2 } from 'lucide-react';

export const metadata = { title: 'Dashboard' };

export default async function Dashboard() {
  const s = await requireSession();
  const meetings = await listElections(s);
  const count = (...st: string[]) => meetings.filter((m) => st.includes(m.status)).length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Welcome, {s.name.split(' ')[0]}</h1>
          <p className="muted">{s.orgName}</p>
        </div>
        {can(s, 'manage') && <Link className="btn" href="/app/elections/new"><Plus size={18} aria-hidden="true" /> New voting meeting</Link>}
      </div>

      {meetings.length > 0 && (
        <div className="stats">
          <div className="stat"><span className="stat-icon teal" aria-hidden="true"><Radio size={18} /></span><div className="v">{count('open')}</div><div className="k">Voting live</div></div>
          <div className="stat"><span className="stat-icon" aria-hidden="true"><PlayCircle size={18} /></span><div className="v">{count('approved')}</div><div className="k">Ready to start</div></div>
          <div className="stat"><span className="stat-icon amber" aria-hidden="true"><PencilRuler size={18} /></span><div className="v">{count('draft', 'pending_approval')}</div><div className="k">Setting up</div></div>
          <div className="stat"><span className="stat-icon" aria-hidden="true"><CheckCircle2 size={18} /></span><div className="v">{count('closed', 'tallied', 'published')}</div><div className="k">Closed</div></div>
        </div>
      )}

      <MeetingCards meetings={meetings} canCreate={can(s, 'manage')} />
    </>
  );
}
