import { requireSession, can } from '@/lib/auth';
import { listTeam } from '@/lib/queries';
import { ActionForm, Submit } from '@/components/forms';
import { addMember } from '@/lib/actions';
import { Users, UserPlus } from 'lucide-react';

export const metadata = { title: 'Team' };

const ROLES: [string, string, string][] = [
  ['owner', 'Owner', 'Everything, including team management'],
  ['election_admin', 'Election admin', 'Creates elections, imports voters, builds ballots, sends links, opens and closes voting, counts'],
  ['approver', 'Approver', 'Independently approves elections and publishes results'],
  ['scrutinizer', 'Scrutinizer', 'Counts with the tally key and publishes results'],
  ['viewer', 'Viewer', 'Read-only'],
];

export default async function Team() {
  const s = await requireSession();
  const team = await listTeam(s);
  return (
    <>
      <div className="page-head"><div><h1>Team</h1><p className="muted">Approval needs a second person: whoever submits an election cannot approve it.</p></div></div>
      <div className="grid-2">
        <div className="card">
          <h2 className="h-icon"><Users size={20} aria-hidden="true" />Members</h2>
          <table>
            <thead><tr><th>Name</th><th>Role</th></tr></thead>
            <tbody>
              {team.map((m) => (
                <tr key={m.email}><td><strong>{m.name ?? m.email}</strong><div className="small muted">{m.email}</div></td>
                  <td>{ROLES.find((r) => r[0] === m.role)?.[1] ?? m.role}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        {can(s, 'team') ? (
          <div className="card">
            <h2 className="h-icon"><UserPlus size={20} aria-hidden="true" />Add a member</h2>
            <ActionForm action={addMember}>
              <div className="field"><label htmlFor="name">Name</label><input id="name" name="name" type="text" required /></div>
              <div className="field"><label htmlFor="email">Email</label><input id="email" name="email" type="email" required /></div>
              <div className="field">
                <label htmlFor="role">Role</label>
                <select id="role" name="role" defaultValue="approver">
                  {ROLES.map(([v, l, d]) => <option key={v} value={v}>{l}: {d}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="password">Temporary password <span className="hint">share it with them directly</span></label>
                <input id="password" name="password" type="text" minLength={10} required autoComplete="off" />
              </div>
              <Submit pendingText="Adding…">Add member</Submit>
            </ActionForm>
          </div>
        ) : <div className="card"><p className="muted">Only the owner can add members.</p></div>}
      </div>
    </>
  );
}
