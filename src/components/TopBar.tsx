'use client';

import { useEffect, useRef } from 'react';
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
  // the admin's links in the order of the work: the tree, the pictures, then the templates built from them
  const admin = me?.role === 'admin';
  const links = admin
    ? [
        { href: '/tree', label: 'עץ הקטגוריות' },
        { href: '/categories', label: 'ספריית תמונות' },
        { href: '/', label: 'תבניות' },
        { href: '/fonts', label: 'פונטים' },
        { href: '/carousel', label: 'קרוסלה' },
      ]
    : [{ href: '/', label: 'הכרטיסים שלי' }];

  // on a narrow screen the links scroll inside the bar: keep the current one in sight
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = navRef.current;
    const link = nav?.querySelector('[aria-current="page"]');
    if (!nav || !link) return;
    const box = nav.getBoundingClientRect();
    const at = link.getBoundingClientRect();
    if (at.left < box.left) nav.scrollLeft += at.left - box.left - 8;
    else if (at.right > box.right) nav.scrollLeft += at.right - box.right + 8;
  }, [pathname, admin]);

  return (
    <header className={'topbar' + (pathname.startsWith('/business') ? ' business' : '') + (admin ? ' admin' : '')}>
      <Link href="/" className="brand">
        <span className="logo-mark">
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
          <nav aria-label="ראשי" ref={navRef}>
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
