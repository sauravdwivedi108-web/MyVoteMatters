/**
 * Ballot definitions. Deliberately narrow: per-resolution for/against/abstain
 * (weighted by voting units), a single-choice candidate ballot, and an agenda
 * of items where the administrator sets how many options a voter may pick.
 */

export type ResolutionBallot = {
  type: 'resolutions';
  resolutions: { id: string; title: string; text: string; majority: 'ordinary' | 'special' }[];
};
export type SingleChoiceBallot = {
  type: 'single_choice';
  question: string;
  candidates: { id: string; name: string }[];
};
/**
 * One or more agenda items (for example board seats), each with its own
 * options and its own minimum and maximum number of picks. The top
 * `maxChoices` options of an item, by voting units, are its result.
 */
export type AgendaItem = {
  id: string; title: string; description: string;
  options: { id: string; name: string; detail?: string }[];
  minChoices: number; maxChoices: number;
};
export type AgendaBallot = { type: 'agenda'; items: AgendaItem[] };
export type BallotDefinition = ResolutionBallot | SingleChoiceBallot | AgendaBallot;

/** An agenda answer is the chosen option ids joined by commas, in ballot order; empty when none. */
export const splitPicks = (v: string) => (v ? v.split(',') : []);

/** Puts each agenda answer into ballot order so the same selection always encodes the same way. */
export function normalizeChoices(def: BallotDefinition, choices: Choices): Choices {
  if (def.type !== 'agenda' || !choices || typeof choices !== 'object') return choices;
  const out: Choices = {};
  for (const [k, v] of Object.entries(choices)) {
    const item = def.items.find((i) => i.id === k);
    if (!item || typeof v !== 'string') { out[k] = v; continue; }
    const order = item.options.map((o) => o.id);
    out[k] = [...splitPicks(v)].sort((a, b) => order.indexOf(a) - order.indexOf(b)).join(',');
  }
  return out;
}

/** Encrypted ballots have a fixed size; the largest possible answer must fit with room to spare. */
const MAX_CHOICES_BYTES = 1700;

export type Choices = Record<string, string>;
export const RESOLUTION_OPTIONS = ['for', 'against', 'abstain'] as const;

export function validateDefinition(def: BallotDefinition): string[] {
  const errors: string[] = [];
  const unique = (ids: string[], what: string) => {
    if (new Set(ids).size !== ids.length) errors.push(`duplicate ${what} id`);
  };
  if (def.type === 'resolutions') {
    if (!def.resolutions.length) errors.push('at least one resolution is required');
    unique(def.resolutions.map((r) => r.id), 'resolution');
    for (const r of def.resolutions) {
      if (!r.title.trim() || !r.text.trim()) errors.push(`resolution ${r.id} needs a title and text`);
      if (!['ordinary', 'special'].includes(r.majority)) errors.push(`resolution ${r.id} has an unknown majority rule`);
    }
  } else if (def.type === 'single_choice') {
    if (def.candidates.length < 2) errors.push('at least two candidates are required');
    unique(def.candidates.map((c) => c.id), 'candidate');
  } else if (def.type === 'agenda') {
    if (!def.items?.length) errors.push('add at least one agenda item');
    unique(def.items.map((i) => i.id), 'agenda item');
    let worst = 0;
    def.items.forEach((item, n) => {
      const label = item.title.trim() || `item ${n + 1}`;
      if (!item.title.trim()) errors.push(`agenda item ${n + 1} needs a title`);
      if (item.options.length < 2) errors.push(`${label} needs at least two options`);
      if (item.options.some((o) => !o.name.trim())) errors.push(`${label} has an option with no name`);
      unique(item.options.map((o) => o.id), `option in ${label}`);
      if (!Number.isInteger(item.minChoices) || !Number.isInteger(item.maxChoices)
          || item.minChoices < 0 || item.maxChoices < 1 || item.minChoices > item.maxChoices
          || item.maxChoices > item.options.length) {
        errors.push(`${label}: picks must be between 0 and the number of options, with at least 1 allowed`);
      }
      const longest = item.options.map((o) => o.id.length + 1).sort((a, b) => b - a).slice(0, item.maxChoices);
      worst += item.id.length + 6 + longest.reduce((a, b) => a + b, 0);
    });
    if (worst > MAX_CHOICES_BYTES) errors.push('this ballot allows too many picks to fit in one secret ballot; split it into separate elections');
  } else {
    errors.push('unsupported ballot type');
  }
  return errors;
}

/**
 * Server-side check of a voter's choices. For resolutions every item must be
 * answered (abstain is an explicit answer); a partial ballot is rejected
 * rather than silently treated as abstentions.
 */
export function validateChoices(def: BallotDefinition, choices: Choices): string | null {
  if (!choices || typeof choices !== 'object') return 'choices missing';
  if (def.type === 'resolutions') {
    const ids = def.resolutions.map((r) => r.id);
    if (Object.keys(choices).length !== ids.length || !ids.every((id) => id in choices)) {
      return 'every resolution must be answered';
    }
    for (const id of ids) {
      if (!(RESOLUTION_OPTIONS as readonly string[]).includes(choices[id])) return `invalid choice for ${id}`;
    }
    return null;
  }
  if (def.type === 'agenda') {
    const ids = def.items.map((i) => i.id);
    if (Object.keys(choices).length !== ids.length || !ids.every((id) => id in choices)) {
      return 'every agenda item must be answered';
    }
    for (const item of def.items) {
      const v = choices[item.id];
      if (typeof v !== 'string') return `invalid choice for ${item.id}`;
      const picks = splitPicks(v);
      if (new Set(picks).size !== picks.length) return `duplicate option in ${item.id}`;
      if (!picks.every((p) => item.options.some((o) => o.id === p))) return `unknown option in ${item.id}`;
      if (picks.length < item.minChoices || picks.length > item.maxChoices) {
        return `${item.id} needs between ${item.minChoices} and ${item.maxChoices} choices`;
      }
      if (normalizeChoices(def, { [item.id]: v })[item.id] !== v) return `choices for ${item.id} are not in ballot order`;
    }
    return null;
  }
  const keys = Object.keys(choices);
  if (keys.length !== 1 || keys[0] !== 'candidate') return 'exactly one candidate must be chosen';
  return def.candidates.some((c) => c.id === choices.candidate) ? null : 'unknown candidate';
}

/** How an agenda item's pick rule reads to people, e.g. "Choose up to 3". */
export function picksLabel(min: number, max: number) {
  if (min === max) return max === 1 ? 'Choose one' : `Choose exactly ${max}`;
  if (min === 0) return max === 1 ? 'Choose one, or none' : `Choose up to ${max}`;
  return `Choose ${min} to ${max}`;
}
