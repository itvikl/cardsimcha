'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useMe } from './Auth';
import { LogoIcon } from './Icons';

export function TopBar() {
  const pathname = usePathname();
  const { me, logout, refresh } = useMe();
  const router = useRouter();

  async function switchMode() {
    await fetch('/api/auth/mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: me?.role === 'admin' ? 'user' : 'admin' }),
    });
    await refresh();
    router.push('/');
  }
  const links = [
    { href: '/', label: me?.role === 'admin' ? 'תבניות' : 'הכרטיסים שלי' },
    ...(me?.role === 'admin' ? [{ href: '/categories', label: 'קטגוריות ותמונות' }] : []),
  ];
  return (
    <header className="topbar">
      <Link href="/" className="brand">
        <span className="logo-mark" style={{ color: '#fff' }}>
          <LogoIcon />
        </span>
        <span className="brand-text">סטודיו עיצוב</span>
      </Link>
      {!me && (
        <>
          <span className="spacer" />
          <Link className="btn small primary" href="/login">
            כניסה / הרשמה
          </Link>
        </>
      )}
      {me && (
        <>
          <nav aria-label="ראשי">
            {links.map((l) => {
              const active = l.href === '/' ? pathname === '/' || pathname.startsWith('/editor') : pathname.startsWith(l.href);
              return (
                <Link key={l.href} href={l.href} aria-current={active ? 'page' : undefined}>
                  {l.label}
                </Link>
              );
            })}
          </nav>
          <span className="spacer" />
          <span className="status">{me.authDisabled ? me.name : me.name + (me.role === 'admin' ? ' · מנהל' : '')}</span>
          {me.authDisabled ? (
            <button className="btn small" onClick={switchMode}>
              {me.role === 'admin' ? 'מעבר לתצוגת לקוח' : 'מעבר למצב ניהול'}
            </button>
          ) : (
            <button className="btn small" onClick={logout}>
              התנתקות
            </button>
          )}
        </>
      )}
    </header>
  );
}
