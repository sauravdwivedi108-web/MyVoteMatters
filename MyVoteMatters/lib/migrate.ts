import type pg from 'pg';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const MIGRATIONS = ['000_roles.sql', '001_core.sql', '002_app.sql', '003_admin.sql', '004_creditor_vote.sql', '005_voter_logins.sql', '006_extend_voting.sql', '007_custom_voter_logins.sql', '008_scheduled_voting.sql', '009_own_vote.sql'];

/**
 * Applies any pending migrations, once, under an advisory lock so concurrent
 * cold starts cannot race. Safe to call on every request; after the first
 * success per process it is a no-op.
 */
export async function migrate(pool: pg.Pool, dir = path.join(process.cwd(), 'db')) {
  const c = await pool.connect();
  // Fast path for every cold start after the first: one query, no lock.
  try {
    const { rows } = await c.query('SELECT name FROM public.vs_migrations');
    const have = new Set(rows.map((r) => r.name));
    if (MIGRATIONS.every((m) => have.has(m))) { c.release(); return; }
  } catch {
    // Table missing on a fresh database; fall through to the locked path.
  }
  try {
    await c.query('SELECT pg_advisory_lock(727274)');
    await c.query('CREATE TABLE IF NOT EXISTS public.vs_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const done = new Set((await c.query('SELECT name FROM public.vs_migrations')).rows.map((r) => r.name));
    for (const name of MIGRATIONS) {
      if (done.has(name)) continue;
      await c.query('BEGIN');
      try {
        await c.query(readFileSync(path.join(dir, name), 'utf8'));
        await c.query('RESET ROLE');
        await c.query('INSERT INTO public.vs_migrations (name) VALUES ($1)', [name]);
        await c.query('COMMIT');
      } catch (err) {
        await c.query('ROLLBACK');
        throw err;
      }
    }
  } finally {
    await c.query('SELECT pg_advisory_unlock(727274)').catch(() => {});
    c.release();
  }
}
