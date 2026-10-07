import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { COOKIE, destroySession } from '@/lib/auth';

export async function POST() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (token) await destroySession(token);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, '', { path: '/', maxAge: 0 });
  return res;
}
