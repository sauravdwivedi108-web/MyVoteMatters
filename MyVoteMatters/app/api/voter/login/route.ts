import { NextResponse } from 'next/server';
import { db } from '@/lib/pool';
import { checkVoterLogin, normaliseLoginId } from '@/lib/core/voterLogins';
import { throttle, clientKey } from '@/lib/voter';

export const dynamic = 'force-dynamic';

/** Exchanges a voter's login ID and password for the voting token the ballot page uses. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const loginId = typeof body.loginId === 'string' ? body.loginId : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!throttle(`voter-login:${clientKey(req)}`, 10) || !throttle(`voter-login-id:${normaliseLoginId(loginId)}`, 8)) {
    return NextResponse.json({ error: 'Too many attempts. Wait a minute and try again.' }, { status: 429 });
  }
  try {
    const r = await checkVoterLogin(await db(), loginId, password);
    if (!r.ok) {
      console.warn('voter login refused', r.reason, normaliseLoginId(loginId));
      return NextResponse.json({ error: r.reason === 'unknown_id'
        ? `No voter ID "${loginId.trim()}" was found. Check the ID on your slip: it looks like Gauredit6 (letters, then a number). Admins log in on the Admin login page.`
        : 'The voter ID is right but the password does not match. Check the password on your slip, or ask the administrator to reset it.' }, { status: 401 });
    }
    return NextResponse.json({ token: `${r.orgId}.${r.electionId}.${r.secret}` }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('voter login failed', (err as Error).message);
    return NextResponse.json({ error: 'Sign-in is unavailable right now. Please try again.' }, { status: 500 });
  }
}
