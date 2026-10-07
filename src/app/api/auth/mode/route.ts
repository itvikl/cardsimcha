import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { MODE_COOKIE } from '@/lib/auth';
import { AUTH_DISABLED } from '@/lib/config';

/** Only exists while sign-in is switched off: toggles between customer view and admin view. */
export async function POST(req: Request) {
  if (!AUTH_DISABLED) return NextResponse.json({ error: 'לא זמין' }, { status: 404 });
  const body = await req.json().catch(() => null);
  const mode = body?.mode === 'admin' ? 'admin' : 'user';
  (await cookies()).set(MODE_COOKIE, mode, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 365 * 24 * 60 * 60 });
  return NextResponse.json({ ok: true, mode });
}
