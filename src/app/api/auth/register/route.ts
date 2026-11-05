import { NextResponse } from 'next/server';
import { createSession, hashPassword, publicUser, setSessionCookie } from '@/lib/auth';
import { createUser } from '@/lib/data/users';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 80) : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!EMAIL.test(email) || email.length > 120) return NextResponse.json({ error: 'אימייל לא תקין' }, { status: 400 });
  if (!name) return NextResponse.json({ error: 'שם חובה' }, { status: 400 });
  if (password.length < 8 || password.length > 200) {
    return NextResponse.json({ error: 'הסיסמה חייבת להכיל לפחות 8 תווים' }, { status: 400 });
  }

  const { salt, hash } = await hashPassword(password);
  // ADMIN_EMAIL decides who is admin; without it the very first account is the admin
  const result = await createUser({ email, name, passwordHash: hash, salt });
  if (!result) return NextResponse.json({ error: 'האימייל כבר רשום' }, { status: 409 });

  const res = NextResponse.json(publicUser(result), { status: 201 });
  setSessionCookie(res, await createSession(result.id));
  return res;
}
