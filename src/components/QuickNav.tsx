'use client';

import { useCallback, useEffect, useRef, useState, type FocusEvent, type MouseEvent, type PointerEvent } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMe } from './Auth';
import s from './festive.module.css';
import { categoryHref, decodeTopic, GENERAL_TOPIC, QUICK_LINKS, type QuickLink } from '@/lib/categories';

/** .quickMenu's width, to keep the list on screen beside a shortcut near the edge */
const MENU_W = 240;
const EDGE = 8;
/** how long the mouse may be between a shortcut and its list before the list closes */
const CLOSE_MS = 160;

const onPrivateSide = (path: string) => path === '/' || path.startsWith('/group/') || path.startsWith('/category/') || path.startsWith('/t/');

/**
 * The shortcuts under the top bar, on the private side's pages: straight to the cards people most often come for.
 * A kind with no designs yet stays in its place, faded, and comes alive once one is published.
 * The list is `fixed` so the strip's sideways scrolling on a phone doesn't cut it off; it closes on any scroll.
 */
export function QuickNav() {
  const path = usePathname();
  const { me } = useMe();
  const shown = onPrivateSide(path) && me?.role !== 'admin';
  const navRef = useRef<HTMLElement>(null);
  const closing = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState<{ name: string; top: number; right: number } | null>(null);
  // the topics that have designs; until they load, nothing is faded
  const [live, setLive] = useState<Set<string> | null>(null);

  useEffect(() => {
    if (!shown || live) return;
    let alive = true;
    fetch('/api/templates')
      .then((r) => (r.ok ? r.json() : null))
      .then((list: { topic: string | null }[] | null) => {
        if (alive && list) setLive(new Set(list.map((t) => t.topic || GENERAL_TOPIC)));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [shown, live]);

  const close = useCallback(() => setOpen(null), []);
  const keepOpen = () => {
    if (closing.current) clearTimeout(closing.current);
    closing.current = null;
  };
  const closeSoon = () => {
    keepOpen();
    closing.current = setTimeout(close, CLOSE_MS);
  };
  useEffect(() => keepOpen, []);

  useEffect(close, [path, close]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: globalThis.PointerEvent) => {
      if (!navRef.current?.contains(e.target as Node)) close();
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('scroll', close, { passive: true, capture: true });
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('scroll', close, { capture: true });
      window.removeEventListener('resize', close);
    };
  }, [open, close]);

  if (!shown) return null;

  const current = path.startsWith('/category/') ? decodeTopic(path.split('/')[2] ?? '') : null;
  const isLive = (topic: string) => !live || live.has(topic);

  function show(name: string, el: HTMLElement) {
    keepOpen();
    const r = el.getBoundingClientRect();
    const right = Math.max(EDGE, Math.min(window.innerWidth - r.right, window.innerWidth - MENU_W - EDGE));
    setOpen({ name, top: (navRef.current?.getBoundingClientRect().bottom ?? r.bottom) + 6, right });
  }

  const single = (l: QuickLink) =>
    isLive(l.topic) ? (
      <Link className={s.quickLink} href={categoryHref(l.topic)} aria-current={l.topic === current ? 'page' : undefined}>
        {l.name}
      </Link>
    ) : (
      <span className={s.quickLink} data-soon="true" title="בקרוב">
        {l.name}
        <span className={s.srOnly}> (בקרוב)</span>
      </span>
    );

  return (
    <nav ref={navRef} className={`${s.root} ${s.quickNav}`} aria-label="קיצורים">
      <ul className={s.quickStrip}>
        {QUICK_LINKS.map((l) => {
          if ('topic' in l) return <li key={l.name} className={s.quickItem}>{single(l)}</li>;
          const isOpen = open?.name === l.name;
          const hover = (e: PointerEvent<HTMLElement>, act: () => void) => {
            if (e.pointerType === 'mouse') act();
          };
          return (
            <li
              key={l.name}
              className={s.quickItem}
              onPointerLeave={(e) => hover(e, closeSoon)}
              onKeyDown={(e) => {
                if (e.key !== 'Escape' || !isOpen) return;
                close();
                e.currentTarget.querySelector('button')?.focus();
              }}
              onBlur={(e: FocusEvent<HTMLLIElement>) => {
                // the keyboard moved on; a click elsewhere has no new focus inside the page's links, and is handled above
                if (isOpen && e.relatedTarget && !e.currentTarget.contains(e.relatedTarget)) close();
              }}
            >
              <button
                type="button"
                className={s.quickLink}
                aria-expanded={isOpen}
                aria-current={l.items.some((i) => i.topic === current) ? 'true' : undefined}
                onPointerEnter={(e) => hover(e, () => show(l.name, e.currentTarget))}
                onClick={(e: MouseEvent<HTMLButtonElement>) => {
                  // the mouse has already opened it by hovering; a tap or the keyboard opens and closes it here
                  if ((e.nativeEvent as globalThis.PointerEvent).pointerType === 'mouse') show(l.name, e.currentTarget);
                  else if (isOpen) close();
                  else show(l.name, e.currentTarget);
                }}
              >
                {l.name}
                <svg className={s.quickChevron} data-open={isOpen} aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
              {isOpen && (
                <ul className={s.quickMenu} style={{ top: open.top, right: open.right }} onPointerEnter={(e) => hover(e, keepOpen)}>
                  {l.items.map((i) => (
                    <li key={i.topic}>
                      {isLive(i.topic) ? (
                        <Link className={s.quickMenuLink} href={categoryHref(i.topic)} aria-current={i.topic === current ? 'page' : undefined} onClick={close}>
                          {i.name}
                        </Link>
                      ) : (
                        <span className={s.quickMenuLink} data-soon="true">
                          {i.name}
                          <small>בקרוב</small>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
