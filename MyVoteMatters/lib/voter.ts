import 'server-only';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Voter links carry org.election.secret in the URL fragment, which browsers never send to servers or logs. */
export function parseVoterToken(token: unknown) {
  if (typeof token !== 'string' || token.length > 200) return null;
  const [orgId, electionId, secret, ...rest] = token.split('.');
  if (rest.length || !UUID.test(orgId ?? '') || !UUID.test(electionId ?? '') || !/^[A-Za-z0-9_-]{43}$/.test(secret ?? '')) return null;
  return { orgId, electionId, secret };
}

// Best-effort per-instance throttle. Production should use a shared store (Redis / Vercel KV).
const hits = new Map<string, { n: number; reset: number }>();
export function throttle(key: string, limit = 30, windowMs = 60_000) {
  const now = Date.now();
  const h = hits.get(key);
  if (!h || h.reset < now) {
    hits.set(key, { n: 1, reset: now + windowMs });
    return true;
  }
  h.n++;
  return h.n <= limit;
}

export const clientKey = (req: Request) =>
  (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';

/** A short, human label for the voter's device, e.g. "Android phone · Chrome". */
export function deviceLabel(ua: string | null) {
  if (!ua) return 'unknown device';
  const os = /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Android/.test(ua) ? (/Mobile/.test(ua) ? 'Android phone' : 'Android tablet')
    : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'other';
  const browser = /Edg\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /CriOS|Chrome\//.test(ua) ? 'Chrome'
    : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'other browser';
  return `${os} · ${browser}`;
}
