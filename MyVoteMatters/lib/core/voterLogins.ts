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

const letters = (v: string) => v.normalize('NFKD').replace(/[^A-Za-z]/g, '');
const cap = (v: string) => v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
/** The company part: drops "(under CIRP)"-style notes and words like Ltd or Pvt before taking the last 4 letters. */
const companyPart = (org: string) => {
  const core = org.replace(/\(.*?\)/g, ' ').replace(/\b(ltd|limited|pvt|private|llp|inc|co|company|corp)\b\.?/gi, ' ');
  return (letters(core) || letters(org) || 'vote').slice(-4).toLowerCase();
};
const namePart = (name: string) => cap((letters(name) || 'Voter').slice(0, 4));
const hour12 = (d: Date) => {
  const h = Number(new Intl.DateTimeFormat('en-IN', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }).format(d)) % 24;
  return h % 12 === 0 ? 12 : h % 12;
};

/** e.g. voter "Gaurav", company "MakeMyEdit", issued at 6 am IST: "Gauredit6". */
export const newLoginId = (name: string, org: string, at = new Date()) => `${namePart(name)}${companyPart(org)}${hour12(at)}`;
/** e.g. "Gaur" + 5 random letters or digits: "Gaur7k2m9". Typed case-insensitively. */
export const newVoterPassword = (name: string) => `${namePart(name)}${pick(PW_CHARS, 5)}`;
/** IDs are stored upper-case and matched without regard to case; shown as "Gauredit6". */
export const displayLoginId = (id: string) => /^MV-/.test(id) ? id : cap(id);

export const normaliseLoginId = (v: string) => v.trim().toUpperCase().replace(/\s+/g, '');

/**
 * The voting credential is derived from login ID and password with scrypt,
 * so neither is stored: only the hash of the derived secret is kept, exactly
 * as for a voting link. The result has the 43-character shape of a link secret.
 */
export async function voterLoginSecret(loginId: string, password: string) {
  return (await scrypt(password.trim().toLowerCase(), `myvotematters-voter:${normaliseLoginId(loginId)}`, 32)).toString('base64url');
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
    const { rows: [org] } = await tx.query(`SELECT name FROM organizations WHERE id = vs.current_org()`);
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
        const base = normaliseLoginId(newLoginId(r.eligibility_ref, org.name));
        for (let n = 0; ; n++) {
          // A clash (same name start, company and hour) gets a letter: GAUREDIT6, GAUREDIT6B, GAUREDIT6C...
          loginId = n === 0 ? base : n < 26 ? base + String.fromCharCode(65 + n) : `${base}${pick(ID_CHARS, 3)}`;
          const ins = await tx.query(
            `INSERT INTO voter_logins (login_id, organization_id, election_id, eligibility_id)
             VALUES ($1, vs.current_org(), $2, $3) ON CONFLICT (login_id) DO NOTHING`, [loginId, electionId, r.id]);
          if (ins.rowCount) break;
        }
      }
      const password = newVoterPassword(r.eligibility_ref);
      await tx.query(
        `INSERT INTO voting_credentials (organization_id, election_id, eligibility_id, credential_hash)
         VALUES (vs.current_org(), $1, $2, $3)`, [electionId, r.id, credentialHash(await voterLoginSecret(loginId, password))]);
      issued.push({ eligibilityRef: r.eligibility_ref, votingUnits: r.voting_units, loginId: displayLoginId(loginId), password });
    }
    await audit(tx, orgId, `user:${actorId}`, eligibilityRef ? 'voter.password_reset' : 'voter_ids.issued',
      `election:${electionId}`, eligibilityRef ? { voter: eligibilityRef } : { count: issued.length });
    return issued;
  });
}

export type VoterLoginCheck =
  | { ok: true; orgId: string; electionId: string; secret: string }
  | { ok: false; reason: 'unknown_id' | 'bad_password' };

/** Checks a voter's login ID and password, saying which of the two is wrong. */
export async function checkVoterLogin(pool: pg.Pool, loginId: string, password: string): Promise<VoterLoginCheck> {
  const id = normaliseLoginId(loginId);
  if (!/^[A-Z0-9-]{3,32}$/.test(id)) return { ok: false, reason: 'unknown_id' };
  const found = await withTenant(pool, null, async (tx) => (await tx.query('SELECT * FROM vs.voter_login_lookup($1)', [id])).rows[0]);
  if (!found) return { ok: false, reason: 'unknown_id' };
  if (!password.trim()) return { ok: false, reason: 'bad_password' };
  const secret = await voterLoginSecret(id, password);
  const ok = await withTenant(pool, found.organization_id, async (tx) => (await tx.query(
    'SELECT election_id FROM vs.credential_context($1)', [credentialHash(secret)])).rows[0]);
  if (!ok || ok.election_id !== found.election_id) return { ok: false, reason: 'bad_password' };
  return { ok: true, orgId: found.organization_id as string, electionId: found.election_id as string, secret };
}

/** Checks a voter's login ID and password. Returns the voting token parts, or null. */
export async function resolveVoterLogin(pool: pg.Pool, loginId: string, password: string) {
  const r = await checkVoterLogin(pool, loginId, password);
  return r.ok ? { orgId: r.orgId, electionId: r.electionId, secret: r.secret } : null;
}
