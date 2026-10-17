import { splitPicks, type AgendaBallot } from './ballot';

export type OptionResult = { id: string; name: string; units: string; voters: number; pctOfTotal: number; pctOfCast: number; abstain: boolean };

/** An option called "Abstain" records the vote but can never be approved or selected. */
export const isAbstain = (name: string) => /^\s*abstain(ed)?\s*$/i.test(name);
export type ItemResult = {
  id: string; title: string; thresholdPct?: number; seats: number;
  options: OptionResult[];
  /** Options approved or elected; empty when a tie straddles the last place. */
  selected: string[];
  tiedAtCutoff: boolean;
  votersOnItem: number; unitsOnItem: string; blank: number;
};

const pct = (part: bigint, whole: bigint) => (whole === 0n ? 0 : Number((part * 1000000n) / whole) / 10000);

/**
 * Counts an open (named) agenda ballot. Each pick carries the voter's whole
 * weight. With a threshold, an option needs that percentage of the total
 * weight on the roll (not only of votes cast); the top `maxChoices` of the
 * options that reach it are selected, and a tie at the cut-off is reported.
 */
export function countAgenda(def: AgendaBallot, ballots: { units: string; choices: Record<string, string> }[], totalUnits: string): ItemResult[] {
  const total = BigInt(totalUnits);
  return def.items.map((it) => {
    const units = new Map(it.options.map((o) => [o.id, 0n]));
    const voters = new Map(it.options.map((o) => [o.id, 0]));
    let onItem = 0, unitsOn = 0n, blank = 0;
    for (const b of ballots) {
      const picks = splitPicks(b.choices[it.id] ?? '');
      const w = BigInt(b.units);
      onItem += 1; unitsOn += w;
      if (!picks.length) blank += 1;
      for (const p of picks) {
        if (!units.has(p)) continue;
        units.set(p, units.get(p)! + w);
        voters.set(p, voters.get(p)! + 1);
      }
    }
    const options = it.options.map((o) => ({
      id: o.id, name: o.name, units: units.get(o.id)!.toString(), voters: voters.get(o.id)!,
      pctOfTotal: pct(units.get(o.id)!, total), pctOfCast: pct(units.get(o.id)!, unitsOn), abstain: isAbstain(o.name),
    }));
    const bp = it.thresholdPct === undefined ? null : BigInt(Math.round(it.thresholdPct * 100));
    const contenders = [...options]
      .filter((o) => !o.abstain && BigInt(o.units) > 0n && (bp === null || BigInt(o.units) * 10000n >= bp * total))
      .sort((a, b) => (BigInt(b.units) > BigInt(a.units) ? 1 : BigInt(b.units) < BigInt(a.units) ? -1 : 0));
    const seats = it.maxChoices;
    const tiedAtCutoff = contenders.length > seats && contenders[seats - 1].units === contenders[seats].units;
    return {
      id: it.id, title: it.title, seats, options,
      ...(it.thresholdPct !== undefined ? { thresholdPct: it.thresholdPct } : {}),
      selected: tiedAtCutoff ? [] : contenders.slice(0, seats).map((o) => o.id),
      tiedAtCutoff, votersOnItem: onItem, unitsOnItem: unitsOn.toString(), blank,
    };
  });
}
