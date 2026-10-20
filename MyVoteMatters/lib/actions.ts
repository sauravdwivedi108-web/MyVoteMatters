'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { randomUUID } from 'node:crypto';
import { db } from './pool';
import { withTenant, audit } from './core/db';
import {
  createElection, importRoll, setBallotDefinition, submitForApproval, approveElection,
  issueCredentials, transition,
} from './core/elections';
import { tallyElection } from './core/tally';
import type { BallotDefinition } from './core/ballot';
import { endSession, hashPassword, requirePermission, requireSession, startSession, verifyPassword } from './auth';
import { friendlyError } from './errors';
import { resolveVoterLogin } from './core/voterLogins';

export type FormState = { error?: string; ok?: string; voterToken?: string } | undefined;

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || /^[a-z0-9][a-z0-9._-]{2,39}$/.test(e);

/** datetime-local values are entered in India Standard Time. */
const istDate = (v: string) => new Date(`${v}:00+05:30`);

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export async function signup(_: FormState, fd: FormData): Promise<FormState> {
  const orgName = str(fd, 'org');
  const name = str(fd, 'name');
  const email = str(fd, 'email').toLowerCase();
  const password = String(fd.get('password') ?? '');
  if (!orgName || !name) return { error: 'Enter your organisation and your name.' };
  if (!emailOk(email)) return { error: 'Enter a valid email address or a username (3 to 40 letters, numbers, dots or dashes).' };
  if (password.length < 5) return { error: 'Use a password of at least 5 characters.' };

  const orgId = randomUUID();
  let userId: string;
  try {
    const pool = await db();
    const hash = await hashPassword(password);
    userId = await withTenant(pool, orgId, async (tx) => {
      const exists = await tx.query(`SELECT 1 FROM users WHERE email_normalized = $1`, [email]);
      if (exists.rowCount) throw Object.assign(new Error('exists'), { code: 'email_taken' });
      const slug = `${orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)}-${orgId.slice(0, 6)}`;
      await tx.query(`INSERT INTO organizations (id, name, slug) VALUES ($1, $2, $3)`, [orgId, orgName, slug]);
      const { rows: [u] } = await tx.query(
        `INSERT INTO users (email_normalized, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id`, [email, name, hash]);
      await tx.query(`INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, 'owner')`, [orgId, u.id]);
      await audit(tx, orgId, `user:${u.id}`, 'organization.created', `organization:${orgId}`);
      return u.id;
    });
  } catch (err) {
    if ((err as { code?: string }).code === 'email_taken') return { error: 'An account with that email already exists. Sign in instead.' };
    return { error: friendlyError(err) };
  }
  await startSession(userId, orgId);
  redirect('/app');
}

export async function login(_: FormState, fd: FormData): Promise<FormState> {
  const email = str(fd, 'email').toLowerCase();
  const password = String(fd.get('password') ?? '');
  const pool = await db();
  const found = await withTenant(pool, null, async (tx) => {
    const { rows: [u] } = await tx.query(
      `SELECT id, password_hash FROM users WHERE email_normalized = $1 AND status = 'active'`, [email]);
    const ok = await verifyPassword(password, u?.password_hash ?? null);
    if (!u || !ok) return null;
    const { rows } = await tx.query(`SELECT * FROM vs.user_memberships($1)`, [u.id]);
    return rows[0] ? { userId: u.id as string, orgId: rows[0].organization_id as string } : null;
  });
  if (!found) {
    // Voters often use this page by mistake: if these are a voter's ID and password, take them to their ballot.
    const voter = await resolveVoterLogin(pool, str(fd, 'email'), password).catch(() => null);
    if (voter) return { ok: 'Opening your ballot…', voterToken: `${voter.orgId}.${voter.electionId}.${voter.secret}` };
    return { error: 'That username or email and password do not match an account. Voters: use the voter ID and password from your slip.' };
  }
  await startSession(found.userId, found.orgId);
  redirect('/app');
}

export async function logout() {
  await endSession();
  redirect('/');
}

export async function addMember(_: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  let kept = false;
  try {
    requirePermission(s, 'team');
    const email = str(fd, 'email').toLowerCase();
    const name = str(fd, 'name');
    const role = str(fd, 'role');
    const password = String(fd.get('password') ?? '');
    if (!emailOk(email) || !name) return { error: 'Enter a name and a valid email address or username.' };
    if (!['election_admin', 'approver', 'scrutinizer', 'viewer', 'owner'].includes(role)) return { error: 'Choose a role.' };
    if (password.length < 5) return { error: 'Set a temporary password of at least 5 characters.' };
    const hash = await hashPassword(password);
    kept = await withTenant(await db(), s.orgId, async (tx) => {
      let { rows: [u] } = await tx.query(`SELECT id, password_hash FROM users WHERE email_normalized = $1`, [email]);
      const hadPassword = !!u?.password_hash;
      if (!u) {
        ({ rows: [u] } = await tx.query(
          `INSERT INTO users (email_normalized, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id`, [email, name, hash]));
      } else if (!u.password_hash) {
        // A previously removed user coming back: give them the new temporary password.
        await tx.query(`UPDATE users SET password_hash = $2, display_name = $3 WHERE id = $1`, [u.id, hash, name]);
      }
      await tx.query(`INSERT INTO memberships (organization_id, user_id, role) VALUES (vs.current_org(), $1, $2)`, [u.id, role]);
      await audit(tx, s.orgId, `user:${s.userId}`, 'member.added', `user:${u.id}`, { role });
      return hadPassword;
    });
  } catch (err) {
    return { error: friendlyError(err) };
  }
  revalidatePath('/app/team');
  // Someone who already has an account keeps their own password; the one typed here is not applied.
  if (kept) return { ok: `Member added. This username or email already had an account, so they log in with their existing password, not the one typed here. Use Reset password below if they need a new one.` };
  return { ok: 'Member added. Share the temporary password with them directly.' };
}

/** Memberships in this organisation, checked so the last owner can never be removed or demoted. */
async function memberFor(tx: Parameters<typeof audit>[0], userId: string) {
  const { rows: [m] } = await tx.query(`SELECT role FROM memberships WHERE user_id = $1`, [userId]);
  if (!m) throw new Error('forbidden: that person is not a member of this organisation');
  const { rows: [o] } = await tx.query(`SELECT count(*)::int AS n FROM memberships WHERE role = 'owner' AND status = 'active'`);
  return { role: m.role as string, owners: o.n as number };
}

export async function changeRole(userId: string, _: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  const role = str(fd, 'role');
  try {
    requirePermission(s, 'team');
    if (!['election_admin', 'approver', 'scrutinizer', 'viewer', 'owner'].includes(role)) return { error: 'Choose a role.' };
    await withTenant(await db(), s.orgId, async (tx) => {
      const m = await memberFor(tx, userId);
      if (m.role === 'owner' && role !== 'owner' && m.owners <= 1) throw new Error('forbidden: the organisation needs at least one owner');
      await tx.query(`UPDATE memberships SET role = $2 WHERE user_id = $1`, [userId, role]);
      await audit(tx, s.orgId, `user:${s.userId}`, 'member.role_changed', `user:${userId}`, { from: m.role, to: role });
    });
  } catch (err) {
    return { error: friendlyError(err) };
  }
  revalidatePath('/app/team');
  return { ok: 'Role updated.' };
}

/** Sets a new temporary password and signs the member out everywhere. */
export async function resetPassword(userId: string, _: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  const password = String(fd.get('password') ?? '');
  try {
    requirePermission(s, 'team');
    if (password.length < 5) return { error: 'Use a password of at least 5 characters.' };
    const hash = await hashPassword(password);
    await withTenant(await db(), s.orgId, async (tx) => {
      await memberFor(tx, userId);
      // An owner here must not take over an account that also belongs to another organisation.
      const { rows } = await tx.query(`SELECT organization_id FROM vs.user_memberships($1)`, [userId]);
      if (rows.some((r) => r.organization_id !== s.orgId)) {
        throw new Error('forbidden: this person also belongs to another organisation, so only they can change their password');
      }
      await tx.query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [userId, hash]);
      await tx.query(`UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
      await audit(tx, s.orgId, `user:${s.userId}`, 'member.password_reset', `user:${userId}`);
    });
  } catch (err) {
    return { error: friendlyError(err) };
  }
  revalidatePath('/app/team');
  return { ok: userId === s.userId ? 'Password changed. Sign in again with the new one.' : 'Password reset. Share it with them directly.' };
}

/** Removes a member's access to this organisation and ends their sessions here. */
export async function removeMember(userId: string): Promise<FormState> {
  const s = await requireSession();
  try {
    requirePermission(s, 'team');
    if (userId === s.userId) return { error: 'You cannot remove yourself. Ask another owner.' };
    await withTenant(await db(), s.orgId, async (tx) => {
      const m = await memberFor(tx, userId);
      if (m.role === 'owner' && m.owners <= 1) throw new Error('forbidden: the organisation needs at least one owner');
      await tx.query(`DELETE FROM memberships WHERE user_id = $1`, [userId]);
      await tx.query(`UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND organization_id = vs.current_org() AND revoked_at IS NULL`, [userId]);
      // With no organisation left, the login itself is switched off.
      const { rows } = await tx.query(`SELECT 1 FROM vs.user_memberships($1)`, [userId]);
      if (!rows.length) await tx.query(`UPDATE users SET password_hash = NULL WHERE id = $1`, [userId]);
      await audit(tx, s.orgId, `user:${s.userId}`, 'member.removed', `user:${userId}`, { role: m.role });
    });
  } catch (err) {
    return { error: friendlyError(err) };
  }
  revalidatePath('/app/team');
  return { ok: 'Removed.' };
}

// ---------------------------------------------------------------------------
// Elections
// ---------------------------------------------------------------------------

export async function newElection(_: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  let id: string;
  try {
    requirePermission(s, 'manage');
    const title = str(fd, 'title');
    const kind = str(fd, 'kind') as 'agm_resolutions' | 'board_election' | 'internal_poll' | 'creditor_vote';
    const startsAt = istDate(str(fd, 'starts_at'));
    const endsAt = istDate(str(fd, 'ends_at'));
    if (!title) return { error: 'Give the election a title.' };
    if (!['agm_resolutions', 'board_election', 'internal_poll', 'creditor_vote'].includes(kind)) return { error: 'Choose an election type.' };
    if (isNaN(+startsAt) || isNaN(+endsAt)) return { error: 'Enter when voting opens and closes.' };
    if (endsAt <= startsAt) return { error: 'Voting must close after it opens.' };
    id = await createElection(await db(), s.orgId, s.userId, {
      title, kind, startsAt, endsAt, recordDate: str(fd, 'record_date') || undefined,
    });
  } catch (err) {
    return { error: friendlyError(err) };
  }
  redirect(`/app/elections/${id}`);
}

export async function uploadRoll(electionId: string, _: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  try {
    requirePermission(s, 'manage');
    const text = str(fd, 'csv');
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const header = lines[0] && /ref|folio|member|id|name|creditor/i.test(lines[0]) && !/\d+\s*$/.test(lines[0]);
    if (header) lines.shift();
    if (!lines.length) return { error: 'Paste at least one row: reference, voting units.' };
    const rows = lines.map((l) => {
      // The last column is the weight, so names may contain commas. Rows copied from
      // Excel are tab-separated and may show amounts as 4,50,00,000 or with a ₹ sign.
      const m = l.includes('\t') ? l.match(/^(.*)\t\s*([^\t]*)$/) : (l.match(/^(.*?)[,;]\s*(₹?\s*\d[\d,\s]*)$/) ?? l.match(/^(.*)[,;]\s*([^,;]*)$/));
      const ref = (m ? m[1] : l).trim().replace(/[,;\t]+$/, '').trim();
      const units = (m ? m[2] : '').replace(/[₹,\s]/g, '');
      return { eligibilityRef: ref, votingUnits: units };
    });
    const report = await importRoll(await db(), s.orgId, s.userId, electionId, rows);
    revalidatePath(`/app/elections/${electionId}`);
    const rejected = report.rejected.slice(0, 8)
      .map((r) => `line ${r.row + (header ? 1 : 0)} (${r.ref || 'blank'}): ${r.reason}`).join('; ');
    return report.rejected.length
      ? { error: `Added ${report.accepted}. Rejected ${report.rejected.length}: ${rejected}${report.rejected.length > 8 ? '…' : ''}` }
      : { ok: `Added ${report.accepted} voting ${report.accepted === 1 ? 'entitlement' : 'entitlements'}.` };
  } catch (err) {
    return { error: friendlyError(err) };
  }
}

export async function saveBallot(electionId: string, _: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  try {
    requirePermission(s, 'manage');
    const def = JSON.parse(String(fd.get('definition') ?? '{}')) as BallotDefinition;
    const version = await setBallotDefinition(await db(), s.orgId, s.userId, electionId, def);
    revalidatePath(`/app/elections/${electionId}`);
    return { ok: `Ballot saved as version ${version}.` };
  } catch (err) {
    return { error: friendlyError(err) };
  }
}

/** Deletes an election that is still a draft, with its roll and ballot. Anything past draft is permanent. */
export async function deleteElection(electionId: string): Promise<FormState> {
  const s = await requireSession();
  try {
    requirePermission(s, 'manage');
    await withTenant(await db(), s.orgId, async (tx) => {
      const { rows: [e] } = await tx.query(`SELECT status, title FROM elections WHERE id = $1 FOR UPDATE`, [electionId]);
      if (!e) throw new Error('forbidden: election not found');
      if (e.status !== 'draft') throw new Error('forbidden: only a draft election can be deleted; once approved it is part of the permanent record');
      await tx.query(`DELETE FROM ballot_definitions WHERE election_id = $1`, [electionId]);
      await tx.query(`DELETE FROM voter_eligibility WHERE election_id = $1`, [electionId]);
      await tx.query(`DELETE FROM elections WHERE id = $1`, [electionId]);
      await audit(tx, s.orgId, `user:${s.userId}`, 'election.deleted', `election:${electionId}`, { title: e.title });
    });
  } catch (err) {
    return { error: friendlyError(err) };
  }
  revalidatePath('/app');
  revalidatePath('/app/elections');
  redirect('/app/elections');
}

/** Removes one voter, or the whole roll when no reference is given. Draft only (enforced by the database). */
export async function removeVoters(electionId: string, ref?: string): Promise<FormState> {
  const s = await requireSession();
  let n = 0;
  try {
    requirePermission(s, 'manage');
    n = await withTenant(await db(), s.orgId, async (tx) => {
      const r = ref
        ? await tx.query(`DELETE FROM voter_eligibility WHERE election_id = $1 AND eligibility_ref = $2`, [electionId, ref])
        : await tx.query(`DELETE FROM voter_eligibility WHERE election_id = $1`, [electionId]);
      await audit(tx, s.orgId, `user:${s.userId}`, ref ? 'roll.entry_removed' : 'roll.cleared', `election:${electionId}`,
        ref ? { ref } : { removed: r.rowCount });
      return r.rowCount ?? 0;
    });
  } catch (err) {
    return { error: friendlyError(err) };
  }
  revalidatePath(`/app/elections/${electionId}`);
  return { ok: `Removed ${n}.` };
}

async function step(electionId: string, fn: () => Promise<unknown>): Promise<FormState> {
  try {
    await fn();
  } catch (err) {
    return { error: friendlyError(err) };
  }
  revalidatePath(`/app/elections/${electionId}`);
  revalidatePath('/app');
  return { ok: 'Done.' };
}

export async function submitElection(electionId: string): Promise<FormState> {
  const s = await requireSession();
  return step(electionId, async () => {
    requirePermission(s, 'manage');
    await submitForApproval(await db(), s.orgId, s.userId, electionId);
  });
}

export async function returnToDraft(electionId: string): Promise<FormState> {
  const s = await requireSession();
  return step(electionId, async () => {
    requirePermission(s, 'manage');
    await withTenant(await db(), s.orgId, async (tx) => {
      await tx.query(`UPDATE elections SET status = 'draft', submitted_by = NULL WHERE id = $1 AND status = 'pending_approval'`, [electionId]);
      await audit(tx, s.orgId, `user:${s.userId}`, 'election.returned_to_draft', `election:${electionId}`);
    });
  });
}

/** Returns the tally private key exactly once. It is never stored. */
export async function approve(electionId: string): Promise<FormState & { key?: string }> {
  const s = await requireSession();
  try {
    requirePermission(s, 'approve');
    const { tallyPrivateKeyPem } = await approveElection(await db(), s.orgId, s.userId, electionId);
    // No revalidatePath here: re-rendering would unmount the panel that shows the key.
    // The panel reloads the page once the approver has saved it.
    return { ok: 'Approved.', key: tallyPrivateKeyPem };
  } catch (err) {
    return { error: friendlyError(err) };
  }
}

/** Returns voter links exactly once. Only hashes of the credentials are stored. */
export async function issueInvitations(electionId: string): Promise<FormState & { links?: { ref: string; url: string }[] }> {
  const s = await requireSession();
  try {
    requirePermission(s, 'manage');
    const issued = await issueCredentials(await db(), s.orgId, s.userId, electionId);
    const h = await headers();
    const base = `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('x-forwarded-host') ?? h.get('host')}`;
    // Not revalidated, for the same reason as approve(): the links must stay on screen.
    return {
      ok: issued.length ? `Created ${issued.length} voting links.` : 'Every voter already has a link.',
      links: issued.map((c) => ({ ref: c.eligibilityRef, url: `${base}/vote#${s.orgId}.${electionId}.${c.secret}` })),
    };
  } catch (err) {
    return { error: friendlyError(err) };
  }
}

export async function openVoting(electionId: string): Promise<FormState> {
  const s = await requireSession();
  return step(electionId, async () => {
    requirePermission(s, 'manage');
    await transition(await db(), s.orgId, s.userId, electionId, 'open');
  });
}

export async function closeVoting(electionId: string): Promise<FormState> {
  const s = await requireSession();
  return step(electionId, async () => {
    requirePermission(s, 'manage');
    await transition(await db(), s.orgId, s.userId, electionId, 'closed');
  });
}

export async function count(electionId: string, _: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  try {
    requirePermission(s, 'count');
    let key = String(fd.get('key') ?? '').trim();
    const file = fd.get('keyfile');
    if (!key && file instanceof File && file.size) key = (await file.text()).trim();
    if (!key.includes('PRIVATE KEY')) return { error: 'Provide the tally key file you saved when the election was approved.' };
    await tallyElection(await db(), s.orgId, `user:${s.userId}`, electionId, key);
  } catch (err) {
    return { error: friendlyError(err) };
  }
  revalidatePath(`/app/elections/${electionId}`);
  return { ok: 'Counted and reconciled.' };
}

export async function publish(electionId: string): Promise<FormState> {
  const s = await requireSession();
  return step(electionId, async () => {
    requirePermission(s, 'publish');
    await transition(await db(), s.orgId, s.userId, electionId, 'published');
  });
}
