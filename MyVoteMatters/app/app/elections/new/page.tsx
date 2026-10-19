import { redirect } from 'next/navigation';
import { requireSession, can } from '@/lib/auth';
import { ActionForm, Submit } from '@/components/forms';
import { createMeeting } from '@/lib/meetingActions';
import { Eye, CalendarPlus } from 'lucide-react';

export const metadata = { title: 'New voting meeting' };

const toLocal = (d: Date) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 16);

export default async function NewMeeting() {
  const s = await requireSession();
  if (!can(s, 'manage')) redirect('/app');
  // Default: voting opens in an hour (rounded to the hour) and stays open three days.
  const start = new Date(Math.ceil((Date.now() + 3600_000) / 3600_000) * 3600_000);
  const end = new Date(+start + 3 * 24 * 3600_000);
  return (
    <>
      <div className="page-head"><div><h1>New voting meeting</h1><p className="muted">Next you will add the questions and the voters.</p></div></div>
      <div className="card" style={{ maxWidth: 720 }}>
        <ActionForm action={createMeeting}>
          <div className="field">
            <label htmlFor="title">Meeting name</label>
            <input id="title" name="title" type="text" required placeholder="e.g. 7th CoC meeting: approval of resolution plan" />
          </div>
          <div className="row">
            <div className="field">
              <label htmlFor="starts_at">Voting starts <span className="hint">IST</span></label>
              <input id="starts_at" name="starts_at" type="datetime-local" required defaultValue={toLocal(start)} />
            </div>
            <div className="field">
              <label htmlFor="ends_at">Voting closes <span className="hint">IST</span></label>
              <input id="ends_at" name="ends_at" type="datetime-local" required defaultValue={toLocal(end)} />
            </div>
          </div>
          <div className="hint" style={{ marginTop: -6, marginBottom: 14 }}>
            Once you lock the meeting, voting opens by itself at the start time and closes by itself at the closing time.
            You can also start it earlier or end it sooner. The record date is the voting start date.
          </div>
          <div className="notice info h-icon" style={{ alignItems: 'flex-start' }}>
            <Eye size={18} aria-hidden="true" style={{ marginTop: 2, flex: 'none' }} />
            <span>This is an <strong>open ballot</strong>: once voting ends you see each voter’s choices by name, with their share. Voters are told this before they vote.</span>
          </div>
          <Submit pendingText="Creating…"><CalendarPlus size={18} aria-hidden="true" /> Create meeting</Submit>
        </ActionForm>
      </div>
    </>
  );
}
