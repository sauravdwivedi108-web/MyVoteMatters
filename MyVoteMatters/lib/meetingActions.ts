'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { db } from './pool';
import { createElection, importRoll, submitForApproval, approveElection, transition, extendVoting as extendCore } from './core/elections';
import { issueVoterLogins, chooseVoterLogin, chosenLoginProblem, loginIdTaken, displayLoginId, type IssuedLogin } from './core/voterLogins';
import { requirePermission, requireSession } from './auth';
import { friendlyError } from './errors';
import type { FormState } from './actions';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const istDate = (v: string) => new Date(`${v}:00+05:30`);

/** A meeting is an administrator-run, open-ballot vote: it opens when the administrator starts it. */
export async function createMeeting(_: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  let id: string;
  try {
    requirePermission(s, 'manage');
    const title = str(fd, 'title');
    const endsAt = istDate(str(fd, 'ends_at'));
    if (!title) return { error: 'Give the meeting a name.' };
    if (isNaN(+endsAt)) return { error: 'Choose when voting closes.' };
    if (+endsAt <= Date.now() + 5 * 60_000) return { error: 'Voting must close at least a few minutes from now.' };
    id = await createElection(await db(), s.orgId, s.userId, {
      title, kind: 'creditor_vote', startsAt: new Date(Date.now() - 60_000), endsAt, recordDate: str(fd, 'record_date') || undefined,
    });
  } catch (err) {
    return { error: friendlyError(err) };
  }
  redirect(`/app/elections/${id}?tab=questions`);
}

/**
 * Adds one voter by name and weight. With "create automatically" unticked the
 * administrator gives the voter's login ID and password here instead.
 */
export async function addVoter(electionId: string, _: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  let chosenId = '';
  try {
    requirePermission(s, 'manage');
    const name = str(fd, 'name');
    const weight = str(fd, 'weight').replace(/[₹,\s]/g, '');
    if (!name) return { error: 'Enter the voter’s name.' };
    const pool = await db();
    const custom = fd.get('auto_login') !== 'on';
    const loginId = str(fd, 'login_id'), password = str(fd, 'password');
    if (custom) {
      const problem = chosenLoginProblem(loginId, password);
      if (problem) return { error: problem };
      if (await loginIdTaken(pool, loginId)) return { error: `The voter ID ${displayLoginId(loginId.toUpperCase())} is already in use. Choose another.` };
    }
    const r = await importRoll(pool, s.orgId, s.userId, electionId, [{ eligibilityRef: name, votingUnits: weight || '1' }]);
    if (r.rejected.length) return { error: `${name}: ${r.rejected[0].reason}` };
    if (custom) {
      if (!await chooseVoterLogin(pool, s.orgId, electionId, name, loginId, password)) {
        return { error: `${name} was added, but the voter ID ${displayLoginId(loginId.toUpperCase())} was just taken. Remove ${name} and add them again with another ID.` };
      }
      chosenId = displayLoginId(loginId.trim().toUpperCase());
    }
  } catch (err) {
    return { error: friendlyError(err) };
  }
  revalidatePath(`/app/elections/${electionId}`);
  return { ok: chosenId ? `Voter added with ID ${chosenId} and the password you chose.` : 'Voter added.' };
}

/**
 * Locks questions and voters, records the administrator's approval and gives
 * every voter a login ID and password. Passwords are returned once and never stored.
 */
export async function lockAndIssueIds(electionId: string): Promise<FormState & { logins?: IssuedLogin[] }> {
  const s = await requireSession();
  try {
    requirePermission(s, 'manage');
    const pool = await db();
    await submitForApproval(pool, s.orgId, s.userId, electionId);
    // Open ballot: results come from the named records, so the encryption key is not kept.
    await approveElection(pool, s.orgId, s.userId, electionId);
    const logins = await issueVoterLogins(pool, s.orgId, s.userId, electionId);
    return { ok: `Created ${logins.length} voter IDs.`, logins };
  } catch (err) {
    return { error: friendlyError(err) };
  }
}

/** New password for one voter, generated or chosen by the administrator; the login ID stays the same. */
export async function resetVoterPassword(electionId: string, ref: string, password?: string): Promise<FormState & { logins?: IssuedLogin[] }> {
  const s = await requireSession();
  try {
    requirePermission(s, 'manage');
    if (password !== undefined) {
      const problem = chosenLoginProblem('VOTER', password);
      if (problem) return { error: problem };
    }
    const logins = await issueVoterLogins(await db(), s.orgId, s.userId, electionId, ref, password);
    if (!logins.length) return { error: 'That voter was not found.' };
    return { ok: 'New password created.', logins };
  } catch (err) {
    return { error: friendlyError(err) };
  }
}

/** Voter IDs for voters who do not have one yet (for example after an earlier reset failed midway). */
export async function issueMissingIds(electionId: string): Promise<FormState & { logins?: IssuedLogin[] }> {
  const s = await requireSession();
  try {
    requirePermission(s, 'manage');
    const logins = await issueVoterLogins(await db(), s.orgId, s.userId, electionId);
    return { ok: logins.length ? `Created ${logins.length} voter IDs.` : 'Every voter already has an ID.', logins };
  } catch (err) {
    return { error: friendlyError(err) };
  }
}

async function move(electionId: string, to: 'open' | 'closed'): Promise<FormState> {
  const s = await requireSession();
  try {
    requirePermission(s, 'manage');
    await transition(await db(), s.orgId, s.userId, electionId, to);
  } catch (err) {
    return { error: friendlyError(err) };
  }
  revalidatePath(`/app/elections/${electionId}`);
  revalidatePath('/app');
  return { ok: to === 'open' ? 'Voting has started.' : 'Voting has closed.' };
}
export async function startVoting(electionId: string) { return move(electionId, 'open'); }
export async function endVoting(electionId: string) { return move(electionId, 'closed'); }

export async function extendVoting(electionId: string, _: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  const endsAt = istDate(str(fd, 'ends_at'));
  if (Number.isNaN(endsAt.getTime())) return { error: 'Choose a new closing date and time.' };
  if (endsAt.getTime() <= Date.now()) return { error: 'The new closing time must be in the future.' };
  try {
    requirePermission(s, 'manage');
    await extendCore(await db(), s.orgId, s.userId, electionId, endsAt);
  } catch (err) {
    const msg = String((err as Error).message ?? '');
    if (msg.includes('config_frozen')) return { error: 'The closing time can only be moved later, while voting has not ended.' };
    return { error: friendlyError(err) };
  }
  revalidatePath(`/app/elections/${electionId}`);
  return { ok: 'Closing time extended. Voters see the new time straight away.' };
}
