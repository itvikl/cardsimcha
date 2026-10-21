'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useMe } from './Auth';
import { DownloadIcon, LogoIcon, PenIcon, SearchIcon } from './Icons';
import CardCascade from './CardCascade';
import { FallingTitle } from './FallingTitle';
import { IntroEnvelope } from './IntroEnvelope';
import { applyCarousel, categoryHref, defaultCards, type CarouselSetting } from '@/lib/categories';

type Published = { id: string; topic: string | null; thumbnail: string | null };
type Mine = { id: string; name: string; updatedAt: string; thumbnail: string | null };

/** every visit, except for people who asked their system to reduce motion */
function shouldPlayIntro() {
  try {
    return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return true;
  }
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'שגיאה לא צפויה');
  return data as T;
}

const STEPS = [
  { n: '01', icon: <SearchIcon />, grad: 'linear-gradient(135deg,#0e7490,#22b8cf)', title: 'בוחרים', text: 'בוחרים קטגוריה ואת הכרטיס שאהבתם.' },
  { n: '02', icon: <PenIcon />, grad: 'linear-gradient(135deg,#12664a,#2fcf96)', title: 'מתאימים', text: 'משנים שמות, תאריך וצבעים, מחליפים רקע וגוררים את הטקסטים למקום.' },
  { n: '03', icon: <DownloadIcon />, grad: 'linear-gradient(135deg,#d97706,#f5b73b)', title: 'מורידים', text: 'מורידים את הכרטיס כקובץ באיכות הדפסה (300dpi) ומשתפים.' },
];

export function Landing() {
  const { me } = useMe();
  const [templates, setTemplates] = useState<Published[]>([]);
  const [mine, setMine] = useState<Mine[]>([]);
  const [carousel, setCarousel] = useState<CarouselSetting[]>([]);
  const [error, setError] = useState('');
  const [intro, setIntro] = useState(shouldPlayIntro);
  const [titlePlay, setTitlePlay] = useState(() => !intro);

  const load = useCallback(async () => {
    const [t, m, c] = await Promise.all([
      api<Published[]>('/api/templates'),
      me ? api<Mine[]>('/api/projects') : Promise.resolve([]),
      // without the admin's choices the default carousel still works
      api<CarouselSetting[]>('/api/carousel').catch(() => []),
    ]);
    setTemplates(t);
    setMine(m);
    setCarousel(c);
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

  // the admin picks which cards show, their order and their images (see /carousel)
  const categories = useMemo(
    () => applyCarousel(defaultCards(templates), carousel).filter((c) => !c.hidden),
    [templates, carousel]
  );

  return (
    <>
      {intro && <IntroEnvelope onOpen={() => setTitlePlay(true)} onDone={() => setIntro(false)} />}
      <CardCascade
        id="cards"
        eyebrow="הזמנות ועיצובים לכל אירוע"
        title={<FallingTitle lines={['תעצב את', 'האירוע שלך']} play={titlePlay} />}
        description="בחרו קטגוריה, התאימו את הכרטיס בכמה לחיצות והורידו אותו באיכות הדפסה."
        cards={categories.map((c) => ({ name: c.name, background: c.background, href: categoryHref(c.name) }))}
        scrollScreens={Math.max(4, categories.length)}
      />

      {error && (
        <p className="error" role="alert" style={{ margin: 16 }}>
          {error}
        </p>
      )}

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
