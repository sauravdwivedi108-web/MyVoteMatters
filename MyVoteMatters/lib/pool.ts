import pg from 'pg';
import { migrate } from './migrate';

/**
 * Vercel's Neon integration sets DATABASE_URL (and POSTGRES_URL). If a custom
 * prefix was chosen when connecting, the names change (e.g. STORAGE_URL), so
 * fall back to any variable holding a postgres:// address.
 */
function findConnectionString(): string | undefined {
  const env = process.env;
  const direct = env.DATABASE_URL ?? env.POSTGRES_URL;
  if (direct) return direct;
  const isPg = (v?: string) => !!v && /^postgres(ql)?:\/\//.test(v);
  const keys = Object.keys(env).filter((k) => isPg(env[k]));
  const pick = keys.find((k) => /_DATABASE_URL$|_POSTGRES_URL$/.test(k))
    ?? keys.find((k) => /_URL$/.test(k) && !/UNPOOLED|NON_POOLING|NO_SSL/.test(k))
    ?? keys[0];
  if (pick) return env[pick];
  // Some integrations only set the libpq-style variables.
  if (env.PGHOST && env.PGUSER && env.PGPASSWORD) {
    const u = new URL('postgres://placeholder');
    u.hostname = env.PGHOST; u.username = env.PGUSER; u.password = env.PGPASSWORD;
    u.pathname = `/${env.PGDATABASE ?? 'postgres'}`; u.searchParams.set('sslmode', 'require');
    return u.toString();
  }
  return undefined;
}

/** Names (never values) of environment variables that look database-related, for the setup screen. */
export function databaseEnvNames(): string[] {
  return Object.keys(process.env).filter((k) => /DATABASE|POSTGRES|NEON|^PG/.test(k)).sort();
}

const connectionString = findConnectionString();

const globalForPool = globalThis as unknown as { vsPool?: pg.Pool; vsReady?: Promise<void> };

export function hasDatabase() {
  return Boolean(connectionString);
}

/** One small pool per server instance, migrated before first use. */
export async function db(): Promise<pg.Pool> {
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  if (!globalForPool.vsPool) {
    // TLS settings come from the connection string (Neon includes sslmode=require).
    globalForPool.vsPool = new pg.Pool({ connectionString, max: 5 });
  }
  if (!globalForPool.vsReady) {
    globalForPool.vsReady = migrate(globalForPool.vsPool).catch((err) => {
      globalForPool.vsReady = undefined;
      throw err;
    });
  }
  await globalForPool.vsReady;
  return globalForPool.vsPool;
}
