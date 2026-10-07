import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { readDb, updateDb } from './db';
import { AUTH_DISABLED } from './config';
import type { User } from './types';

export const COOKIE = 'sid';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

function scryptAsync(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, 64, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  return { salt, hash: (await scryptAsync(password, salt)).toString('hex') };
}

export async function verifyPassword(password: string, salt: string, hash: string) {
  const a = await scryptAsync(password, salt);
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Sessions are stored hashed, so a leaked db.json does not leak usable cookies. */
export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString('hex');
  await updateDb((db) => {
    const now = Date.now();
    db.sessions = db.sessions.filter((s) => s.expiresAt > now);
    db.sessions.push({ tokenHash: sha(token), userId, expiresAt: now + SESSION_MS });
  });
  return token;
}

export async function destroySession(token: string) {
  await updateDb((db) => {
    db.sessions = db.sessions.filter((s) => s.tokenHash !== sha(token));
  });
}

export function setSessionCookie(res: NextResponse, token: string) {
  res.cookies.set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MS / 1000,
  });
}

export const publicUser = (u: User) => ({ id: u.id, email: u.email, name: u.name, role: u.role });

export const GUEST_COOKIE = 'guest';
export const MODE_COOKIE = 'mode';

/** No-login mode: a per-browser anonymous id, and admin rights only while mode=admin. */
async function guestUser(): Promise<User> {
  const jar = await cookies();
  let id = jar.get(GUEST_COOKIE)?.value;
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) {
    id = crypto.randomUUID();
    jar.set(GUEST_COOKIE, id, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 365 * 24 * 60 * 60 });
  }
  const admin = jar.get(MODE_COOKIE)?.value === 'admin';
  return {
    id,
    email: '',
    name: admin ? 'מצב ניהול' : 'אורח',
    role: admin ? 'admin' : 'user',
    passwordHash: '',
    salt: '',
    createdAt: '',
  };
}

export async function getUser(): Promise<User | null> {
  if (AUTH_DISABLED) return guestUser();
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const db = await readDb();
  const s = db.sessions.find((x) => x.tokenHash === sha(token));
  if (!s || s.expiresAt < Date.now()) return null;
  return db.users.find((u) => u.id === s.userId) ?? null;
}

const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

/** Usage: `const u = await requireUser(); if (u instanceof Response) return u;` */
export async function requireUser(): Promise<User | Response> {
  return (await getUser()) ?? fail('יש להתחבר', 401);
}

export async function requireAdmin(): Promise<User | Response> {
  const u = await getUser();
  if (!u) return fail('יש להתחבר', 401);
  if (u.role !== 'admin') return fail('אין הרשאה', 403);
  return u;
}

// Naive in-memory throttle for login attempts (per server process).
const attempts = new Map<string, { n: number; first: number }>();
const WINDOW = 15 * 60 * 1000;
const MAX = 8;

export function throttled(key: string): boolean {
  const a = attempts.get(key);
  return !!a && Date.now() - a.first <= WINDOW && a.n >= MAX;
}
export function noteFailure(key: string) {
  const a = attempts.get(key);
  if (!a || Date.now() - a.first > WINDOW) attempts.set(key, { n: 1, first: Date.now() });
  else a.n++;
}
export function clearFailures(key: string) {
  attempts.delete(key);
}
