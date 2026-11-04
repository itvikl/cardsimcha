'use client';

import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMe } from './Auth';
import { flyCard, landCard } from './CardFlight';
import { ComposeAd } from './ComposeAd';
import { SiteFooter } from './SiteFooter';
import { setMood } from './SiteBackdrop';
import { TryAd } from './TryAd';
import s from './festive.module.css';
import { AD_FORMATS, formatOfPage, MEDIUM_LABEL, type AdMedium } from '@/lib/adFormats';
import { dropPoints, itemTexts, placePhoto, writeAd } from '@/lib/adText';
import { brandPreview, hasBrandRoles } from '@/lib/brand';
import { clearBrandDraft, draftKit, readBrandDraft, saveBrandDraft, type BrandDraft } from '@/lib/brandDraft';
import { GENERAL_TOPIC, groupHref, groupOf, LOGO_TOPIC, type Audience } from '@/lib/categories';
import { moodOf } from '@/lib/mood';
import { formatPrice } from '@/lib/price';
import { professionOf } from '@/lib/professions';
import { renderCard, type DrawableDoc } from '@/lib/renderCard';
import { applyShabbat, hasShabbatRoles, SHABBAT_CITIES, SHABBAT_TOPIC, type ShabbatTimes } from '@/lib/shabbatDoc';
import { takeSeries } from '@/lib/takeSeries';
import type { BrandKit, CatalogItem } from '@/lib/types';

type Published = { id: string; name: string; topic: string | null; price: number | null; series: string | null; sizeGroup: string | null; width_mm: number; height_mm: number; thumbnail: string | null };

/** what a design's shape is for */
function formatOf(t: Published) {
  const known = formatOfPage(t.width_mm, t.height_mm);
  if (known) return known.label;
  const ratio = t.width_mm / t.height_mm;
  if (ratio < 0.65) return 'סטטוס';
  if (ratio > 0.9 && ratio < 1.1) return 'פוסט';
  return 'דף להדפסה';
}

const CITY_KEY = 'shabbat-city';

/** saves what was typed as the business's kit */
async function saveKit(draft: BrandDraft): Promise<BrandKit> {
  const res = await fetch('/api/brand', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || 'השמירה נכשלה');
  return d;
}

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
  // back goes where the customer came from: the business door, or this kind's group on the private side
  const group = groupOf(topic);
  const home = audience === 'business' ? '/business' : groupHref(group.id);
  // a business with a brand kit sees each design drawn with its own logo and details: template id -> picture
  const [brand, setBrand] = useState<BrandKit | null>(null);
  const [branded, setBranded] = useState<Record<string, string>>({});
  const [format, setFormat] = useState<string | null>(null);
  const [canvases, setCanvases] = useState<{ id: string; canvas: DrawableDoc }[]>([]);
  // the business's own catalog, and the item chosen to go on every ad of the page
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [itemId, setItemId] = useState('');
  const item = catalog.find((i) => i.id === itemId) ?? null;
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

  // the kit: the signed-in business's own, or what a visitor tried the page with. Details tried before signing up become the kit now.
  useEffect(() => {
    if (audience !== 'business') return;
    let alive = true;
    (async () => {
      const draft = readBrandDraft();
      if (!me) {
        setBrand(draft ? draftKit(draft) : null);
        return;
      }
      let found = (await fetch('/api/brand').then((r) => (r.ok ? r.json() : null))) as BrandKit | null;
      if (!found?.businessName && draft) found = await saveKit(draft);
      clearBrandDraft();
      if (alive) setBrand(found?.businessName ? found : null);
      const items = (await fetch('/api/catalog').then((r) => (r.ok ? r.json() : []))) as CatalogItem[];
      if (alive) setCatalog(items);
    })().catch(() => {}); // the plain gallery still works
    return () => {
      alive = false;
    };
  }, [audience, me]);

  const needsDrawing = audience === 'business' && (!!brand || (isShabbat && !!times));
  useEffect(() => {
    if (!needsDrawing) return;
    let alive = true;
    fetch(`/api/templates/canvas?topic=${encodeURIComponent(topic)}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((list: { id: string; canvas: DrawableDoc }[]) => alive && setCanvases(list))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [needsDrawing, topic]);

  const shownIds = useRef<Set<string>>(new Set());
  const drawn = useRef<Set<string>>(new Set());
  const picture = JSON.stringify([brand?.businessName, brand?.phone, brand?.slogan, brand?.primaryColor, brand?.secondaryColor, brand?.logo?.file, times?.candles, times?.city, itemId]);
  // a change of details redraws every design
  useEffect(() => {
    drawn.current = new Set();
    setBranded({});
  }, [picture]);

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
      // the times depend on the city chosen here, and the details tried here wait to become the kit: both come back to this page after signing in
      router.push(isShabbat || brand ? `/login?next=${encodeURIComponent(window.location.pathname)}` : `/t/${t.id}`);
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
        body: JSON.stringify({ templateId: t.id, useBrand: !!brand, shabbatCity: isShabbat ? city : undefined, itemId: item?.id }),
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
  // one ad comes in several sizes: until a size is chosen, each ad shows once
  const shown = useMemo(() => (items ?? []).filter((t) => (format ? formatOf(t) === format : !t.sizeGroup || t.series)), [items, format]);
  const shownKey = shown.map((t) => t.id).join();
  shownIds.current = new Set(shown.map((t) => t.id));
  // draws what is on the screen, one at a time: a category can hold dozens of designs in all its sizes
  useEffect(() => {
    if (!canvases.length) return;
    let alive = true;
    (async () => {
      for (const d of canvases) {
        if (!alive) return;
        if (!shownIds.current.has(d.id) || drawn.current.has(d.id)) continue;
        const useKit = brand && hasBrandRoles(d.canvas);
        const useTimes = times && hasShabbatRoles(d.canvas);
        if (!useKit && !useTimes && !item) continue;
        let doc = useKit ? brandPreview(d.canvas, brand) : d.canvas;
        if (useTimes) doc = applyShabbat(doc, times);
        if (item) {
          doc = writeAd(dropPoints(doc), itemTexts(item));
          if (item.photo) doc = placePhoto(doc, { ...item.photo, src: `/api/uploads/${item.photo.file}` });
        }
        const image = await renderCard(doc).catch(() => null);
        if (!alive) return;
        drawn.current.add(d.id);
        if (image) setBranded((b) => ({ ...b, [d.id]: image }));
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvases, picture, shownKey]);

  /** what a visitor or a business without a kit typed: signed in it is saved, and otherwise it stays in this browser */
  async function tryDetails(draft: BrandDraft) {
    if (me) setBrand(await saveKit(draft));
    else {
      saveBrandDraft(draft);
      setBrand(draftKit(draft));
    }
  }

  const allSeries = [...new Set((items ?? []).flatMap((t) => (t.series ? [t.series] : [])))];
  const profession = professionOf(topic);

  // the plain gallery: every design of the category as a printed card
  const galleryView = (
    <>
      <div className={`${s.head} ${s.rise}`}>
        <span className={s.eyebrow}>קטגוריה</span>
        <h1 className={s.h2}>{topic}</h1>
        {items && items.length > 0 && <p>{shown.length === 1 ? 'עיצוב אחד' : `${shown.length} עיצובים`}. בחרו אחד, והוא נפתח בעורך.</p>}
        {audience === 'business' && (
          <Link className={s.back} href="/business/brand">
            {brand ? `✎ המיתוג של ${brand.businessName}` : '✎ להוסיף לוגו ופרטי עסק לכל העיצובים'}
          </Link>
        )}
        {profession && !!me && (
          <Link className={s.back} href="/business/catalog">
            ✎ {catalog.length ? 'הקטלוג שלי' : 'להוסיף מוצרים ותמונות משלכם'}
          </Link>
        )}
        {profession && (
          <Link className={s.back} href={`/business/messages?topic=${encodeURIComponent(profession.topic)}`}>
            ✉ הודעות פרסום מוכנות ל{profession.topic}
          </Link>
        )}
        {allSeries.map((name) => {
          const n = (items ?? []).filter((t) => t.series === name).length;
          return (
            <button key={name} type="button" className={`${s.btn} ${s.dark}`} disabled={busy} onClick={() => takeAll(name)}>
              {busy ? 'מכין…' : `לקחת את כל הסדרה (${n} ${audience === 'business' ? 'מודעות' : 'פריטים'}) ←`}
            </button>
          );
        })}
      </div>

      {audience === 'business' && !brand && topic !== LOGO_TOPIC && !isShabbat && <TryAd signedIn={!!me} onSubmit={tryDetails} />}

      {profession && (
        <div className={s.composeBar}>
          <ComposeAd topic={topic} signedIn={!!me} kit={brand} items={catalog} />
        </div>
      )}

      {profession && catalog.length > 0 && (
        <div className={`card ${s.shabbatBar}`}>
          <label className="field">
            מוצר או שירות על המודעות
            <select value={itemId} onChange={(e) => setItemId(e.target.value)}>
              <option value="">בלי, הנוסח המוכן של המודעה</option>
              {catalog.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

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

      {formats.length > 1 && topic !== LOGO_TOPIC && (
        <nav className={s.filters} aria-label="סינון לפי מידה">
          <button type="button" className={s.filter} aria-pressed={format === null} onClick={() => setFormat(null)}>
            הכול
          </button>
          {(['digital', 'print'] as AdMedium[]).map((m) => {
            const list = AD_FORMATS.filter((f) => f.medium === m && formats.includes(f.label));
            return (
              list.length > 0 && (
                <span key={m} className={s.filterGroup} role="group" aria-label={MEDIUM_LABEL[m]}>
                  <span className={s.filterLabel}>{MEDIUM_LABEL[m]}</span>
                  {list.map((f) => (
                    <button key={f.id} type="button" className={s.filter} aria-pressed={format === f.label} onClick={() => setFormat(f.label)}>
                      {f.label}
                    </button>
                  ))}
                </span>
              )
            );
          })}
          {formats
            .filter((f) => !AD_FORMATS.some((x) => x.label === f))
            .map((f) => (
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
            {audience === 'business' ? 'לכל הקטגוריות' : `ל${group.name}`}
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
          → {audience === 'business' ? 'כל הקטגוריות' : group.name}
        </Link>
        {galleryView}
      </section>
      <SiteFooter />
    </div>
  );
}
