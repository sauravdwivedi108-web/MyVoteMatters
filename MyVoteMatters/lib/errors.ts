const MESSAGES: Record<string, string> = {
  roll_frozen: 'The voter roll is locked because this election has left draft.',
  config_frozen: 'This election is locked after approval and cannot be edited.',
  maker_checker: 'You submitted this election, so someone else must approve it.',
  invalid_transition: 'That step is not allowed from the election’s current state.',
  empty_roll: 'Import at least one eligible voter before submitting.',
  no_ballot: 'Save the ballot before submitting.',
  invalid_ballot: 'The ballot is incomplete',
  results_suppressed: 'Ballots can only be counted after the election is closed.',
  reconciliation_failed: 'Counting stopped: the ballots do not reconcile with the votes recorded. Nothing was published.',
  definition_mismatch: 'The ballot no longer matches the approved version. Counting stopped.',
  forbidden: 'Your role does not allow this action.',
};

/** Turns database and domain errors into a sentence safe to show an administrator. */
export function friendlyError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const code = (err as { code?: string })?.code;
  if (code === '23505') return 'That already exists.';
  for (const [key, msg] of Object.entries(MESSAGES)) {
    if (!raw.startsWith(key)) continue;
    const detail = raw.includes(':') ? raw.slice(raw.indexOf(':') + 1).trim() : '';
    if (key === 'invalid_ballot' && detail) return `${msg}: ${detail}`;
    if (key === 'forbidden' && detail) return detail.charAt(0).toUpperCase() + detail.slice(1) + '.';
    return msg;
  }
  if (/decrypt|Unsupported state|bad decrypt|unable to authenticate|DECODER|key/i.test(raw)) {
    return 'That tally key does not match this election.';
  }
  console.error(err);
  return 'Something went wrong. Nothing was changed.';
}
