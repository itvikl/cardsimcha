'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';

export type Me = { id: string; email: string; name: string; role: 'admin' | 'user'; authDisabled?: boolean };

type Ctx = { me: Me | null; loading: boolean; refresh: () => Promise<void>; logout: () => Promise<void> };

const AuthContext = createContext<Ctx>({ me: null, loading: true, refresh: async () => {}, logout: async () => {} });

export const useMe = () => useContext(AuthContext);

/** Pages a visitor can open without an account: the gallery, a card's preview, and login itself. */
const isPublic = (path: string) => path === '/' || path === '/login' || path.startsWith('/t/');

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

  // The API enforces access; this only sends signed-out visitors away from private pages.
  useEffect(() => {
    if (!loading && !me && !isPublic(pathname)) {
      router.replace('/login?next=' + encodeURIComponent(pathname));
    }
  }, [loading, me, pathname, router]);

  if (loading) return <p className="status" style={{ padding: 24 }}>טוען…</p>;
  if (!me && !isPublic(pathname)) return null;

  return <AuthContext.Provider value={{ me, loading, refresh, logout }}>{children}</AuthContext.Provider>;
}
