'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useMe } from './Auth';
import { ArrowIcon, DownloadIcon, LogoIcon, PenIcon, SearchIcon } from './Icons';

type Published = { id: string; name: string; width_mm: number; height_mm: number; thumbnail: string | null };
type Mine = { id: string; name: string; updatedAt: string; thumbnail: string | null };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'שגיאה לא צפויה');
  return data as T;
}

const STEPS = [
  { n: '01', icon: <SearchIcon />, grad: 'linear-gradient(135deg,#0e7490,#22b8cf)', title: 'בוחרים', text: 'מטיילים בגלריה ובוחרים כרטיס שאהבתם.' },
  { n: '02', icon: <PenIcon />, grad: 'linear-gradient(135deg,#12664a,#2fcf96)', title: 'מתאימים', text: 'משנים שמות, תאריך וצבעים, מחליפים רקע וגוררים את הטקסטים למקום.' },
  { n: '03', icon: <DownloadIcon />, grad: 'linear-gradient(135deg,#d97706,#f5b73b)', title: 'מורידים', text: 'מורידים את הכרטיס כקובץ באיכות הדפסה (300dpi) ומשתפים.' },
];

export function Landing() {
  const { me } = useMe();
  const [templates, setTemplates] = useState<Published[] | null>(null);
  const [mine, setMine] = useState<Mine[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const [t, m] = await Promise.all([api<Published[]>('/api/templates'), me ? api<Mine[]>('/api/projects') : Promise.resolve([])]);
    setTemplates(t);
    setMine(m);
  }, [me]);

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);

  async function remove(it: Mine) {
    if (!confirm(`למחוק את "${it.name}"? אי אפשר לבטל.`)) return;
    try {
      await api(`/api/projects/${it.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <>
      <section className="hero">
        <span className="pill-badge">
          <span className="dot" /> עיצוב בדקות, בלי לדעת עיצוב
        </span>
        <h1>
          לכל שמחה, יש <span className="grad">כרטיס מושלם</span>.
        </h1>
        <p className="lead">בחרו עיצוב, שנו את השמות, התאריך והצבעים, והורידו הזמנה יפה באיכות הדפסה. הכול בדקות.</p>
        <div className="cta">
          <a className="btn primary xl" href="#cards">
            לעיון בכרטיסים <ArrowIcon />
          </a>
          <a className="btn ghost-light xl" href="#how">
            איך זה עובד
          </a>
        </div>
      </section>

      {mine.length > 0 && (
        <section className="mine-section" aria-label="הכרטיסים שלי">
          <div className="inner">
            <span className="eyebrow">ההמשך שלכם</span>
            <h2 className="section-title" style={{ fontSize: 'clamp(28px,4vw,40px)' }}>
              הכרטיסים שלי
            </h2>
            <div className="grid" style={{ marginTop: 24 }}>
              {mine.map((it) => (
                <div key={it.id} className="card" style={{ display: 'grid', gap: 10 }}>
                  <Link href={`/editor/${it.id}`}>
                    <div
                      className="preview"
                      style={it.thumbnail ? { backgroundImage: `url(${it.thumbnail})`, backgroundSize: 'contain' } : undefined}
                      role="img"
                      aria-label={`תצוגה מקדימה של ${it.name}`}
                    />
                  </Link>
                  <strong>{it.name}</strong>
                  <span className="status">עודכן {new Date(it.updatedAt).toLocaleString('he-IL')}</span>
                  <div className="row">
                    <Link className="btn small primary" href={`/editor/${it.id}`}>
                      המשך עריכה
                    </Link>
                    <button className="btn small danger" onClick={() => remove(it)}>
                      מחיקה
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="dark-section" id="cards" style={{ marginTop: mine.length > 0 ? 64 : 0 }}>
        <div className="inner">
          <span className="eyebrow">גלריה</span>
          <h2 className="section-title">
            הכרטיסים <span className="grad">שלנו</span>
          </h2>
          {error && <p className="error" role="alert">{error}</p>}
          {templates === null ? (
            <div className="tiles" aria-busy="true" aria-label="טוען כרטיסים">
              {[0, 1, 2].map((i) => (
                <div key={i} className="tile skeleton" />
              ))}
            </div>
          ) : templates.length === 0 ? (
            <div className="empty" style={{ marginTop: 40 }}>עדיין לא פורסמו כרטיסים. חזרו בקרוב.</div>
          ) : (
            <div className="tiles">
              {templates.map((t) => (
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

      <section className="light-section" id="how">
        <div className="inner">
          <span className="eyebrow">תהליך פשוט</span>
          <h2 className="section-title">
            איך זה <span className="grad">עובד</span>
          </h2>
          <div className="steps">
            {STEPS.map((s) => (
              <div key={s.n} className="step">
                <div className="step-icon" style={{ background: s.grad }}>
                  {s.icon}
                </div>
                <span className="num">שלב {s.n}</span>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="site-footer">
        <p className="brand" style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          <span className="logo-mark" style={{ color: '#fff' }}>
            <LogoIcon />
          </span>
          סטודיו עיצוב
        </p>
        <p style={{ margin: '8px 0 0' }}>לכל שמחה, יש כרטיס מושלם.</p>
      </footer>
    </>
  );
}
