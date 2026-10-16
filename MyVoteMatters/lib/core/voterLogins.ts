import type pg from 'pg';
import { randomInt, scrypt as scryptCb } from 'node:crypto';
import { promisify } from 'node:util';
import { withTenant, audit } from './db';
import { credentialHash } from './crypto';

const scrypt = promisify(scryptCb) as (pw: string, salt: string, len: number) => Promise<Buffer>;

// No 0/O, 1/I/L: IDs and passwords are read aloud, printed and typed on phones.
const ID_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const PW_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';
const pick = (chars: string, n: number) => Array.from({ length: n }, () => chars[randomInt(chars.length)]).join('');

/** e.g. MV-7K2M-9QPA */
export const newLoginId = () => `MV-${pick(ID_CHARS, 4)}-${pick(ID_CHARS, 4)}`;
/** 10 characters from a 31-letter alphabet (about 49 bits), shown once. */
export const newVoterPassword = () => `${pick(PW_CHARS, 5)}-${pick(PW_CHARS, 5)}`;

export const normaliseLoginId = (v: string) => v.trim().toUpperCase().replace(/\s+/g, '');

/**
 * The voting credential is derived from login ID and password with scrypt,
 * so neither is stored: only the hash of the derived secret is kept, exactly
 * as for a voting link. The result has the 43-character shape of a link secret.
 */
export async function voterLoginSecret(loginId: string, password: string) {
  return (await scrypt(password.trim(), `myvotematters-voter:${normaliseLoginId(loginId)}`, 32)).toString('base64url');
}

export type IssuedLogin = { eligibilityRef: string; votingUnits: string; loginId: string; password: string };

/**
 * Gives a login ID and fresh password to every eligible voter without a live
 * credential, or, with `eligibilityRef`, resets that one voter's password
 * (their login ID stays the same). Allowed once the meeting is locked.
 */
export async function issueVoterLogins(pool: pg.Pool, orgId: string, actorId: string, electionId: string,
                                       eligibilityRef?: string): Promise<IssuedLogin[]> {
  return withTenant(pool, orgId, async (tx) => {
    const { rows: [el] } = await tx.query(`SELECT status FROM elections WHERE id = $1 FOR UPDATE`, [electionId]);
    if (!el || !['approved', 'open'].includes(el.status)) {
      throw new Error('forbidden: voter IDs can be created once the meeting is locked and until voting closes');
    }
    if (eligibilityRef) {
      await tx.query(
        `UPDATE voting_credentials c SET revoked_at = now() FROM voter_eligibility e
          WHERE e.id = c.eligibility_id AND e.election_id = $1 AND e.eligibility_ref = $2 AND c.revoked_at IS NULL`,
        [electionId, eligibilityRef]);
    }
    const { rows } = await tx.query(
      `SELECT e.id, e.eligibility_ref, e.voting_units::text, l.login_id FROM voter_eligibility e
         LEFT JOIN voter_logins l ON l.eligibility_id = e.id
        WHERE e.election_id = $1 AND e.status = 'eligible' AND ($2::text IS NULL OR e.eligibility_ref = $2)
          AND NOT EXISTS (SELECT 1 FROM voting_credentials c WHERE c.eligibility_id = e.id AND c.revoked_at IS NULL)
        ORDER BY e.voting_units DESC, e.eligibility_ref`, [electionId, eligibilityRef ?? null]);
    const issued: IssuedLogin[] = [];
    for (const r of rows) {
      let loginId: string = r.login_id;
      if (!loginId) {
        for (;;) {
          loginId = newLoginId();
          const ins = await tx.query(
            `INSERT INTO voter_logins (login_id, organization_id, election_id, eligibility_id)
             VALUES ($1, vs.current_org(), $2, $3) ON CONFLICT (login_id) DO NOTHING`, [loginId, electionId, r.id]);
          if (ins.rowCount) break;
        }
      }
      const password = newVoterPassword();
      await tx.query(
        `INSERT INTO voting_credentials (organization_id, election_id, eligibility_id, credential_hash)
         VALUES (vs.current_org(), $1, $2, $3)`, [electionId, r.id, credentialHash(await voterLoginSecret(loginId, password))]);
      issued.push({ eligibilityRef: r.eligibility_ref, votingUnits: r.voting_units, loginId, password });
    }
    await audit(tx, orgId, `user:${actorId}`, eligibilityRef ? 'voter.password_reset' : 'voter_ids.issued',
      `election:${electionId}`, eligibilityRef ? { voter: eligibilityRef } : { count: issued.length });
    return issued;
  });
}

/** Checks a voter's login ID and password. Returns the voting token parts, or null. */
export async function resolveVoterLogin(pool: pg.Pool, loginId: string, password: string) {
  const id = normaliseLoginId(loginId);
  if (!/^MV-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(id) || !password.trim()) return null;
  const secret = await voterLoginSecret(id, password);
  const found = await withTenant(pool, null, async (tx) => (await tx.query('SELECT * FROM vs.voter_login_lookup($1)', [id])).rows[0]);
  if (!found) return null;
  const ok = await withTenant(pool, found.organization_id, async (tx) => (await tx.query(
    'SELECT election_id FROM vs.credential_context($1)', [credentialHash(secret)])).rows[0]);
  if (!ok || ok.election_id !== found.election_id) return null;
  return { orgId: found.organization_id as string, electionId: found.election_id as string, secret };
}
