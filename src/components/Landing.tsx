'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMe } from './Auth';
import { TableHero, type HeroCard } from './TableHero';
import { MirrorRing, type RingItem } from './MirrorRing';
import s from './festive.module.css';
import { applyCarousel, audienceOf, categoryHref, defaultCards, GENERAL_TOPIC, type Audience, type CarouselSetting } from '@/lib/categories';

type Published = { id: string; name: string; topic: string | null; thumbnail: string | null };
type Mine = { id: string; name: string; updatedAt: string; thumbnail: string | null };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'שגיאה לא צפויה');
  return data as T;
}

/** everything on the page that differs between the two doors */
const COPY = {
  private: {
    eyebrow: 'הזמנות · תעודות · מודעות לבית הכנסת',
    title: ['תעצב את', 'האירוע', 'שלך'],
    lead: 'שלפו כרטיס מהשולחן, כתבו את השם, והוא כבר יחכה לכם בכרטיס כשתפתחו אותו.',
    label: 'למי השמחה?',
    name: 'נועם & שירה',
    fallbackName: 'השם שלכם',
    ticker: ['מזל טוב', 'בשעה טובה', 'ברוכים הבאים', 'שנזכה לשמחות', 'לחיים'],
    catsTitle: ['לאיזו', 'שמחה', '?'],
    step1: 'מסובבים את הטבעת ובוחרים עיצוב לשמחה שלכם.',
    step2: 'שמות, תאריך, צבע ורקע, או פשוט מבקשים מהעוזר.',
    cta: 'הכרטיס שלכם כבר על השולחן.',
  },
  business: {
    eyebrow: 'מודעות · לוגו · כרטיסי ביקור · פוסטים',
    title: ['תעצב את', 'העסק', 'שלך'],
    lead: 'מודעה, לוגו או פוסט לעסק, בלי גרפיקאי. כתבו את שם העסק, והוא כבר יחכה לכם בעיצוב כשתפתחו אותו.',
    label: 'איך קוראים לעסק?',
    name: 'מאפיית השכונה',
    fallbackName: 'העסק שלכם',
    ticker: ['פתיחה חגיגית', 'מבצע השבוע', 'חדש בשכונה', 'פתוחים גם בערב', 'משלוחים עד הבית'],
    catsTitle: ['מה', 'העסק', 'צריך?'],
    step1: 'מסובבים את הטבעת ובוחרים מודעה, לוגו או פוסט.',
    step2: 'שם העסק, טלפון, מחירים וצבעים, או פשוט מבקשים מהעוזר.',
    cta: 'העיצוב של העסק כבר על השולחן.',
  },
} satisfies Record<Audience, unknown>;

export function Landing({ audience = 'private' }: { audience?: Audience }) {
  const copy = COPY[audience];
  const ticker = Array.from({ length: 4 }, () => copy.ticker).flat();
  const steps = [
    { n: 'א', title: 'בוחרים', text: copy.step1 },
    { n: 'ב', title: 'מתאימים', text: copy.step2 },
    { n: 'ג', title: 'מורידים', text: 'קובץ 300dpi, מוכן לדפוס, לוואטסאפ או לרשתות.' },
  ];
  const { me } = useMe();
  const router = useRouter();
  const [templates, setTemplates] = useState<Published[]>([]);
  const [mine, setMine] = useState<Mine[]>([]);
  const [carousel, setCarousel] = useState<CarouselSetting[]>([]);
  const [error, setError] = useState('');
  const [name, setName] = useState(copy.name);
  const [cat, setCat] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [t, m, c] = await Promise.all([
      api<Published[]>('/api/templates'),
      me ? api<Mine[]>('/api/projects') : Promise.resolve([]),
      // without the admin's choices the default order still works
      api<CarouselSetting[]>('/api/carousel').catch(() => []),
    ]);
    setTemplates(t);
    setMine(m);
    setCarousel(c);
  }, [me]);

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);

  // the admin picks which categories show and their order (see /carousel)
  const visible = useMemo(
    () => applyCarousel(defaultCards(templates), carousel).filter((c) => !c.hidden && audienceOf(c.name) === audience),
    [templates, carousel, audience]
  );
  const categories = useMemo(() => visible.map((c) => c.name), [visible]);
  const byTopic = useMemo(() => {
    const map = new Map<string, RingItem[]>();
    for (const t of templates) {
      const key = t.topic || GENERAL_TOPIC;
      map.set(key, [...(map.get(key) ?? []), { id: t.id, name: t.name, thumbnail: t.thumbnail }]);
    }
    return map;
  }, [templates]);
  // one card per category for the table: the admin's carousel image, else a real design of that category, else the default cover
  const heroCards = useMemo<HeroCard[]>(
    () =>
      visible.map((c) => {
        const chosen = carousel.find((x) => x.name === c.name)?.src;
        const thumb = byTopic.get(c.name)?.find((t) => t.thumbnail)?.thumbnail;
        return { name: c.name, background: chosen ? `url("${chosen}")` : thumb ? `url("${thumb}")` : c.background };
      }),
    [visible, carousel, byTopic]
  );

  // until the visitor picks one: the first category that has designs
  const selected = cat ?? categories.find((c) => byTopic.has(c)) ?? categories[0] ?? GENERAL_TOPIC;
  const shownName = name.trim() || copy.fallbackName;

  async function open(item: RingItem) {
    if (!me) {
      router.push(`/t/${item.id}`);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const r = await api<{ id: string }>('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: item.id, prefill: name.trim() }),
      });
      router.push(`/editor/${r.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

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
    <div className={s.root}>
      <TableHero
        audience={audience}
        copy={copy}
        name={name}
        onName={setName}
        cards={heroCards}
        onPick={(c) => {
          setCat(c);
          document.getElementById('cats')?.scrollIntoView({ behavior: 'smooth' });
        }}
      />

      <div className={s.ticker} aria-hidden="true">
        <div className={s.tickerTrack}>
          {ticker.map((w, i) => (
            <span key={i}>
              {w} <i>✦</i>
            </span>
          ))}
        </div>
      </div>

      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}

      {mine.length > 0 && (
        <section className={s.mine} aria-label="הכרטיסים שלי">
          <div className={s.wrap}>
            <span className={s.eyebrow}>ההמשך שלכם</span>
            <h2 className={s.h2} style={{ marginTop: 10 }}>
              הכרטיסים <span className={s.shine}>שלי</span>
            </h2>
            <div className={s.mineGrid}>
              {mine.map((it) => (
                <div key={it.id} className={s.mineCard}>
                  <Link href={`/editor/${it.id}`} aria-label={`המשך עריכה של ${it.name}`}>
                    <div className={s.mineThumb} style={it.thumbnail ? { backgroundImage: `url("${it.thumbnail}")` } : undefined} />
                  </Link>
                  <strong>{it.name}</strong>
                  <small>עודכן {new Date(it.updatedAt).toLocaleString('he-IL')}</small>
                  <div className={s.mineRow}>
                    <Link className={`${s.btn} ${s.dark}`} href={`/editor/${it.id}`}>
                      המשך עריכה
                    </Link>
                    <button type="button" className={`${s.btn} ${s.danger}`} onClick={() => remove(it)}>
                      מחיקה
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      <section id="cats" className={s.cats}>
        <div className={`${s.wrap} ${s.catsInner}`}>
          <div className={s.headRow}>
            <h2 className={s.h2}>
              {copy.catsTitle[0]} <span className={s.shine}>{copy.catsTitle[1]}</span>
              {copy.catsTitle[2] === '?' ? '?' : ` ${copy.catsTitle[2]}`}
            </h2>
            <span>בחרו חותם, והטבעת מתמלאת</span>
          </div>
          <div className={s.seals} role="group" aria-label="קטגוריות">
            {categories.map((c) => (
              <button key={c} type="button" className={s.seal} aria-pressed={c === selected} onClick={() => setCat(c)}>
                <span className={s.sealDisk}>
                  <span className={s.sealRing} aria-hidden="true" />
                  <span className={s.sealFace} aria-hidden="true">
                    {c.trim().charAt(0)}
                  </span>
                </span>
                <span className={s.sealName}>{c}</span>
              </button>
            ))}
          </div>
          <MirrorRing
            items={byTopic.get(selected) ?? []}
            title={selected}
            moreHref={categoryHref(selected)}
            spinKey={selected}
            onOpen={open}
            busy={busy}
          />
          {name.trim() && (
            <p style={{ margin: 0, color: 'var(--muted)' }}>
              השם &quot;{name.trim()}&quot; ייכנס לכרטיס כשתפתחו אותו בעורך.
            </p>
          )}
        </div>
      </section>

      <section id="how" className={`${s.wrap} ${s.how}`}>
        <h2 className={s.h2}>
          שלוש דקות, <span className={s.shine}>שלושה צעדים</span>
        </h2>
        <span className={s.drawLine} aria-hidden="true" />
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
          <h2>
            <span className={s.shineLight}>{shownName}</span>, {copy.cta}
          </h2>
          <a className={`${s.btn} ${s.light}`} href="#cats">
            בחרו עיצוב ←
          </a>
        </div>
      </section>

      <footer className={s.footer}>
        <div className={s.wrap}>
          <strong>סטודיו עיצוב</strong>
          <span>לכל שמחה, יש כרטיס מושלם.</span>
        </div>
      </footer>
    </div>
  );
}
