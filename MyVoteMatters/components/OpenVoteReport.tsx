'use client';

import type { AgendaBallot } from '@/lib/core/ballot';
import { splitPicks } from '@/lib/core/ballot';
import type { OpenVoteRow } from '@/lib/queries';
import { csvCell, download } from './Panels';
import { Download } from 'lucide-react';

const share = (part: bigint, total: bigint) => (total === 0n ? 0 : Number((part * 1000000n) / total) / 10000);
const fmtPct = (n: number) => `${n.toFixed(2)}%`;
const when = (d: Date | string) => new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(d));

/**
 * Who voted for what on an open (creditor) ballot, with each voter's share of
 * the total voting weight. Choices arrive only after voting has closed.
 */
export function OpenVoteReport({ title, definition, rows }: { title: string; definition: AgendaBallot; rows: OpenVoteRow[] }) {
  const total = rows.reduce((n, r) => n + BigInt(r.voting_units), 0n);
  const voted = rows.filter((r) => r.voted);
  const votedShare = voted.reduce((n, r) => n + BigInt(r.voting_units), 0n);
  const closed = rows.some((r) => r.choices);
  const picked = (r: OpenVoteRow, itemId: string) => {
    if (!r.choices) return r.voted ? '' : 'Did not vote';
    const item = definition.items.find((i) => i.id === itemId)!;
    const names = splitPicks(r.choices[itemId] ?? '').map((p) => item.options.find((o) => o.id === p)?.name ?? p);
    return names.length ? names.join('; ') : 'No choice';
  };

  function csv() {
    const head = ['Voter', 'Voting weight', 'Share of total %', 'Voted', 'Voted at (IST)', ...definition.items.map((i) => i.title)];
    const lines = rows.map((r) => [
      r.eligibility_ref, r.voting_units, share(BigInt(r.voting_units), total).toFixed(4), r.voted ? 'Yes' : 'No',
      r.cast_at ? when(r.cast_at) : '', ...definition.items.map((i) => picked(r, i.id)),
    ].map((v) => csvCell(String(v))).join(','));
    download(`who-voted-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.csv`, [head.map(csvCell).join(','), ...lines].join('\n'), 'text/csv');
  }

  return (
    <div>
      <p className="small muted" style={{ marginTop: 0 }}>
        {voted.length} of {rows.length} voters have voted, holding {fmtPct(share(votedShare, total))} of the total voting share.
        {!closed && ' Individual choices appear here once voting closes.'}
      </p>
      {closed && <button className="btn secondary small" onClick={csv} style={{ marginBottom: 10 }}><Download size={16} aria-hidden="true" /> Download report (CSV)</button>}
      <div className="table-wrap" style={{ maxHeight: 420, overflow: 'auto' }}>
        <table>
          <thead>
            <tr><th>Voter</th><th className="r">Share</th>
              {closed ? definition.items.map((i) => <th key={i.id}>{i.title}</th>) : <th>Status</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.eligibility_ref}>
                <td><strong>{r.eligibility_ref}</strong>{r.cast_at && <div className="small muted">{when(r.cast_at)} IST</div>}</td>
                <td className="r num">{fmtPct(share(BigInt(r.voting_units), total))}</td>
                {closed
                  ? definition.items.map((i) => <td key={i.id} className={r.choices ? '' : 'muted'}>{picked(r, i.id)}</td>)
                  : <td>{r.voted ? <span className="badge open">Voted</span> : <span className="muted">Not yet</span>}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
