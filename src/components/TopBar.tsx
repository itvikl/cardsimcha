'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useMe } from './Auth';
import { BasketIcon, LogoIcon } from './Icons';
import { useDoor } from './SiteBackdrop';

export function TopBar() {
  const pathname = usePathname();
  const { me, logout, refresh } = useMe();
  const door = useDoor();
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
  const admin = me?.role === 'admin';
  // customers reach their cards only through the basket; admins get their tools instead
  const links = admin
    ? [
        { href: '/', label: 'תבניות' },
        { href: '/categories', label: 'קטגוריות ותמונות' },
        { href: '/carousel', label: 'קרוסלה' },
      ]
    : [];

  // how many cards are in the basket, refreshed on every page change (leaving the editor may add one)
  const [inBasket, setInBasket] = useState(0);
  useEffect(() => {
    if (!me || admin) return;
    let alive = true;
    fetch('/api/projects')
      .then((r) => (r.ok ? r.json() : []))
      .then((list: { kind: string }[]) => alive && setInBasket(list.filter((p) => p.kind === 'design').length))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [me, admin, pathname]);
  return (
    <header className={door === 'business' ? 'topbar business' : 'topbar'}>
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
          {links.length > 0 && (
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
          )}
          <span className="spacer" />
          {!admin && pathname.startsWith('/business') && (
            <Link className="btn small" href="/business/billing">
              התוכנית שלי
            </Link>
          )}
          {!admin && (
            <Link
              href="/my-cards"
              className="basket-link"
              aria-current={pathname === '/my-cards' ? 'page' : undefined}
              aria-label={inBasket ? `הסלסלה שלי, ${inBasket} כרטיסים` : 'הסלסלה שלי'}
              title="הסלסלה שלי"
            >
              <BasketIcon />
              {inBasket > 0 && <span className="basket-count">{inBasket}</span>}
            </Link>
          )}
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
