'use client';

import { useEffect, useState, type MouseEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMe } from './Auth';
import { flyCard, landCard } from './CardFlight';
import { SiteFooter } from './SiteFooter';
import s from './festive.module.css';
import { GENERAL_TOPIC, type Audience } from '@/lib/categories';

type Published = { id: string; name: string; topic: string | null; width_mm: number; height_mm: number; thumbnail: string | null };

/**
 * A category's page, reached from the home page's ring: all its designs as printed cards.
 * Opening one creates the customer's copy and flies the card into the editor (CardFlight);
 * a visitor who is not signed in gets the design's page first, which asks them to sign up.
 */
export function CategoryView({ topic, audience }: { topic: string; audience: Audience }) {
  const { me } = useMe();
  const router = useRouter();
  const [items, setItems] = useState<Published[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const home = audience === 'business' ? '/business' : '/';

  useEffect(() => {
    fetch('/api/templates')
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || 'טעינת העיצובים נכשלה');
        setItems((d as Published[]).filter((t) => (t.topic || GENERAL_TOPIC) === topic));
      })
      .catch((e) => setError(e.message));
  }, [topic]);

  async function open(t: Published, e: MouseEvent<HTMLButtonElement>) {
    if (!me) {
      router.push(`/t/${t.id}`);
      return;
    }
    setBusy(true);
    setError('');
    // the card lifts off the page right away and lands on the editor's canvas once it is ready
    const face = e.currentTarget.firstElementChild as HTMLElement | null;
    if (face) flyCard(face.getBoundingClientRect(), t.thumbnail);
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: t.id }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'לא הצלחנו לפתוח את העיצוב');
      router.push(`/editor/${d.id}`);
    } catch (err) {
      landCard(null);
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className={audience === 'business' ? `${s.root} ${s.business}` : s.root}>
      <section className={`${s.wrap} ${s.catPage}`}>
        <Link className={s.back} href={home}>
          → כל הקטגוריות
        </Link>
        <div className={`${s.head} ${s.rise}`}>
          <span className={s.eyebrow}>קטגוריה</span>
          <h1 className={s.h2}>{topic}</h1>
          {items && items.length > 0 && <p>{items.length === 1 ? 'עיצוב אחד' : `${items.length} עיצובים`}. בחרו אחד, והוא נפתח בעורך.</p>}
        </div>

        {error && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}

        {items === null && !error ? (
          <div className={s.designs} aria-busy="true" aria-label="טוען עיצובים">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className={s.design}>
                <span className={s.designFace} data-loading="true" style={{ aspectRatio: '210 / 297' }} />
              </div>
            ))}
          </div>
        ) : items && items.length === 0 ? (
          <div className={s.emptyState}>
            <strong>עוד אין כאן עיצובים</strong>
            <span>אנחנו מכינים עיצובים חדשים לקטגוריה הזו. בינתיים אפשר להציץ בקטגוריות האחרות.</span>
            <Link className={`${s.btn} ${s.dark}`} href={home}>
              לכל הקטגוריות
            </Link>
          </div>
        ) : (
          <div className={`${s.designs} ${s.rise}`} style={{ animationDelay: '.15s' }}>
            {items?.map((t) => (
              <button key={t.id} type="button" className={s.design} onClick={(e) => open(t, e)} disabled={busy}>
                <span
                  className={s.designFace}
                  style={{ aspectRatio: `${t.width_mm} / ${t.height_mm}`, ...(t.thumbnail ? { backgroundImage: `url("${t.thumbnail}")` } : {}) }}
                  aria-hidden="true"
                />
                <span className={s.designName}>{t.name}</span>
                <span className={s.designHint}>לפתיחה בעורך</span>
              </button>
            ))}
          </div>
        )}
      </section>
      <SiteFooter />
    </div>
  );
}
