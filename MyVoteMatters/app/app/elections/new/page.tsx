import { redirect } from 'next/navigation';
import { requireSession, can } from '@/lib/auth';
import { ActionForm, Submit } from '@/components/forms';
import { newElection } from '@/lib/actions';

export const metadata = { title: 'New election' };

const toLocal = (d: Date) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 16);

export default async function NewElection() {
  const s = await requireSession();
  if (!can(s, 'manage')) redirect('/app');
  const start = new Date(Date.now() + 10 * 60_000);
  const end = new Date(Date.now() + 3 * 24 * 3600_000);
  return (
    <>
      <div className="page-head"><div><h1>New election</h1><p className="muted">You can import voters and build the ballot next.</p></div></div>
      <div className="card" style={{ maxWidth: 720 }}>
        <ActionForm action={newElection}>
          <div className="field"><label htmlFor="title">Title</label><input id="title" name="title" type="text" required placeholder="Annual General Meeting 2026" /></div>
          <div className="field">
            <label htmlFor="kind">Type</label>
            <select id="kind" name="kind" defaultValue="agm_resolutions">
              <option value="agm_resolutions">AGM resolutions (for / against / abstain, weighted by shares)</option>
              <option value="board_election">Board election (agenda items with candidates, secret ballot)</option>
              <option value="creditor_vote">Creditor / stakeholder vote for an insolvent company (open ballot: admin sees who voted for what)</option>
              <option value="internal_poll">Internal poll (agenda items with options, secret ballot)</option>
            </select>
          </div>
          <div className="row">
            <div className="field"><label htmlFor="starts_at">Voting opens <span className="hint">IST</span></label><input id="starts_at" name="starts_at" type="datetime-local" required defaultValue={toLocal(start)} /></div>
            <div className="field"><label htmlFor="ends_at">Voting closes <span className="hint">IST</span></label><input id="ends_at" name="ends_at" type="datetime-local" required defaultValue={toLocal(end)} /></div>
          </div>
          <div className="field" style={{ maxWidth: 320 }}>
            <label htmlFor="record_date">Record date <span className="hint">optional, for shareholder votes</span></label>
            <input id="record_date" name="record_date" type="date" />
          </div>
          <Submit pendingText="Creating…">Create draft</Submit>
        </ActionForm>
      </div>
    </>
  );
}
