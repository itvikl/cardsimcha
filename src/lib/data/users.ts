import type { User as UserRow } from '@/generated/prisma/client';
import type { User } from '../types';
import { prisma } from './prisma';
import { isUniqueViolation, newId, stableId } from './ids';

const toUser = (u: UserRow): User => ({
  id: u.id,
  email: u.email ?? '',
  name: u.name,
  role: u.platformRole === 'admin' ? 'admin' : 'user',
  passwordHash: u.passwordHash ?? '',
  salt: u.salt ?? '',
  createdAt: u.createdAt.toISOString(),
});

export const personalWorkspaceId = (userId: string) => stableId(`personal-workspace:${userId}`);

export async function findUserByEmail(email: string): Promise<User | null> {
  const u = await prisma.user.findUnique({ where: { email } });
  return u && toUser(u);
}

/**
 * Registers an account with its personal workspace. ADMIN_EMAIL decides who is admin;
 * without it the very first account is the admin. Null when the email is taken.
 */
export async function createUser(input: { email: string; name: string; passwordHash: string; salt: string }): Promise<User | null> {
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const id = newId();
  try {
    const u = await prisma.$transaction(async (tx) => {
      const first = (await tx.user.count({ where: { email: { not: null } } })) === 0;
      const admin = adminEmail ? input.email === adminEmail : first;
      const user = await tx.user.create({
        data: { id, ...input, platformRole: admin ? 'admin' : 'none' },
      });
      await tx.workspace.create({
        data: { id: personalWorkspaceId(id), kind: 'personal', name: input.name, memberships: { create: { userId: id, role: 'owner' } } },
      });
      return user;
    });
    return toUser(u);
  } catch (e) {
    if (isUniqueViolation(e)) return null;
    throw e;
  }
}

/**
 * The workspace a user's designs are saved in. A guest (no-login mode) has no row until
 * the first save, so the user row is created here too. Safe to call on every save.
 */
export async function ensurePersonalWorkspace(user: User): Promise<string> {
  const workspaceId = personalWorkspaceId(user.id);
  const existing = await prisma.membership.findUnique({ where: { workspaceId_userId: { workspaceId, userId: user.id } } });
  if (existing) return workspaceId;
  await prisma.$transaction(async (tx) => {
    await tx.user.upsert({ where: { id: user.id }, update: {}, create: { id: user.id, email: user.email || null, name: user.name } });
    await tx.workspace.upsert({ where: { id: workspaceId }, update: {}, create: { id: workspaceId, kind: 'personal', name: user.name } });
    await tx.membership.upsert({
      where: { workspaceId_userId: { workspaceId, userId: user.id } },
      update: {},
      create: { workspaceId, userId: user.id, role: 'owner' },
    });
  });
  return workspaceId;
}

// --- sessions (stored hashed) ---

export async function createSession(tokenHash: string, userId: string, expiresAt: Date) {
  await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await prisma.session.create({ data: { tokenHash, userId, expiresAt } });
}

export async function deleteSession(tokenHash: string) {
  await prisma.session.deleteMany({ where: { tokenHash } });
}

export async function userBySession(tokenHash: string): Promise<User | null> {
  const s = await prisma.session.findUnique({ where: { tokenHash }, include: { user: true } });
  if (!s || s.expiresAt < new Date()) return null;
  return toUser(s.user);
}
