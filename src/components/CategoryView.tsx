'use client';

import { useEffect, useState, type MouseEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMe } from './Auth';
import { flyCard, landCard } from './CardFlight';
import { SiteFooter } from './SiteFooter';
import { setMood } from './SiteBackdrop';
import { StoryTable } from './StoryTable';
import s from './festive.module.css';
import { brandPreview, hasBrandRoles } from '@/lib/brand';
import { GENERAL_TOPIC, type Audience } from '@/lib/categories';
import { formatPrice } from '@/lib/price';
import { professionOf } from '@/lib/professions';
import { renderCard, type DrawableDoc } from '@/lib/renderCard';
import { applyShabbat, hasShabbatRoles, SHABBAT_CITIES, SHABBAT_TOPIC, type ShabbatTimes } from '@/lib/shabbatDoc';
import { INVITATION_WORDS, moodOf, storyOf } from '@/lib/story';
import { takeSeries } from '@/lib/takeSeries';
import type { BrandKit } from '@/lib/types';

type Published = { id: string; name: string; topic: string | null; price: number | null; series: string | null; width_mm: number; height_mm: number; thumbnail: string | null };

/** what a design's shape is for */
function formatOf(t: Published) {
  const ratio = t.width_mm / t.height_mm;
  if (ratio < 0.65) return 'סטטוס';
  if (ratio > 0.9 && ratio < 1.1) return 'פוסט';
  return 'דף להדפסה';
}

const CITY_KEY = 'shabbat-city';

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
  // a simcha with a story opens on its writing table (StoryTable); the plain gallery is one click away
  const story = audience === 'private' ? storyOf(topic) : null;
  const [gallery, setGallery] = useState(!story);
  // a business with a brand kit sees each design drawn with its own logo and details: template id -> picture
  const [brand, setBrand] = useState<BrandKit | null>(null);
  const [branded, setBranded] = useState<Record<string, string>>({});
  const [format, setFormat] = useState<string | null>(null);
  // the Shabbat category: the chosen city and its coming Shabbat, written into every design of the page
  const isShabbat = topic === SHABBAT_TOPIC;
  const [city, setCity] = useState(SHABBAT_CITIES[0].id);
  const [times, setTimes] = useState<ShabbatTimes | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(CITY_KEY);
      if (SHABBAT_CITIES.some((c) => c.id === saved)) setCity(saved!);
    } catch {}
  }, []);

  useEffect(() => {
    if (!isShabbat) return;
    let alive = true;
    try {
      localStorage.setItem(CITY_KEY, city);
    } catch {}
    fetch(`/api/shabbat?city=${city}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((t: ShabbatTimes | null) => alive && setTimes(t))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [isShabbat, city]);

  useEffect(() => {
    if (audience !== 'business' || (isShabbat && !times)) return;
    let alive = true;
    (async () => {
      const found = me ? ((await fetch('/api/brand').then((r) => (r.ok ? r.json() : null))) as BrandKit | null) : null;
      const kit = found?.businessName ? found : null;
      if (!alive) return;
      setBrand(kit);
      if (!kit && !isShabbat) return;
      const res = await fetch(`/api/templates/canvas?topic=${encodeURIComponent(topic)}`);
      if (!res.ok) return;
      for (const d of (await res.json()) as { id: string; canvas: DrawableDoc }[]) {
        if (!alive) return;
        const useKit = kit && hasBrandRoles(d.canvas);
        const useTimes = times && hasShabbatRoles(d.canvas);
        if (!useKit && !useTimes) continue;
        const withKit = useKit ? brandPreview(d.canvas, kit) : d.canvas;
        const image = await renderCard(useTimes ? applyShabbat(withKit, times) : withKit).catch(() => null);
        if (alive && image) setBranded((b) => ({ ...b, [d.id]: image }));
      }
    })().catch(() => {}); // the plain gallery still works
    return () => {
      alive = false;
    };
  }, [audience, me, topic, isShabbat, times]);

  // the site takes on this simcha's light while its page is open
  useEffect(() => {
    if (audience !== 'private') return;
    setMood(moodOf(topic));
    return () => setMood(null);
  }, [topic, audience]);

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
      // the times depend on the city chosen here, so a Shabbat design comes back to this page after signing in
      router.push(isShabbat ? `/login?next=${encodeURIComponent(window.location.pathname)}` : `/t/${t.id}`);
      return;
    }
    setBusy(true);
    setError('');
    // the card lifts off the page right away and lands on the editor's canvas once it is ready
    const face = e.currentTarget.firstElementChild as HTMLElement | null;
    if (face) flyCard(face.getBoundingClientRect(), branded[t.id] ?? t.thumbnail);
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: t.id, useBrand: !!brand, shabbatCity: isShabbat ? city : undefined }),
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

  /** the whole series as the customer's own designs, in the basket */
  async function takeAll(series: string) {
    if (!me) {
      router.push(`/login?next=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await takeSeries({ series, useBrand: !!brand }, branded);
      router.push('/my-cards');
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const formats = [...new Set((items ?? []).map(formatOf))];
  const shown = (items ?? []).filter((t) => !format || formatOf(t) === format);
  const allSeries = [...new Set((items ?? []).flatMap((t) => (t.series ? [t.series] : [])))];
  const profession = professionOf(topic);

  // the plain gallery: every design of the category as a printed card
  const galleryView = (
    <>
      <div className={`${s.head} ${s.rise}`}>
        <span className={s.eyebrow}>קטגוריה</span>
        <h1 className={s.h2}>{topic}</h1>
        {items && items.length > 0 && <p>{items.length === 1 ? 'עיצוב אחד' : `${items.length} עיצובים`}. בחרו אחד, והוא נפתח בעורך.</p>}
        {story && (
          <button type="button" className={s.back} onClick={() => setGallery(false)}>
            ✎ לכתוב את {(story.words ?? INVITATION_WORDS).one} שלכם
          </button>
        )}
        {audience === 'business' && (
          <Link className={s.back} href="/business/brand">
            {brand ? `✎ המיתוג של ${brand.businessName}` : '✎ להוסיף לוגו ופרטי עסק לכל העיצובים'}
          </Link>
        )}
        {profession && (
          <Link className={s.back} href={`/business/messages?topic=${encodeURIComponent(profession.topic)}`}>
            ✉ הודעות פרסום מוכנות ל{profession.topic}
          </Link>
        )}
        {audience === 'business' &&
          allSeries.map((name) => {
            const n = (items ?? []).filter((t) => t.series === name).length;
            return (
              <button key={name} type="button" className={`${s.btn} ${s.dark}`} disabled={busy} onClick={() => takeAll(name)}>
                {busy ? 'מכין…' : `לקחת את כל הסדרה (${n} מודעות) ←`}
              </button>
            );
          })}
      </div>

      {isShabbat && (
        <div className={`card ${s.shabbatBar}`}>
          <label className="field">
            העיר שלכם
            <select value={city} onChange={(e) => setCity(e.target.value)}>
              {SHABBAT_CITIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          {times && (
            <p className={s.shabbatTimes} role="status">
              <strong>{times.parsha}</strong>
              <span>הדלקת נרות {times.candles}</span>
              <span>צאת השבת {times.havdalah}</span>
            </p>
          )}
          <p className="status" style={{ margin: 0 }}>
            הזמנים מחושבים לפי מנהג העיר. לפני השליחה כדאי לוודא מול הלוח המקובל אצלכם.
          </p>
        </div>
      )}

      {formats.length > 1 && (
        <nav className={s.filters} aria-label="סינון לפי פורמט">
          <button type="button" className={s.filter} aria-pressed={format === null} onClick={() => setFormat(null)}>
            הכול
          </button>
          {formats.map((f) => (
            <button key={f} type="button" className={s.filter} aria-pressed={format === f} onClick={() => setFormat(f)}>
              {f}
            </button>
          ))}
        </nav>
      )}

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
          {shown.map((t) => (
            <button key={t.id} type="button" className={s.design} onClick={(e) => open(t, e)} disabled={busy}>
              <span
                className={s.designFace}
                style={{ aspectRatio: `${t.width_mm} / ${t.height_mm}`, ...((branded[t.id] ?? t.thumbnail) ? { backgroundImage: `url("${branded[t.id] ?? t.thumbnail}")` } : {}) }}
                aria-hidden="true"
              />
              <span className={s.designName}>{t.name}</span>
              {t.price !== null && <span className={s.designPrice}>{formatPrice(t.price)}</span>}
              <span className={s.designHint}>לפתיחה בעורך</span>
            </button>
          ))}
        </div>
      )}
    </>
  );

  return (
    <div className={audience === 'business' ? `${s.root} ${s.business}` : s.root}>
      <section className={`${s.wrap} ${s.catPage}`}>
        <Link className={s.back} href={home}>
          → כל הקטגוריות
        </Link>
        {story && !gallery ? <StoryTable topic={topic} story={story} onSkip={() => setGallery(true)} /> : galleryView}
      </section>
      <SiteFooter />
    </div>
  );
}
