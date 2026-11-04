'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import styles from './AdHistory.module.css';

type Summary = {
  id: string;
  kind: string;
  name: string;
  topic: string | null;
  audience: string;
  thumbnail: string | null;
  updatedAt: string;
  width_mm: number;
  height_mm: number;
};

/** A horizontal strip of the business's recent ads, shown on the business home page. */
export function AdHistory() {
  const [ads, setAds] = useState<Summary[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch('/api/projects')
      .then((r) => (r.ok ? r.json() : []))
      .then((all: Summary[]) => {
        const mine = all
          .filter((p) => p.kind === 'design' && p.audience === 'business')
          .slice(0, 12);
        setAds(mine);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  if (!loaded || ads.length === 0) return null;

  return (
    <section className={styles.root}>
      <div className={styles.head}>
        <h2 className={styles.title}>העיצובים שלכם</h2>
        <span className={styles.count}>{ads.length} עיצובים</span>
      </div>
      <div className={styles.strip} role="list">
        {ads.map((ad) => (
          <Link key={ad.id} href={`/editor/${ad.id}`} className={styles.card} role="listitem" title={ad.name || ad.topic || 'עיצוב'}>
            <div className={styles.thumb} style={{ aspectRatio: `${ad.width_mm}/${ad.height_mm}` }}>
              {ad.thumbnail ? (
                <img src={ad.thumbnail} alt={ad.name || 'תמונה מקדימה'} className={styles.img} />
              ) : (
                <div className={styles.placeholder} aria-hidden="true" />
              )}
            </div>
            <p className={styles.name}>{ad.name || ad.topic || 'עיצוב'}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
