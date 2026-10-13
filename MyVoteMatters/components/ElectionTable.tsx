import Link from 'next/link';
import type { ElectionSummary } from '@/lib/queries';
import { StatusBadge, kindLabel, ist } from './Status';

export function ElectionTable({ elections, canCreate }: { elections: ElectionSummary[]; canCreate: boolean }) {
  if (!elections.length) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 40 }}>
        <h2>No elections yet</h2>
        <p className="muted">Create your first election to import voters and build a ballot.</p>
        {canCreate && <Link className="btn" href="/app/elections/new">Create an election</Link>}
      </div>
    );
  }
  return (
    <div className="card">
      <div className="table-wrap">
        <table>
          <thead><tr><th>Election</th><th>Status</th><th>Voting window</th><th className="r">Turnout</th></tr></thead>
          <tbody>
            {elections.map((e) => (
              <tr key={e.id}>
                <td><Link href={`/app/elections/${e.id}`}><strong>{e.title}</strong></Link><div className="small muted">{kindLabel(e.kind)}</div></td>
                <td><StatusBadge status={e.status} /></td>
                <td className="small">{ist(e.starts_at)}<br /><span className="muted">to {ist(e.ends_at)}</span></td>
                <td className="r num">{e.voted} / {e.eligible}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
