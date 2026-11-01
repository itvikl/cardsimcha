'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { MirrorRing, type RingItem } from './MirrorRing';
import { SiteFooter } from './SiteFooter';
import { setMood } from './SiteBackdrop';
import s from './festive.module.css';
import { moodOf } from '@/lib/story';
import { applyCarousel, categoryHref, defaultCards, GENERAL_TOPIC, topicAudience, type Audience, type CarouselSetting } from '@/lib/categories';

type Published = { id: string; name: string; topic: string | null; thumbnail: string | null };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'שגיאה לא צפויה');
  return data as T;
}

const DOORS: { audience: Audience; href: string; label: string }[] = [
  { audience: 'private', href: '/', label: 'לשמחה' },
  { audience: 'business', href: '/business', label: 'לעסק' },
];

/** under the ring: how many designs the front category has */
const countNote = (n: number) => (n === 0 ? 'עיצובים חדשים בקרוב' : n === 1 ? 'עיצוב אחד' : `${n} עיצובים`);

/** everything on the page that differs between the two doors */
const COPY = {
  private: {
    eyebrow: 'הזמנות · תעודות · מודעות לבית הכנסת',
    title: ['תעצב את', 'האירוע', 'שלך'],
    lead: 'סובבו את הטבעת, בחרו שמחה, וכל העיצובים שלה מחכים לכם.',
    ticker: ['מזל טוב', 'בשעה טובה', 'ברוכים הבאים', 'שנזכה לשמחות', 'לחיים'],
    step1: 'מסובבים את הטבעת, בוחרים שמחה ועיצוב שמדבר אליכם.',
    step2: 'שמות, תאריך, צבע ורקע, או פשוט מבקשים מהעוזר.',
    cta: 'הכרטיס שלכם כבר על השולחן.',
  },
  business: {
    eyebrow: 'מודעות · לוגו · כרטיסי ביקור · פוסטים',
    title: ['תעצב את', 'העסק', 'שלך'],
    lead: 'מודעה, לוגו או פוסט לעסק, בלי גרפיקאי. בחרו מה העסק צריך, וכל העיצובים מחכים לכם.',
    ticker: ['פתיחה חגיגית', 'מבצע השבוע', 'חדש בשכונה', 'פתוחים גם בערב', 'משלוחים עד הבית'],
    step1: 'מסובבים את הטבעת ובוחרים מודעה, לוגו או פוסט.',
    step2: 'שם העסק, טלפון, מחירים וצבעים, או פשוט מבקשים מהעוזר.',
    cta: 'העיצוב של העסק כבר על השולחן.',
  },
} satisfies Record<Audience, unknown>;

export function Landing({ audience = 'private' }: { audience?: Audience }) {
  const copy = COPY[audience];
  const steps = [
    { n: 'א', title: 'בוחרים', text: copy.step1 },
    { n: 'ב', title: 'מתאימים', text: copy.step2 },
    { n: 'ג', title: 'מורידים', text: 'קובץ 300dpi, מוכן לדפוס, לוואטסאפ או לרשתות.' },
  ];
  const router = useRouter();
  const [templates, setTemplates] = useState<Published[]>([]);
  const [carousel, setCarousel] = useState<CarouselSetting[]>([]);
  // the ring waits for both, so it is dealt once with the admin's order and pictures
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      api<Published[]>('/api/templates'),
      // without the admin's choices the default order still works
      api<CarouselSetting[]>('/api/carousel').catch(() => []),
    ])
      .then(([t, c]) => {
        setTemplates(t);
        setCarousel(c);
        setLoaded(true);
      })
      .catch((e) => setError(e.message));
  }, []);

  // leaving the home page returns the site to its plain light
  useEffect(() => () => setMood(null), []);

  // the ring holds the categories: the ones the admin shows on this door, in their order, each with the picture
  // the admin chose for it (else its built-in cover; see applyCarousel and /carousel)
  const ring = useMemo<RingItem[]>(() => {
    if (!loaded) return [];
    const counts = new Map<string, number>();
    for (const t of templates) counts.set(t.topic || GENERAL_TOPIC, (counts.get(t.topic || GENERAL_TOPIC) ?? 0) + 1);
    return applyCarousel(defaultCards(templates), carousel)
      .filter((c) => !c.hidden && topicAudience(c.name, carousel) === audience)
      .map((c) => ({ id: c.name, name: c.name, image: c.image, note: countNote(counts.get(c.name) ?? 0) }));
  }, [loaded, templates, carousel, audience]);

  return (
    <div className={audience === 'business' ? `${s.root} ${s.business}` : s.root}>
      {/* the first screen: the ring of categories stands right on the site backdrop */}
      <section id="cats" className={s.hero}>
        <div className={`${s.wrap} ${s.heroInner}`}>
          <div className={`${s.heroHead} ${s.rise}`}>
            <nav className={s.doors} aria-label="בשביל מי העיצוב">
              {DOORS.map((d) => (
                <Link key={d.audience} href={d.href} className={s.door} aria-current={d.audience === audience ? 'page' : undefined} scroll={false}>
                  {d.label}
                </Link>
              ))}
            </nav>
            <span className={s.eyebrow}>{copy.eyebrow}</span>
            <h1 className={s.title}>
              {copy.title[0]} {copy.title[1]} <span className={s.shine}>{copy.title[2]}</span>
            </h1>
            <p className={s.lead}>{copy.lead}</p>
            {audience === 'business' && (
              <Link className={s.back} href="/business/brand">
                ✎ לוגו ופרטי העסק, פעם אחת על כל העיצובים
              </Link>
            )}
          </div>

          {error && (
            <p className={s.error} role="alert">
              {error}
            </p>
          )}

          <div className={s.rise} style={{ animationDelay: '.15s' }}>
            <MirrorRing
              items={ring}
              label="קטגוריות"
              spinKey={audience}
              onOpen={(c) => router.push(categoryHref(c.id, audience))}
              openLabel="לכל העיצובים ←"
              // the site takes on the light of the simcha in front (the business door keeps its own)
              onFront={(c) => audience === 'private' && setMood(moodOf(c.id))}
            />
          </div>
        </div>
      </section>

      <div className={s.ribbon} aria-hidden="true">
        <ul>
          {copy.ticker.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      </div>

      <section id="how" className={`${s.wrap} ${s.how}`}>
        <div className={s.head}>
          <h2 className={s.h2}>
            שלוש דקות, <span className={s.shine}>שלושה צעדים</span>
          </h2>
          <p>בלי תוכנות ובלי גרפיקאי. הכול קורה כאן בדפדפן.</p>
        </div>
        <div className={s.steps}>
          {steps.map((st) => (
            <div key={st.n} className={s.step}>
              <span className={s.stepNum}>{st.n}</span>
              <h3>{st.title}</h3>
              <p>{st.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className={s.wrap}>
        <div className={s.cta}>
          <span className={s.eyebrow}>מוכנים?</span>
          <h2>{copy.cta}</h2>
          <a className={`${s.btn} ${s.dark}`} href="#cats">
            בחרו עיצוב ←
          </a>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
