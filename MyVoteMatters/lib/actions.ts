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

export type FormState = { error?: string; ok?: string } | undefined;

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

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
  if (!emailOk(email)) return { error: 'Enter a valid email address.' };
  if (password.length < 10) return { error: 'Use a password of at least 10 characters.' };

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
  if (!found) return { error: 'That email and password do not match an account.' };
  await startSession(found.userId, found.orgId);
  redirect('/app');
}

export async function logout() {
  await endSession();
  redirect('/');
}

export async function addMember(_: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  try {
    requirePermission(s, 'team');
    const email = str(fd, 'email').toLowerCase();
    const name = str(fd, 'name');
    const role = str(fd, 'role');
    const password = String(fd.get('password') ?? '');
    if (!emailOk(email) || !name) return { error: 'Enter a name and a valid email address.' };
    if (!['election_admin', 'approver', 'scrutinizer', 'viewer', 'owner'].includes(role)) return { error: 'Choose a role.' };
    if (password.length < 10) return { error: 'Set a temporary password of at least 10 characters.' };
    const hash = await hashPassword(password);
    await withTenant(await db(), s.orgId, async (tx) => {
      let { rows: [u] } = await tx.query(`SELECT id FROM users WHERE email_normalized = $1`, [email]);
      if (!u) {
        ({ rows: [u] } = await tx.query(
          `INSERT INTO users (email_normalized, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id`, [email, name, hash]));
      }
      await tx.query(`INSERT INTO memberships (organization_id, user_id, role) VALUES (vs.current_org(), $1, $2)`, [u.id, role]);
      await audit(tx, s.orgId, `user:${s.userId}`, 'member.added', `user:${u.id}`, { role });
    });
  } catch (err) {
    return { error: friendlyError(err) };
  }
  revalidatePath('/app/team');
  return { ok: 'Member added. Share the temporary password with them directly.' };
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
    const kind = str(fd, 'kind') as 'agm_resolutions' | 'board_election' | 'internal_poll';
    const startsAt = istDate(str(fd, 'starts_at'));
    const endsAt = istDate(str(fd, 'ends_at'));
    if (!title) return { error: 'Give the election a title.' };
    if (!['agm_resolutions', 'board_election', 'internal_poll'].includes(kind)) return { error: 'Choose an election type.' };
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
    const header = lines[0] && /ref|folio|member|id/i.test(lines[0]) && !/\d+\s*$/.test(lines[0]);
    if (header) lines.shift();
    if (!lines.length) return { error: 'Paste at least one row: reference, voting units.' };
    const rows = lines.map((l) => {
      const [ref, units] = l.split(/[,\t;]/).map((x) => x.trim());
      return { eligibilityRef: ref, votingUnits: units ?? '' };
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
