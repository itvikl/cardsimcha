import type { Project, User } from './types';

/** Admins manage templates; everyone manages their own designs. */
export const canWrite = (u: User, p: Project) => (p.kind === 'template' ? u.role === 'admin' : p.ownerId === u.id);
export const canRead = (u: User, p: Project) =>
  canWrite(u, p) || (p.kind === 'template' && p.status === 'published') || u.role === 'admin';
