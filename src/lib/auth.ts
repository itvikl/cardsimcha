import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { deleteRow, getRow, setRow } from './db';
import { firestore } from './firebase';
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
  const now = Date.now();
  await setRow('sessions', { tokenHash: sha(token), userId, expiresAt: now + SESSION_MS });
  await pruneSessions(now).catch((e) => console.error('could not prune sessions', e));
  return token;
}

/** Drops a batch of expired sessions; runs on every sign-in, so they never pile up. */
async function pruneSessions(now: number) {
  const fs = firestore();
  const old = await fs.collection('sessions').where('expiresAt', '<', now).limit(100).get();
  if (old.empty) return;
  const batch = fs.batch();
  old.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
}

export async function destroySession(token: string) {
  await deleteRow('sessions', sha(token));
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

export const publicUser = (u: User) => ({ id: u.id, email: u.email, name: u.name, role: u.role, ...(u.guest ? { guest: true } : {}) });

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
  const s = await getRow('sessions', sha(token));
  if (!s || s.expiresAt < Date.now()) return null;
  return getRow('users', s.userId);
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

export function throttled(key: string, max = MAX): boolean {
  const a = attempts.get(key);
  return !!a && Date.now() - a.first <= WINDOW && a.n >= max;
}
export function noteFailure(key: string) {
  const a = attempts.get(key);
  if (!a || Date.now() - a.first > WINDOW) attempts.set(key, { n: 1, first: Date.now() });
  else a.n++;
}
export function clearFailures(key: string) {
  attempts.delete(key);
}
