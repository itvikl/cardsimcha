import type { User } from '../types';
import { newId, stableId } from './ids';
import { C, db, now } from './store';

// Accounts (and guests, once they save something), their personal workspace and their
// sessions. A workspace document lists its members; memberships beyond the owner come with
// the business workspaces.

export type UserDoc = {
  id: string;
  /** null for a guest */
  email: string | null;
  name: string;
  passwordHash: string | null;
  salt: string | null;
  platformRole: 'admin' | 'none';
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceDoc = {
  id: string;
  kind: 'personal' | 'company';
  name: string;
  plan: 'free' | 'personal' | 'business';
  /** userId → role */
  members: Record<string, 'owner' | 'manager' | 'editor' | 'viewer'>;
  memberIds: string[];
  createdAt: string;
  updatedAt: string;
};

type SessionDoc = { tokenHash: string; userId: string; expiresAt: string; createdAt: string };

const toUser = (u: UserDoc): User => ({
  id: u.id,
  email: u.email ?? '',
  name: u.name,
  role: u.platformRole === 'admin' ? 'admin' : 'user',
  passwordHash: u.passwordHash ?? '',
  salt: u.salt ?? '',
  createdAt: u.createdAt,
});

export const personalWorkspaceId = (userId: string) => stableId(`personal-workspace:${userId}`);

export function personalWorkspace(userId: string, name: string): WorkspaceDoc {
  const t = now();
  return {
    id: personalWorkspaceId(userId),
    kind: 'personal',
    name,
    plan: 'free',
    members: { [userId]: 'owner' },
    memberIds: [userId],
    createdAt: t,
    updatedAt: t,
  };
}

export async function findUserByEmail(email: string): Promise<User | null> {
  const [u] = await db.find<UserDoc>(C.users, ['email', '==', email]);
  return u ? toUser(u) : null;
}

/**
 * Registers an account with its personal workspace. ADMIN_EMAIL decides who is admin;
 * without it the very first account is the admin. Null when the email is taken.
 */
export async function createUser(input: { email: string; name: string; passwordHash: string; salt: string }): Promise<User | null> {
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const id = newId();
  return db.tx(async (t) => {
    if ((await t.find<UserDoc>(C.users, ['email', '==', input.email])).length) return null;
    // "first account": checked only without ADMIN_EMAIL, so the usual sign-up does not read every user
    const first = adminEmail ? false : !(await t.find<UserDoc>(C.users)).some((u) => u.email);
    const admin = adminEmail ? input.email === adminEmail : first;
    const at = now();
    const user: UserDoc = { id, ...input, platformRole: admin ? 'admin' : 'none', createdAt: at, updatedAt: at };
    t.set(C.users, id, user);
    t.set(C.workspaces, personalWorkspaceId(id), personalWorkspace(id, input.name));
    return toUser(user);
  });
}

/**
 * The workspace a user's designs are saved in. A guest (no-login mode) has no document until
 * the first save, so the user document is created here too. Safe to call on every save.
 */
export async function ensurePersonalWorkspace(user: User): Promise<string> {
  const workspaceId = personalWorkspaceId(user.id);
  if (await db.get(C.workspaces, workspaceId)) return workspaceId;
  await db.tx(async (t) => {
    const [u, w] = await Promise.all([t.get<UserDoc>(C.users, user.id), t.get<WorkspaceDoc>(C.workspaces, workspaceId)]);
    const at = now();
    if (!u) {
      t.set(C.users, user.id, {
        id: user.id, email: user.email || null, name: user.name, passwordHash: null, salt: null,
        platformRole: 'none', createdAt: at, updatedAt: at,
      } satisfies UserDoc);
    }
    if (!w) t.set(C.workspaces, workspaceId, personalWorkspace(user.id, user.name));
  });
  return workspaceId;
}

// --- sessions (stored hashed; the document id is the hash) ---

export async function createSession(tokenHash: string, userId: string, expiresAt: Date) {
  // expired sessions are cleared now and then, not on every sign-in
  if (Math.random() < 0.05) {
    const old = (await db.find<SessionDoc>(C.sessions)).filter((s) => s.expiresAt < now());
    await Promise.all(old.map((s) => db.delete(C.sessions, s.tokenHash)));
  }
  await db.set(C.sessions, tokenHash, { tokenHash, userId, expiresAt: expiresAt.toISOString(), createdAt: now() } satisfies SessionDoc);
}

export async function deleteSession(tokenHash: string) {
  await db.delete(C.sessions, tokenHash);
}

export async function userBySession(tokenHash: string): Promise<User | null> {
  const s = await db.get<SessionDoc>(C.sessions, tokenHash);
  if (!s || s.expiresAt < now()) return null;
  const u = await db.get<UserDoc>(C.users, s.userId);
  return u && toUser(u);
}
