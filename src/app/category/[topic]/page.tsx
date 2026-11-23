'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowIcon } from '@/components/Icons';
import { GENERAL_TOPIC } from '@/lib/categories';

type Published = { id: string; name: string; topic: string | null; width_mm: number; height_mm: number; thumbnail: string | null };

const decode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

export default function CategoryPage({ params }: { params: Promise<{ topic: string }> }) {
  const name = decode(use(params).topic);
  const [items, setItems] = useState<Published[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/templates')
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || 'טעינת הכרטיסים נכשלה');
        setItems((d as Published[]).filter((t) => (t.topic || GENERAL_TOPIC) === name));
      })
      .catch((e) => setError(e.message));
  }, [name]);

  return (
    <section
      className="light-section"
      style={{
        minHeight: 'calc(100svh - var(--header-h))',
        textAlign: 'start',
        background: 'radial-gradient(50% 40% at 90% 0%, #ffe7c4 0%, rgba(255,231,196,0) 70%), radial-gradient(40% 40% at 0% 100%, #d7f2e6 0%, rgba(215,242,230,0) 70%), #fffaf2',
      }}
    >
      <div className="inner">
        <Link className="btn small" href="/" style={{ marginBottom: 20 }}>
          → כל הקטגוריות
        </Link>
        <span className="eyebrow" style={{ display: 'block' }}>
          קטגוריה
        </span>
        <h1 className="section-title">
          <span className="grad">{name}</span>
        </h1>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {items === null && !error ? (
          <div className="tiles" aria-busy="true" aria-label="טוען כרטיסים">
            {[0, 1, 2].map((i) => (
              <div key={i} className="tile skeleton" />
            ))}
          </div>
        ) : items && items.length === 0 ? (
          <div className="empty" style={{ marginTop: 40 }}>
            עדיין אין כרטיסים בקטגוריה הזו. חזרו בקרוב.
          </div>
        ) : (
          <div className="tiles">
            {items?.map((t) => (
              <Link
                key={t.id}
                href={`/t/${t.id}`}
                className="tile"
                style={{ aspectRatio: `${t.width_mm} / ${t.height_mm}`, ...(t.thumbnail ? { backgroundImage: `url(${t.thumbnail})` } : {}) }}
              >
                {!t.thumbnail && <span className="noimg">אין תצוגה מקדימה</span>}
                <span className="tile-cap">
                  <span>
                    <strong>{t.name}</strong>
                    <small>התחלת עריכה</small>
                  </span>
                  <span className="tile-go">
                    <ArrowIcon />
                  </span>
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
