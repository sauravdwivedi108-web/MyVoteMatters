import pg from 'pg';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { migrate } from '../lib/migrate';

const host = process.env.PGHOST ?? '/tmp';
const port = Number(process.env.PGPORT ?? 5432);
const superuser = process.env.PGUSER ?? 'postgres';

export type Harness = {
  db: string; admin: pg.Pool; app: pg.Pool; tally: pg.Pool; owner: pg.Pool; end: () => Promise<void>;
};

/**
 * Creates a fresh database owned by a non-superuser login with CREATEROLE,
 * the same shape as a Neon / Vercel Postgres database, and migrates it
 * through the app's own migration runner.
 */
export async function setup(): Promise<Harness> {
  const db = `vs_test_${randomUUID().slice(0, 8)}`;
  const login = `${db}_login`;
  const root = new pg.Client({ host, port, user: superuser, database: 'postgres' });
  await root.connect();
  await root.query(`CREATE ROLE ${login} LOGIN CREATEROLE`);
  await root.query(`CREATE DATABASE ${db} OWNER ${login}`);
  await root.end();

  const pool = (user: string, options?: string) => {
    const p = new pg.Pool({ host, port, user, database: db, max: 20, options });
    p.on('error', () => {}); // idle clients are terminated when the test database is dropped
    return p;
  };
  const app = pool(login);
  await migrate(app, path.join(import.meta.dirname, '..', 'db'));
  // Running twice must be a no-op.
  await migrate(app, path.join(import.meta.dirname, '..', 'db'));

  const h = { db, admin: pool(superuser), app, tally: app, owner: pool(login, '-c role=vs_owner') };
  return {
    ...h,
    end: async () => {
      await Promise.all([h.admin.end(), h.app.end(), h.owner.end()]);
      const c = new pg.Client({ host, port, user: superuser, database: 'postgres' });
      await c.connect();
      await c.query(`DROP DATABASE ${db} WITH (FORCE)`);
      await c.end();
    },
  };
}

/** Platform onboarding: an organisation with a maker and a checker. */
export async function seedOrg(admin: pg.Pool, slug: string) {
  const { rows: [org] } = await admin.query(`INSERT INTO vs.organizations (name, slug) VALUES ($1, $1) RETURNING id`, [slug]);
  const user = async (email: string, role: string) => {
    const { rows: [u] } = await admin.query(`INSERT INTO vs.users (email_normalized) VALUES ($1) RETURNING id`, [email]);
    await admin.query(`INSERT INTO vs.memberships (organization_id, user_id, role) VALUES ($1, $2, $3)`, [org.id, u.id, role]);
    return u.id as string;
  };
  return {
    orgId: org.id as string,
    maker: await user(`maker@${slug}.test`, 'election_admin'),
    checker: await user(`checker@${slug}.test`, 'approver'),
  };
}
