'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { SiteFooter } from './SiteFooter';
import s from './festive.module.css';
import { applyCarousel, categoryHref, defaultCards, GENERAL_TOPIC, groupOf, PRIVATE_GROUPS, topicAudience, type CarouselSetting } from '@/lib/categories';

type Published = { id: string; topic: string | null; thumbnail: string | null; sizeGroup: string | null; series: string | null };

async function api<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'שגיאה לא צפויה');
  return data as T;
}

/**
 * The screen behind one of the private ring's cards: every kind of card in that group, in the admin's order.
 * A kind with no designs yet is named in one "coming soon" line under the grid, since it has nothing to open.
 */
export function GroupView({ id }: { id: string }) {
  const group = PRIVATE_GROUPS.find((g) => g.id === id)!;
  const [data, setData] = useState<{ templates: Published[]; carousel: CarouselSetting[] } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api<Published[]>('/api/templates'), api<CarouselSetting[]>('/api/carousel').catch(() => [])])
      .then(([templates, carousel]) => setData({ templates, carousel }))
      .catch((e) => setError(e.message));
  }, []);

  const kinds = useMemo(() => {
    if (!data) return [];
    return applyCarousel(defaultCards(data.templates), data.carousel)
      .filter((c) => !c.hidden && topicAudience(c.name, data.carousel) === 'private' && groupOf(c.name).id === id)
      .map((c) => ({
        ...c,
        // as on the category page: an ad in several sizes counts once
        count: data.templates.filter((t) => (t.topic || GENERAL_TOPIC) === c.name && (!t.sizeGroup || t.series)).length,
      }));
  }, [data, id]);

  return (
    <div className={s.root}>
      <section className={`${s.wrap} ${s.catPage}`}>
        <Link className={s.back} href="/">
          → לעמוד הבית
        </Link>
        <div className={`${s.head} ${s.rise}`}>
          <h1 className={s.h2}>{group.name}</h1>
          <p>{group.lead}</p>
        </div>

        {error && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}

        {!data && !error ? (
          <div className={s.designs} aria-busy="true" aria-label="טוען סוגי כרטיסים">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className={s.design}>
                <span className={s.designFace} data-loading="true" style={{ aspectRatio: '5 / 7' }} />
              </div>
            ))}
          </div>
        ) : (
          <>
            <div className={`${s.designs} ${s.rise}`} style={{ animationDelay: '.15s' }}>
              {kinds.filter((k) => k.count > 0).map((k) => (
                <Link key={k.name} href={categoryHref(k.name)} className={s.design}>
                  <span
                    className={s.designFace}
                    style={{ aspectRatio: '5 / 7', ...(k.image ? { backgroundImage: `url("${k.image}")`, backgroundSize: 'cover' } : {}) }}
                    aria-hidden="true"
                  />
                  <span className={s.designName}>{k.name}</span>
                  <span className={s.designHint}>{k.count === 1 ? 'עיצוב אחד' : `${k.count} עיצובים`}</span>
                </Link>
              ))}
            </div>
            {kinds.some((k) => k.count === 0) && (
              <p className={s.soonLine}>
                <strong>בקרוב: </strong>
                {kinds.filter((k) => k.count === 0).map((k) => k.name).join(' · ')}
              </p>
            )}
          </>
        )}
      </section>
      <SiteFooter />
    </div>
  );
}
