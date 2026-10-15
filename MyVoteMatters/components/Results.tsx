import { picksLabel, type BallotDefinition } from '@/lib/core/ballot';
import type { TallyResult } from '@/lib/core/tally';
import { units } from './Status';

const pct = (part: bigint, whole: bigint) => (whole === 0n ? 0 : Number((part * 10000n) / whole) / 100);

export function Results({ definition, result }: { definition: BallotDefinition; result: TallyResult }) {
  if (definition.type === 'resolutions' && result.resolutions) {
    return (
      <div className="stack">
        {result.resolutions.map((r, i) => {
          const d = definition.resolutions.find((x) => x.id === r.id);
          const f = BigInt(r.units.for), a = BigInt(r.units.against), ab = BigInt(r.units.abstain);
          const cast = f + a;
          return (
            <div key={r.id} className="item" style={{ background: '#fff' }}>
              <div className="item-head" style={{ alignItems: 'flex-start' }}>
                <div>
                  <div className="small muted">Resolution {i + 1} · {r.majority === 'special' ? 'Special' : 'Ordinary'} resolution</div>
                  <strong>{d?.title}</strong>
                </div>
                <span className={`badge ${r.passed ? 'open' : 'draft'}`}>{r.passed ? 'Passed' : 'Not passed'}</span>
              </div>
              <div className="meter" aria-hidden="true"><span style={{ width: `${pct(f, cast)}%` }} /></div>
              <table style={{ marginTop: 8 }}>
                <thead><tr><th></th><th className="r">Voting units</th><th className="r">% of for + against</th><th className="r">Ballots</th></tr></thead>
                <tbody>
                  <tr><td>For</td><td className="r num">{units(f)}</td><td className="r num">{pct(f, cast)}%</td><td className="r num">{r.ballots.for}</td></tr>
                  <tr><td>Against</td><td className="r num">{units(a)}</td><td className="r num">{pct(a, cast)}%</td><td className="r num">{r.ballots.against}</td></tr>
                  <tr><td>Abstain</td><td className="r num">{units(ab)}</td><td className="r num muted">not counted</td><td className="r num">{r.ballots.abstain}</td></tr>
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    );
  }
  if (definition.type === 'agenda' && result.agenda) {
    return (
      <div className="stack">
        {result.agenda.map((it, i) => {
          const d = definition.items.find((x) => x.id === it.id);
          const all = result.unitsEligible ? BigInt(result.unitsEligible) : null;
          const top = it.options.reduce((m, o) => (BigInt(o.votes) > m ? BigInt(o.votes) : m), 0n);
          const sorted = [...it.options].sort((x, y) => (BigInt(y.votes) > BigInt(x.votes) ? 1 : BigInt(y.votes) < BigInt(x.votes) ? -1 : 0));
          return (
            <div key={it.id} className="item" style={{ background: '#fff' }}>
              <div className="item-head" style={{ alignItems: 'flex-start' }}>
                <div>
                  <div className="small muted">Item {i + 1} · {d ? picksLabel(d.minChoices, d.maxChoices) : ''} · {it.thresholdPct !== undefined
                    ? `needs ${it.thresholdPct}% of total voting share` : `top ${it.seats} ${it.seats === 1 ? 'wins' : 'win'}`}</div>
                  <strong>{it.title}</strong>
                </div>
              </div>
              {it.thresholdPct !== undefined && !it.selected.length && !it.tiedAtCutoff && <div className="notice warn">No option reached {it.thresholdPct}% of the total voting share.</div>}
              {it.tiedAtCutoff && <div className="notice warn">There is a tie for the last winning place. The rules do not break ties automatically.</div>}
              <table>
                <thead><tr><th>Option</th><th className="r">Votes</th>{all !== null && <th className="r">% of total voting share</th>}<th className="r">% of votes cast</th><th className="r">Voters</th></tr></thead>
                <tbody>
                  {sorted.map((o) => (
                    <tr key={o.id}>
                      <td>{o.name} {it.selected.includes(o.id) && <span className="badge open" style={{ marginLeft: 6 }}>{it.thresholdPct !== undefined ? 'Approved' : it.seats === 1 ? 'Winner' : 'Elected'}</span>}
                        <div className="meter" aria-hidden="true" style={{ marginTop: 6 }}><span style={{ width: `${pct(BigInt(o.votes), top)}%` }} /></div></td>
                      <td className="r num">{units(o.votes)}</td>
                      {all !== null && <td className="r num"><strong>{pct(BigInt(o.votes), all)}%</strong></td>}
                      <td className="r num">{pct(BigInt(o.votes), BigInt(result.reconciliation.unitsInBallots))}%</td>
                      <td className="r num">{o.ballots}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {it.blankBallots > 0 && <p className="small muted" style={{ marginBottom: 0 }}>{it.blankBallots} {it.blankBallots === 1 ? 'voter' : 'voters'} chose no option on this item.</p>}
            </div>
          );
        })}
      </div>
    );
  }
  if (definition.type === 'single_choice' && result.candidates) {
    const total = result.candidates.reduce((n, c) => n + BigInt(c.votes), 0n);
    const sorted = [...result.candidates].sort((x, y) => (BigInt(y.votes) > BigInt(x.votes) ? 1 : -1));
    return (
      <div>
        <p><strong>{definition.question}</strong></p>
        {result.winner === null && <div className="notice warn">There is a tie for first place. The rules do not break ties automatically.</div>}
        <table>
          <thead><tr><th>Option</th><th className="r">Votes</th><th className="r">Share</th></tr></thead>
          <tbody>
            {sorted.map((c) => (
              <tr key={c.id}>
                <td>{c.name} {result.winner === c.id && <span className="badge open" style={{ marginLeft: 6 }}>Winner</span>}</td>
                <td className="r num">{units(c.votes)}</td>
                <td className="r num">{pct(BigInt(c.votes), total)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return null;
}

export function Reconciliation({ result, resultHash }: { result: TallyResult; resultHash: string }) {
  const r = result.reconciliation;
  return (
    <div className="notice ok small">
      <strong>Reconciled.</strong> {r.ballots} ballots match {r.consumptions} entitlements used, and {units(r.unitsInBallots)} voting units in
      ballots match {units(r.unitsConsumed)} units recorded.
      <div className="mono" style={{ marginTop: 6, wordBreak: 'break-all' }}>
        Input manifest {result.inputManifestHash}<br />Result hash {resultHash}
      </div>
    </div>
  );
}
