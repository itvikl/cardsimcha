'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';

export type Me = { id: string; email: string; name: string; role: 'admin' | 'user'; authDisabled?: boolean; guest?: boolean };

type Ctx = { me: Me | null; loading: boolean; refresh: () => Promise<void>; logout: () => Promise<void>; ensureSession: () => Promise<void> };

const AuthContext = createContext<Ctx>({ me: null, loading: true, refresh: async () => {}, logout: async () => {}, ensureSession: async () => {} });

export const useMe = () => useContext(AuthContext);

/** Pages a visitor can open without an account: the gallery, its categories, a card's preview, and login itself. */
const isPublic = (path: string) => path === '/' || path === '/business' || path === '/login' || path === '/accessibility' || path.startsWith('/t/') || path.startsWith('/group/') || path.startsWith('/category/') || path.startsWith('/business/category/');

/** Only follow same-site paths when returning after login. */
export const safeNext = (next: string | null | undefined) =>
  next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/login') ? next : '/';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  const refresh = useCallback(async () => {
    const res = await fetch('/api/auth/me', { cache: 'no-store' });
    setMe(res.ok ? await res.json() : null);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh().catch(() => setLoading(false));
  }, [refresh]);

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setMe(null);
    router.replace('/');
  }, [router]);

  /** No sign-up to get in: a visitor who starts working becomes a guest, and can register whenever they like. */
  const ensureSession = useCallback(async () => {
    if (me) return;
    const res = await fetch('/api/auth/guest', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'לא הצלחנו להיכנס. נסו שוב.');
    setMe(data);
  }, [me]);

  // The API enforces access; a visitor opening a page of their own just starts as a guest.
  useEffect(() => {
    if (!loading && !me && !isPublic(pathname)) {
      ensureSession().catch(() => router.replace('/login?next=' + encodeURIComponent(pathname)));
    }
  }, [loading, me, pathname, router, ensureSession]);

  if (loading) return <p className="status" style={{ padding: 24 }}>טוען…</p>;
  if (!me && !isPublic(pathname)) return null;

  return <AuthContext.Provider value={{ me, loading, refresh, logout, ensureSession }}>{children}</AuthContext.Provider>;
}
