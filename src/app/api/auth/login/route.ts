import { NextResponse } from 'next/server';
import { readDb } from '@/lib/db';
import { clearFailures, createSession, noteFailure, publicUser, setSessionCookie, throttled, verifyPassword } from '@/lib/auth';

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  const key = `${req.headers.get('x-forwarded-for') ?? 'local'}|${email}`;
  if (throttled(key)) {
    return NextResponse.json({ error: 'יותר מדי ניסיונות. נסו שוב בעוד כרבע שעה' }, { status: 429 });
  }

  const db = await readDb();
  const user = db.users.find((u) => u.email === email);
  // run a hash even for unknown emails so response time does not reveal whether the account exists
  const ok = user ? await verifyPassword(password, user.salt, user.passwordHash) : (await verifyPassword(password, '00', '00'), false);
  if (!user || !ok) {
    noteFailure(key);
    return NextResponse.json({ error: 'אימייל או סיסמה שגויים' }, { status: 401 });
  }
  clearFailures(key);
  const res = NextResponse.json(publicUser(user));
  setSessionCookie(res, await createSession(user.id));
  return res;
}
