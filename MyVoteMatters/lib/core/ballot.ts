/**
 * Ballot definitions supported in the first release. Deliberately narrow:
 * per-resolution for/against/abstain (weighted by voting units) and a
 * single-choice candidate ballot. Nothing else until it can be specified and
 * tested precisely.
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
export type BallotDefinition = ResolutionBallot | SingleChoiceBallot;

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
  const keys = Object.keys(choices);
  if (keys.length !== 1 || keys[0] !== 'candidate') return 'exactly one candidate must be chosen';
  return def.candidates.some((c) => c.id === choices.candidate) ? null : 'unknown candidate';
}
