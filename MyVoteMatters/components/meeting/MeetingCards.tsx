import Link from 'next/link';
import type { ElectionSummary } from '@/lib/queries';
import { ist } from '../Status';
import { MEETING_STATUS } from './Meeting';
import { ArrowRight, CalendarClock, Plus, Users, ListChecks, KeyRound, PlayCircle, BarChart3 } from 'lucide-react';

export function MeetingCards({ meetings, canCreate }: { meetings: ElectionSummary[]; canCreate: boolean }) {
  if (!meetings.length) {
    return (
      <div className="card onboarding">
        <h2>Run your first vote in five steps</h2>
        <p className="muted">Everything is set up from here. Voters only need the ID and password you give them.</p>
        <ol className="flow">
          <li><ListChecks size={20} aria-hidden="true" /><strong>Questions</strong><span>Topics, options and descriptions</span></li>
          <li><Users size={20} aria-hidden="true" /><strong>Voters</strong><span>Names and voting weight</span></li>
          <li><KeyRound size={20} aria-hidden="true" /><strong>Voter IDs</strong><span>One login per voter</span></li>
          <li><PlayCircle size={20} aria-hidden="true" /><strong>Voting</strong><span>Live turnout as they vote</span></li>
          <li><BarChart3 size={20} aria-hidden="true" /><strong>Results</strong><span>% share, who voted what, audit log</span></li>
        </ol>
        {canCreate && <Link className="btn" href="/app/elections/new"><Plus size={18} aria-hidden="true" /> Create a voting meeting</Link>}
      </div>
    );
  }
  return (
    <div className="meeting-grid">
      {meetings.map((m) => {
        const [label, badge] = MEETING_STATUS[m.status] ?? [m.status, 'draft'];
        const pct = m.eligible ? Math.round((m.voted / m.eligible) * 100) : 0;
        return (
          <Link key={m.id} href={`/app/elections/${m.id}`} className="meeting-card">
            <div className="meeting-card-top">
              <span className={`badge ${badge}`}>{label}</span>
              <ArrowRight size={18} aria-hidden="true" className="go" />
            </div>
            <h3>{m.title}</h3>
            <div className="small muted h-icon" style={{ gap: 6 }}><CalendarClock size={14} aria-hidden="true" /> Closes {ist(m.ends_at)}</div>
            <div className="meter" aria-hidden="true" style={{ marginTop: 14 }}><span style={{ width: `${pct}%` }} /></div>
            <div className="small muted" style={{ marginTop: 6 }}>{m.voted} of {m.eligible} voters have voted</div>
          </Link>
        );
      })}
    </div>
  );
}
