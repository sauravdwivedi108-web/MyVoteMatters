import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { db } from './pool';
import { withTenant } from './core/db';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
const COOKIE = 'vs_session';
const SESSION_HOURS = 8;

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string | null) {
  if (!stored) {
    await scrypt(password, randomBytes(16), 64); // keep timing similar for unknown users
    return false;
  }
  const [, salt, key] = stored.split('$');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), 64);
  return timingSafeEqual(actual, Buffer.from(key, 'base64'));
}

const tokenHash = (t: string) => createHash('sha256').update(t).digest('hex');

export async function startSession(userId: string, organizationId: string) {
  const token = randomBytes(32).toString('base64url');
  const pool = await db();
  await withTenant(pool, organizationId, (tx) => tx.query(
    `INSERT INTO sessions (token_hash, user_id, organization_id, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(hours => $4))`, [tokenHash(token), userId, organizationId, SESSION_HOURS]));
  (await cookies()).set(COOKIE, token, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: SESSION_HOURS * 3600,
  });
}

export async function endSession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) {
    const pool = await db();
    await withTenant(pool, null, (tx) =>
      tx.query(`UPDATE sessions SET revoked_at = now() WHERE token_hash = $1`, [tokenHash(token)]));
  }
  jar.delete(COOKIE);
}

export type Session = {
  userId: string; email: string; name: string;
  orgId: string; orgName: string; role: Role;
};
export type Role = 'owner' | 'election_admin' | 'approver' | 'scrutinizer' | 'viewer';

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const pool = await db();
  const row = await withTenant(pool, null, async (tx) => {
    const { rows: [s] } = await tx.query(
      `SELECT s.user_id, s.organization_id, u.email_normalized, u.display_name FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`, [tokenHash(token)]);
    if (!s) return null;
    const { rows } = await tx.query(`SELECT * FROM vs.user_memberships($1)`, [s.user_id]);
    const m = rows.find((r) => r.organization_id === s.organization_id);
    return m ? { s, m } : null;
  });
  if (!row) return null;
  return {
    userId: row.s.user_id, email: row.s.email_normalized, name: row.s.display_name ?? row.s.email_normalized,
    orgId: row.m.organization_id, orgName: row.m.organization_name, role: row.m.role,
  };
}

export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) redirect('/login');
  return s;
}

const PERMISSIONS: Record<string, Role[]> = {
  manage: ['owner', 'election_admin'],
  approve: ['owner', 'approver'],
  count: ['owner', 'election_admin', 'scrutinizer'],
  publish: ['owner', 'approver', 'scrutinizer'],
  team: ['owner'],
};
export type Permission = keyof typeof PERMISSIONS;

export const can = (s: Session, p: Permission) => PERMISSIONS[p].includes(s.role);

export function requirePermission(s: Session, p: Permission) {
  if (!can(s, p)) throw new Error(`forbidden: your role (${s.role}) cannot ${p}`);
}
