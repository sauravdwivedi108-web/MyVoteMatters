import pg from 'pg';

export type Tx = pg.PoolClient;
export type DbRole = 'vs_app' | 'vs_tally';

/**
 * Runs fn in a transaction as one database role, scoped to one tenant.
 * organizationId must come from the authenticated session or a verified
 * voter credential, never from a client-supplied field. Pass null for
 * pre-tenant work such as sign-in, where row-level security shows nothing.
 */
export async function withTenant<T>(pool: pg.Pool, organizationId: string | null, fn: (tx: Tx) => Promise<T>,
                                    role: DbRole = 'vs_app'): Promise<T> {
  const tx = await pool.connect();
  try {
    // One round trip instead of four: every query waits a full trip to the database.
    await tx.query(`BEGIN; SET LOCAL ROLE ${role === 'vs_tally' ? 'vs_tally' : 'vs_app'}; `
      + `SELECT set_config('app.org_id', ${tx.escapeLiteral(organizationId ?? '')}, true); SET LOCAL search_path = vs, public`);
    const result = await fn(tx);
    await tx.query('COMMIT');
    return result;
  } catch (err) {
    await tx.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    tx.release();
  }
}

export async function audit(tx: Tx, orgId: string, actor: string, action: string, resource: string, detail: object = {}) {
  await tx.query('SELECT vs.audit($1, $2, $3, $4, $5)', [orgId, actor, action, resource, JSON.stringify(detail)]);
}
