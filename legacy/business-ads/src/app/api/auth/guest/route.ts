import { NextResponse } from 'next/server';
import { createSession, getUser, noteFailure, publicUser, setSessionCookie, throttled } from '@/lib/auth';
import { newId, setRow } from '@/lib/db';
import type { User } from '@/lib/types';

/** a family or an office can share an address, so this is looser than the sign-in limit */
const MAX_PER_ADDRESS = 40;

/**
 * Starts working without an account: a guest user behind an ordinary session, so everything else treats them like any
 * customer. Made only when a visitor first needs one, so just browsing the site creates nothing.
 */
export async function POST(req: Request) {
  const current = await getUser();
  if (current) return NextResponse.json(publicUser(current));
  const key = `guest|${req.headers.get('x-forwarded-for') ?? 'local'}`;
  if (throttled(key, MAX_PER_ADDRESS)) return NextResponse.json({ error: 'יותר מדי כניסות מהכתובת הזו. נסו שוב בעוד כרבע שעה' }, { status: 429 });
  noteFailure(key);
  const user: User = { id: newId(), email: '', name: 'אורח', role: 'user', passwordHash: '', salt: '', createdAt: new Date().toISOString(), guest: true };
  await setRow('users', user);
  const res = NextResponse.json(publicUser(user), { status: 201 });
  setSessionCookie(res, await createSession(user.id));
  return res;
}
