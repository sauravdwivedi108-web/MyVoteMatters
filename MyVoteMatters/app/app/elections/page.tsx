import Link from 'next/link';
import { requireSession, can } from '@/lib/auth';
import { listElections } from '@/lib/queries';
import { MeetingCards } from '@/components/meeting/MeetingCards';
import { Plus } from 'lucide-react';

export const metadata = { title: 'Meetings' };

export default async function Meetings() {
  const s = await requireSession();
  const meetings = await listElections(s);
  return (
    <>
      <div className="page-head">
        <div><h1>Voting meetings</h1><p className="muted">Each meeting has its own questions, voters and voter IDs.</p></div>
        {can(s, 'manage') && <Link className="btn" href="/app/elections/new"><Plus size={18} aria-hidden="true" /> New voting meeting</Link>}
      </div>
      <MeetingCards meetings={meetings} canCreate={can(s, 'manage')} />
    </>
  );
}
