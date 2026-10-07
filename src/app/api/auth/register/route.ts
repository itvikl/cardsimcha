import { NextResponse } from 'next/server';
import { newId, updateDb } from '@/lib/db';
import { createSession, hashPassword, publicUser, setSessionCookie } from '@/lib/auth';
import type { User } from '@/lib/types';

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
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const result = await updateDb((db) => {
    if (db.users.some((u) => u.email === email)) return null;
    // ADMIN_EMAIL decides who is admin; without it the very first account is the admin.
    const role = adminEmail ? (email === adminEmail ? 'admin' : 'user') : db.users.length === 0 ? 'admin' : 'user';
    const user: User = { id: newId(), email, name, role, passwordHash: hash, salt, createdAt: new Date().toISOString() };
    db.users.push(user);
    return user;
  });
  if (!result) return NextResponse.json({ error: 'האימייל כבר רשום' }, { status: 409 });

  const res = NextResponse.json(publicUser(result), { status: 201 });
  setSessionCookie(res, await createSession(result.id));
  return res;
}
