'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { SiteFooter } from './SiteFooter';
import { AdHistory } from './AdHistory';
import { MirrorRing, type RingItem } from './MirrorRing';
import s from './festive.module.css';
import { applyCarousel, categoryHref, defaultCards, GENERAL_TOPIC, groupHref, PRIVATE_GROUPS, topicAudience, type Audience, type CarouselSetting } from '@/lib/categories';

type Published = { id: string; name: string; topic: string | null; thumbnail: string | null; price: number | null };

async function api<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'שגיאה לא צפויה');
  return data as T;
}

const DOORS: { audience: Audience; href: string; label: string }[] = [
  { audience: 'private', href: '/', label: 'לשמחה' },
  { audience: 'business', href: '/business', label: 'לעסק' },
];

/** icon per category name — emoji for quick rendering */
const CAT_ICON: Record<string, string> = {
  'חתונה': '💍', 'אירוסין': '💒', 'קידוש': '🍷', 'שלום זכר': '👶',
  'ברית': '✡️', 'וואך נאכט': '🕯️', 'פדיון הבן': '🪙', 'חלאקה': '✂️',
  'בר מצווה': '📖', 'חנוכת הבית': '🏠', 'בית כנסת': '🕍', 'תעודות': '📜',
  'שמחת בית השואבה': '💧', 'ברכות': '💌', 'איחולים': '✨', 'מיתוג שמחה': '🎨',
  'ייעוץ משכנתאות': '🏡', 'מיזוג אוויר': '❄️', 'ייעוץ עסקי': '💼',
  'לוגו': '⭐', 'זמני שבת': '🕯️', 'מודעות מבצע': '📢', 'פתיחת עסק': '🎊',
  'פוסטים לרשתות': '📱', 'כרטיסי ביקור': '🪪', 'תפריטים': '🍽️',
  'רפואה פרטית': '🏥', 'עורכי דין': '⚖️', 'נדל"ן ותיווך': '🏘️',
  'ביטוח': '🛡️', 'קוסמטיקה ויופי': '💅', 'כללי': '🌟',
};

const COPY = {
  private: {
    title: 'עיצוב לכל שמחה',
    lead: 'בוחרים הזמנה או ברכה, ממלאים את הפרטים ומורידים את הכרטיס. בלי הרשמה ובלי גרפיקאי.',
  },
  business: {
    title: 'עיצוב לעסק שלכם',
    lead: 'בחרו קטגוריה, קבלו עיצובים עם המיתוג שלכם, ושלחו בוואטסאפ.',
  },
} satisfies Record<Audience, unknown>;

export function Landing({ audience = 'private' }: { audience?: Audience }) {
  const copy = COPY[audience];
  const router = useRouter();
  const [templates, setTemplates] = useState<Published[]>([]);
  const [carousel, setCarousel] = useState<CarouselSetting[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    // the private door's ring is fixed; its designs feed the strip under it
    Promise.all([
      api<Published[]>('/api/templates'),
      api<CarouselSetting[]>('/api/carousel').catch(() => []),
    ])
      .then(([t, c]) => { setTemplates(t); setCarousel(c); setLoaded(true); })
      .catch((e) => setError(e.message));
  }, [audience]);

  /** a few of the private door's real designs, one topic after another so the strip isn't all one kind */
  const showcase = useMemo(() => {
    if (!loaded || audience !== 'private') return [];
    const mine = templates.filter((t) => t.thumbnail && topicAudience(t.topic || GENERAL_TOPIC, carousel) === 'private');
    // cards first, one topic after another; the event pieces (a roll-up reads as a blank form out of context) only fill the end
    const order = PRIVATE_GROUPS.flatMap((g) => g.topics);
    const rank = (topic: string) => (order.includes(topic) ? order.indexOf(topic) : order.length);
    const eventTopics = PRIVATE_GROUPS.find((g) => g.id === 'events')?.topics ?? [];
    const roundRobin = (list: Published[]) => {
      const byTopic = new Map<string, Published[]>();
      for (const t of [...list].sort((a, b) => rank(a.topic || GENERAL_TOPIC) - rank(b.topic || GENERAL_TOPIC)))
        byTopic.set(t.topic || GENERAL_TOPIC, [...(byTopic.get(t.topic || GENERAL_TOPIC) ?? []), t]);
      const out: Published[] = [];
      for (let i = 0; out.length < list.length; i++) for (const l of byTopic.values()) if (l[i]) out.push(l[i]);
      return out;
    };
    const isEvent = (t: Published) => eventTopics.includes(t.topic ?? '');
    return [...roundRobin(mine.filter((t) => !isEvent(t))), ...roundRobin(mine.filter(isEvent))].slice(0, 8);
  }, [loaded, templates, carousel, audience]);

  /** Categories for this door, in admin order, with their image and templates */
  const groups = useMemo(() => {
    if (!loaded || audience !== 'business') return [];
    const cards = applyCarousel(defaultCards(templates), carousel)
      .filter((c) => !c.hidden && topicAudience(c.name, carousel) === audience);
    return cards.map((cat) => ({
      name: cat.name,
      image: cat.image,
      icon: CAT_ICON[cat.name] ?? '📌',
      items: templates
        .filter((t) => (t.topic || GENERAL_TOPIC) === cat.name)
        .slice(0, 8),
    })).filter((g) => g.items.length > 0);
  }, [loaded, templates, carousel, audience]);

  const ringItems = useMemo<RingItem[]>(
    () => audience === 'private'
      ? PRIVATE_GROUPS.map((g) => ({ id: g.id, name: g.name, image: g.image }))
      : groups.map((g) => ({ id: g.name, name: g.name, image: g.image })),
    [audience, groups],
  );

  const handleRingOpen = useCallback((item: RingItem) => {
    if (audience === 'private') {
      router.push(groupHref(item.id));
      return;
    }
    const id = `cat-${encodeURIComponent(item.name)}`;
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [audience, router]);

  return (
    <div className={audience === 'business' ? `${s.root} ${s.business}` : s.root}>

      {/* ── hero ───────────────────────────────────── */}
      <section className={s.landingHero}>
        <div className={s.wrap}>
          <nav className={s.doors} aria-label="בשביל מי העיצוב">
            {DOORS.map((d) => (
              <Link key={d.audience} href={d.href} className={s.door}
                aria-current={d.audience === audience ? 'page' : undefined} scroll={false}>
                {d.label}
              </Link>
            ))}
          </nav>
          <h1 className={s.title} style={{ marginTop: 20 }}>{copy.title}</h1>
          <p className={s.lead}>{copy.lead}</p>

          {audience === 'business' && (
            <div className={s.bizLinks}>
              <Link className={s.back} href="/business/brand">✎ לוגו ופרטי העסק</Link>
              <Link className={s.back} href="/business/messages">✉ הודעות פרסום</Link>
              <Link className={s.back} href="/business/calendar">📅 לוח שיווק</Link>
            </div>
          )}
        </div>

        {ringItems.length > 0 && (
          <MirrorRing
            items={ringItems}
            label={audience === 'private' ? 'הזמנות, איחולים ואירועים' : 'קטגוריות עסקיות'}
            spinKey={audience + '-' + ringItems.map((r) => r.id).join(',')}
            onOpen={handleRingOpen}
            openLabel={audience === 'private' ? 'לכל סוגי הכרטיסים ←' : 'עברו לעיצובים ↓'}
          />
        )}
      </section>

      {/* ── real designs and how it works (private door) ── */}
      {showcase.length > 0 && (
        <section id="cats" className={`${s.wrap} ${s.catSection}`}>
          <h2 className={s.sectionTitle}>עיצובים שאפשר להתחיל מהם עכשיו</h2>
          <div className={s.cardStrip}>
            {showcase.map((t) => (
              <Link key={t.id} href={`/t/${t.id}`} className={s.cardTile}>
                <img src={t.thumbnail!} alt={t.name} className={s.cardTileImg} loading="lazy" decoding="async" />
                <div className={s.cardTileMeta}>
                  <span className={s.cardTileName}>{t.name}</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
      {audience === 'private' && (
        <section id="how" className={`${s.wrap} ${s.catSection}`}>
          <h2 className={s.sectionTitle}>איך זה עובד</h2>
          <ol className={s.howSteps}>
            <li><strong>בוחרים עיצוב</strong><span>הזמנה, ברכה או תעודה, לפי סוג השמחה.</span></li>
            <li><strong>ממלאים את הפרטים</strong><span>שמות, תאריך ומקום. הכרטיס מתעדכן מולכם.</span></li>
            <li><strong>מורידים את הכרטיס</strong><span>קובץ תמונה, מוכן לשליחה בוואטסאפ או להדפסה.</span></li>
          </ol>
        </section>
      )}

      {/* ── category grid ──────────────────────────── */}
      {audience === 'business' && (
        <section className={`${s.wrap} ${s.catGridSection}`}>
          <h2 className={s.sectionTitle}>בחרו קטגוריה</h2>
          {error && <p className={s.error} role="alert">{error}</p>}
          {!loaded && <p className={s.muted}>טוען…</p>}
          <div className={s.catGrid}>
            {groups.map((g) => (
              <a key={g.name} href={`#cat-${encodeURIComponent(g.name)}`} className={s.catTile}>
                {g.image
                  ? <img src={g.image} alt="" className={s.catTileImg} />
                  : <span className={s.catTileIcon}>{g.icon}</span>
                }
                <span className={s.catTileName}>{g.name}</span>
              </a>
            ))}
          </div>
        </section>
      )}

      {/* ── cards grouped by category ─────────────── */}
      {groups.map((g) => (
        <section key={g.name} id={`cat-${encodeURIComponent(g.name)}`} className={`${s.wrap} ${s.catSection}`}>
          <div className={s.catSectionHead}>
            <span className={s.catSectionIcon}>{g.icon}</span>
            <h2 className={s.catSectionTitle}>{g.name}</h2>
            <Link href={categoryHref(g.name, audience)} className={s.catSectionAll}>
              לכל העיצובים ←
            </Link>
          </div>
          <div className={s.cardStrip}>
            {g.items.map((t) => (
              <Link key={t.id} href={categoryHref(g.name, audience)} className={s.cardTile}>
                {t.thumbnail
                  ? <img src={t.thumbnail} alt={t.name} className={s.cardTileImg} loading="lazy" decoding="async" />
                  : <div className={s.cardTilePlaceholder} />
                }
                <div className={s.cardTileMeta}>
                  <span className={s.cardTileName}>{t.name}</span>
                  {t.price != null && t.price > 0 && (
                    <span className={s.cardTilePrice}>₪{t.price}</span>
                  )}
                </div>
              </Link>
            ))}
            <Link href={categoryHref(g.name, audience)} className={`${s.cardTile} ${s.cardTileMore}`}>
              <span>לכל העיצובים</span>
              <span style={{ fontSize: '1.5rem' }}>←</span>
            </Link>
          </div>
        </section>
      ))}

      {audience === 'business' && (
        <div className={s.wrap}>
          <AdHistory />
        </div>
      )}

      <SiteFooter />
    </div>
  );
}
