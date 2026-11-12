'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMe } from './Auth';
import { flyCard, landCard } from './CardFlight';
import { SiteFooter } from './SiteFooter';
import s from './festive.module.css';
import a from './album.module.css';
import { applyCarousel, categoryHref, defaultCards, GENERAL_TOPIC, groupHref, groupOf, PRIVATE_GROUPS, topicAudience, type CarouselSetting } from '@/lib/categories';
import { buildBook, chapterSpread, LETTERS, type AlbumChapter, type AlbumDesign, type AlbumPage, type AlbumSpread } from '@/lib/album/book';
import { quadTransform } from '@/lib/album/perspective';
import { PaperSound } from '@/lib/album/sound';
import type { Mood } from '@/lib/mood';

type Published = { id: string; name: string; topic: string | null; thumbnail: string | null; sizeGroup: string | null; series: string | null };

const TITLE = 'עיצוב לכל שמחה';
const LEAD = 'הזמנות, ברכות ומיתוג לאירוע. בוחרים עיצוב, ממלאים את הפרטים ומורידים, בלי הרשמה ובלי גרפיקאי.';
const SOUND_KEY = 'album-sound';
/** how many designs a chapter shows large, a page each */
const DESIGNS_PER_CHAPTER = 4;
/** ads and notices that landed in the general topic, and one whose thumbnail is an empty frame */
const NOT_FOR_THE_ALBUM = /מודעה|זמני שבת|שטריימלים/;
const MOODS: Record<string, Mood> = { invitations: 'candle', wishes: 'dawn', events: 'gold' };
const BUSINESS: AlbumChapter = {
  id: 'business',
  name: 'לעסק',
  lead: 'בחרו קטגוריה, קבלו עיצובים עם המיתוג שלכם, ושלחו בוואטסאפ.',
  image: '/categories/opening.webp',
  href: '/business',
  cta: 'לעיצובים לעסק ←',
  mood: null,
  designs: [],
  kinds: [],
};

/**
 * Where things lie in the two photographs (public/album/hero.webp and open.webp, 2304×1296), in % of the picture:
 * the closed album's front board, corner by corner (top-left, top-right, bottom-right, bottom-left), and the open album's two pages.
 */
const COVER: [[number, number], [number, number], [number, number], [number, number]] = [[13.02, 24.54], [41.23, 16.98], [54.25, 60.19], [18.79, 74.69]];
const PAGES = {
  left: { x: 19.1, y: 17.6, w: 30.8, h: 67.2 },
  right: { x: 50.17, y: 17.6, w: 31.42, h: 67.2 },
};
/** the box the cover's foil is set in before it's laid onto the board */
const FOIL_BOX = 1000;
const TURN_MS = 950;

async function api<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error('שגיאה לא צפויה');
  return (await res.json()) as T;
}

/**
 * A chapter's window: invitations first, the kind's own designs next, and anything else after.
 * The general topic holds whatever has no topic yet, so some of it is left out.
 */
function pickDesigns(templates: Published[], topics: Set<string>): AlbumDesign[] {
  const rank = (t: Published) => (t.name.includes('הזמנה') ? 0 : t.topic ? 1 : 2);
  return templates
    .filter((t) => t.thumbnail && topics.has(t.topic || GENERAL_TOPIC) && (!t.sizeGroup || t.series) && !NOT_FOR_THE_ALBUM.test(t.name))
    .sort((x, y) => rank(x) - rank(y))
    .slice(0, DESIGNS_PER_CHAPTER)
    .map((t) => ({ id: t.id, name: t.name.replace(/\s*\(ייבוא\)\s*$/, ''), kind: t.topic || 'עיצוב', image: t.thumbnail! }));
}

/** The same chapters as the home page's ring, with what's behind them (as on GroupView); only what's ready is shown. */
function chapters(templates: Published[] | null, carousel: CarouselSetting[]): AlbumChapter[] {
  const cards = applyCarousel(defaultCards(templates ?? []), carousel);
  const groups = PRIVATE_GROUPS.map((g) => {
    const kinds = cards
      .filter((c) => !c.hidden && topicAudience(c.name, carousel) === 'private' && groupOf(c.name).id === g.id)
      .map((c) => ({
        name: c.name,
        href: categoryHref(c.name),
        count: templates && templates.filter((t) => (t.topic || GENERAL_TOPIC) === c.name && (!t.sizeGroup || t.series)).length,
      }))
      .filter((k) => k.count !== 0);
    return {
      id: g.id,
      name: g.name,
      lead: g.lead,
      image: g.image,
      href: groupHref(g.id),
      cta: 'לכל סוגי הכרטיסים ←',
      mood: MOODS[g.id] ?? null,
      designs: templates ? pickDesigns(templates, new Set(kinds.map((k) => k.name))) : [],
      kinds,
    };
  });
  return [...groups, BUSINESS];
}

function storedSound() {
  try {
    return localStorage.getItem(SOUND_KEY) === 'on';
  } catch {
    return false;
  }
}

type Side = 'right' | 'left';
type Turn = { from: number; to: number; forward: boolean };

/**
 * The album that may replace the home page's ring. Two photographs carry it: the closed album on a stone table, its title
 * stamped in foil onto the board in the photograph's perspective, and the same album open from above, with the pages set
 * over its blank paper and the designs printed into it (multiply, so the paper's light and the binding's shadow show through).
 * A page turns over the spine in CSS 3D; on a phone one page shows at a time and the view follows the sheet.
 */
export function AlbumView() {
  const router = useRouter();
  const { ensureSession } = useMe();
  const stageRef = useRef<HTMLElement>(null);
  const heroPlateRef = useRef<HTMLDivElement>(null);
  const leafRef = useRef<HTMLDivElement>(null);
  const soundRef = useRef<PaperSound | null>(null);
  const soundOn = useRef(false);
  const openingRef = useRef(false);
  const swipe = useRef<{ x: number; y: number; id: number } | null>(null);
  const [spreads, setSpreads] = useState<AlbumSpread[] | null>(null);
  const [chapterList, setChapterList] = useState<AlbumChapter[]>([]);
  const [open, setOpen] = useState(false);
  const [spread, setSpread] = useState(0);
  const [side, setSide] = useState<Side>('right');
  const [turn, setTurn] = useState<Turn | null>(null);
  const [narrow, setNarrow] = useState(false);
  const [foil, setFoil] = useState('');
  const [sound, setSound] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const stored = storedSound();
    setSound(stored);
    soundOn.current = stored;
    let live = true;
    Promise.all([api<Published[]>('/api/templates').catch(() => null), api<CarouselSetting[]>('/api/carousel').catch(() => [])]).then(([templates, carousel]) => {
      if (!live) return;
      const list = chapters(templates, carousel);
      setChapterList(list);
      setSpreads(buildBook(list, DESIGNS_PER_CHAPTER));
    });
    const mq = window.matchMedia('(max-width: 700px)');
    const onMq = () => setNarrow(mq.matches);
    onMq();
    mq.addEventListener('change', onMq);
    return () => {
      live = false;
      mq.removeEventListener('change', onMq);
      soundRef.current?.dispose();
      soundRef.current = null;
    };
  }, []);

  // the foil follows the board wherever the photograph is cropped to
  useLayoutEffect(() => {
    const plate = heroPlateRef.current;
    if (!plate) return;
    const place = () => {
      const { width, height } = plate.getBoundingClientRect();
      const px = COVER.map(([x, y]) => [(x / 100) * width, (y / 100) * height]) as typeof COVER;
      setFoil(quadTransform(FOIL_BOX, FOIL_BOX, px));
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(plate);
    return () => ro.disconnect();
  }, []);

  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const playTurn = () => {
    if (soundOn.current) soundRef.current?.play('turn', TURN_MS / 1000);
  };

  /** turns the sheet between the spread showing and `to`; a jump of several spreads turns them as one */
  const turnTo = useCallback(
    (to: number) => {
      if (!spreads || turn || to === spread || to < 0 || to >= spreads.length) return;
      const forward = to > spread;
      playTurn();
      if (narrow) setSide(forward ? 'right' : 'left');
      if (reduced()) {
        setSpread(to);
        return;
      }
      setTurn({ from: spread, to, forward });
    },
    [spreads, turn, spread, narrow],
  );

  // the sheet goes over the spine; the spread changes once it lands
  useEffect(() => {
    const leaf = leafRef.current;
    if (!turn || !leaf) return;
    const deg = turn.forward ? 180 : -180;
    const anim = leaf.animate([{ transform: 'rotateY(0deg)' }, { transform: `rotateY(${deg}deg)` }], {
      duration: TURN_MS,
      easing: 'cubic-bezier(0.42, 0.04, 0.22, 1)',
      fill: 'forwards',
    });
    for (const shade of leaf.querySelectorAll<HTMLElement>('[data-shade]')) {
      const front = shade.dataset.shade === 'front';
      shade.animate(front ? [{ opacity: 0 }, { opacity: 0.32 }] : [{ opacity: 0.32 }, { opacity: 0 }], {
        duration: TURN_MS / 2,
        delay: front ? 0 : TURN_MS / 2,
        easing: front ? 'ease-in' : 'ease-out',
        fill: 'both',
      });
    }
    anim.onfinish = () => {
      setSpread(turn.to);
      setTurn(null);
    };
    return () => anim.cancel();
  }, [turn]);

  const next = useCallback(() => {
    if (!spreads || turn) return;
    if (!open) return setOpen(true);
    if (narrow && side === 'right') return setSide('left');
    turnTo(spread + 1);
  }, [spreads, turn, open, narrow, side, spread, turnTo]);

  const prev = useCallback(() => {
    if (!spreads || turn || !open) return;
    if (narrow && side === 'left') return setSide('right');
    if (spread === 0) return setOpen(false);
    turnTo(spread - 1);
  }, [spreads, turn, open, narrow, side, spread, turnTo]);

  const close = useCallback(() => {
    if (turn) return;
    setOpen(false);
  }, [turn]);

  const openBook = () => {
    setSpread(0);
    setSide('right');
    setOpen(true);
    if (soundOn.current) soundRef.current?.play('cover', 0.9);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable) return;
      // the book reads right to left: forward is to the left
      if (e.key === 'ArrowLeft') next();
      else if (e.key === 'ArrowRight') prev();
      else if (e.key === 'Escape' && open) close();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev, close, open]);

  // a Hebrew book's page is turned by drawing it to the right
  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.pointerType !== 'mouse') swipe.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
  };
  const onPointerUp = (e: ReactPointerEvent) => {
    const start = swipe.current;
    swipe.current = null;
    if (!start || start.id !== e.pointerId) return;
    const dx = e.clientX - start.x;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(e.clientY - start.y) * 1.5) return;
    if (dx > 0) next();
    else prev();
  };

  /** as on the category page: a guest session if needed, the customer's own copy, and the card flies into the editor */
  const openDesign = async (design: AlbumDesign, img: HTMLImageElement | null) => {
    if (openingRef.current) return;
    openingRef.current = true;
    setError('');
    if (img) flyCard(img.getBoundingClientRect(), design.image);
    try {
      await ensureSession();
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: design.id, useBrand: false }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'לא הצלחנו לפתוח את העיצוב');
      router.push(`/editor/${d.id}`);
    } catch (err) {
      landCard(null);
      setError((err as Error).message);
      openingRef.current = false;
    }
  };

  const toggleSound = () => {
    const on = !sound;
    setSound(on);
    soundOn.current = on;
    // created here because browsers only allow sound after a gesture
    if (on && !soundRef.current) soundRef.current = new PaperSound();
    if (on) soundRef.current?.play('turn', 0.5);
    try {
      localStorage.setItem(SOUND_KEY, on ? 'on' : 'off');
    } catch {
      // private browsing: it just won't be remembered
    }
  };

  // sound left on from a last visit starts with the first gesture on the page
  useEffect(() => {
    if (!sound || soundRef.current) return;
    const start = () => {
      soundRef.current ??= new PaperSound();
    };
    window.addEventListener('pointerdown', start, { once: true, capture: true });
    return () => window.removeEventListener('pointerdown', start, { capture: true });
  }, [sound]);

  const renderPage = (page: AlbumPage, where: Side) => (
    <PageContent
      page={page}
      side={where}
      chapters={chapterList}
      onChapter={(id) => spreads && turnTo(chapterSpread(spreads, id))}
      onDesign={openDesign}
    />
  );

  // what lies on each side while a sheet is in the air: the far side already shows where it's going
  const shown = spreads?.[spread];
  const target = turn && spreads ? spreads[turn.to] : null;
  const leftPage = turn ? (turn.forward ? target!.left : shown!.left) : shown?.left;
  const rightPage = turn ? (turn.forward ? shown!.right : target!.right) : shown?.right;
  const leafBox = turn ? (turn.forward ? PAGES.left : PAGES.right) : null;
  const last = spreads ? spreads.length - 1 : 0;
  const canNext = !!spreads && (narrow ? side === 'right' || spread < last : spread < last);

  return (
    <div className={s.root}>
      <section
        ref={stageRef}
        className={a.stage}
        data-open={open}
        data-turning={!!turn}
        aria-label="אלבום העיצובים"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
      >
        {/* ── the closed album ── */}
        <div className={a.hero} aria-hidden={open} inert={open}>
          <div className={a.heroBand}>
            <div ref={heroPlateRef} className={`${a.plate} ${a.heroPlate}`}>
              <img
                className={a.photo}
                src="/album/hero.webp"
                srcSet="/album/hero-1280.webp 1280w, /album/hero.webp 2304w"
                sizes="(max-width: 700px) 220vw, max(100vw, 178svh)"
                alt=""
                fetchPriority="high"
              />
              <div className={a.foil} style={{ width: FOIL_BOX, height: FOIL_BOX, transform: foil, visibility: foil ? 'visible' : 'hidden' }} aria-hidden="true">
                <span className={a.foilCrest} />
                <span className={a.foilTitle}>אלבום העיצובים</span>
                <span className={a.foilRule} />
              </div>
            </div>
          </div>
          <div className={a.copy}>
            <p className={a.eyebrow}>אלבום העיצובים</p>
            <h1 className={a.title}>{TITLE}</h1>
            <p className={a.lead}>{LEAD}</p>
            <div className={a.actions}>
              <button type="button" className={a.cta} onClick={openBook} disabled={!spreads}>
                פתחו את האלבום <span aria-hidden="true">←</span>
              </button>
              <Link className={a.secondary} href="/#cats">
                לכל העיצובים
              </Link>
            </div>
          </div>
        </div>

        {/* ── the album open ── */}
        <div className={a.book} aria-hidden={!open} inert={!open}>
          <div
            className={`${a.plate} ${a.bookPlate}`}
            data-side={side}
            style={{ perspective: '2600px' } as CSSProperties}
          >
            <img
              className={a.photo}
              src="/album/open.webp"
              srcSet="/album/open-1280.webp 1280w, /album/open.webp 2304w"
              sizes="(max-width: 700px) 293vw, max(100vw, 178svh)"
              alt=""
              loading="lazy"
            />
            {spreads && leftPage && rightPage && (
              <>
                <Sheet box={PAGES.right}>{renderPage(rightPage, 'right')}</Sheet>
                <Sheet box={PAGES.left}>{renderPage(leftPage, 'left')}</Sheet>
              </>
            )}
            {turn && leafBox && shown && target && (
              <div
                ref={leafRef}
                className={a.leaf}
                style={{ ...boxStyle(leafBox), transformOrigin: turn.forward ? 'right center' : 'left center' }}
                aria-hidden="true"
              >
                <div className={a.face} style={paperOf(leafBox)}>
                  {renderPage(turn.forward ? shown.left : shown.right, turn.forward ? 'left' : 'right')}
                  <span className={a.shade} data-shade="front" />
                </div>
                <div className={`${a.face} ${a.back}`} style={paperOf(turn.forward ? PAGES.right : PAGES.left)}>
                  {renderPage(turn.forward ? target.right : target.left, turn.forward ? 'right' : 'left')}
                  <span className={a.shade} data-shade="back" />
                </div>
              </div>
            )}
          </div>

          <div className={a.controls}>
            <button type="button" className={a.round} onClick={prev} disabled={!!turn} aria-label={spread === 0 && (!narrow || side === 'right') ? 'סגירת האלבום' : 'לעמוד הקודם'}>
              →
            </button>
            <span className={a.place} aria-live="polite">
              {spreads?.[turn?.to ?? spread]?.title}
            </span>
            <button type="button" className={a.round} onClick={next} disabled={!!turn || !canNext} aria-label="לעמוד הבא">
              ←
            </button>
            <span className={a.divider} aria-hidden="true" />
            <button type="button" className={a.textButton} onClick={close}>
              סגירה
            </button>
            <button type="button" className={a.textButton} onClick={toggleSound} aria-pressed={sound} aria-label={sound ? 'צליל דפים: פועל' : 'צליל דפים: כבוי'}>
              {sound ? '♪ פועל' : '♪ כבוי'}
            </button>
          </div>
        </div>

        {error && (
          <p className={a.error} role="alert">
            {error}
          </p>
        )}
      </section>
      <SiteFooter />
    </div>
  );
}

type Box = { x: number; y: number; w: number; h: number };
const boxStyle = (b: Box): CSSProperties => ({ left: `${b.x}%`, top: `${b.y}%`, width: `${b.w}%`, height: `${b.h}%` });
/** the photograph's own paper under a turning sheet: the crop of the page it came from */
const paperOf = (b: Box): CSSProperties => ({
  backgroundImage: 'url(/album/open.webp)',
  backgroundSize: `${(100 / b.w) * 100}% ${(100 / b.h) * 100}%`,
  backgroundPosition: `${(b.x / (100 - b.w)) * 100}% ${(b.y / (100 - b.h)) * 100}%`,
});

function Sheet({ box, children }: { box: Box; children: React.ReactNode }) {
  return (
    <div className={a.page} style={boxStyle(box)}>
      {children}
    </div>
  );
}

/** one page's type and prints, sized to the page (its width is the unit: cqw) */
function PageContent({
  page,
  side,
  chapters,
  onChapter,
  onDesign,
}: {
  page: AlbumPage;
  side: Side;
  chapters: AlbumChapter[];
  onChapter: (id: string) => void;
  onDesign: (design: AlbumDesign, img: HTMLImageElement | null) => void;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const inner = (children: React.ReactNode, kind: string) => (
    <div className={a.pageInner} data-side={side} data-kind={kind}>
      {children}
    </div>
  );
  switch (page.type) {
    case 'title':
      return inner(
        <>
          <span className={a.pageCrest} aria-hidden="true" />
          <p className={a.pageEyebrow}>אלבום העיצובים</p>
          <h2 className={a.pageTitle}>{TITLE}</h2>
          <p className={a.pageLead}>בכל פרק סוג אחר של שמחה. בוחרים עיצוב, ממלאים את הפרטים ומורידים.</p>
        </>,
        'title',
      );
    case 'contents':
      return inner(
        <>
          <p className={a.pageEyebrow}>תוכן העניינים</p>
          <ol className={a.toc}>
            {chapters.map((c, i) => (
              <li key={c.id}>
                <button type="button" onClick={() => onChapter(c.id)}>
                  <span className={a.tocLetter}>{LETTERS[i]}</span>
                  <span className={a.tocName}>{c.name}</span>
                  <span className={a.tocLead}>{c.lead}</span>
                </button>
              </li>
            ))}
          </ol>
        </>,
        'contents',
      );
    case 'opener':
      return inner(
        <>
          <p className={a.pageEyebrow}>פרק {page.letter}</p>
          {page.chapter.image && <img className={a.print} src={page.chapter.image} alt="" />}
          <h2 className={a.pageTitle}>{page.chapter.name}</h2>
          <p className={a.pageLead}>{page.chapter.lead}</p>
          <Link className={a.pageLink} href={page.chapter.href}>
            {page.chapter.cta}
          </Link>
        </>,
        'opener',
      );
    case 'design':
      return inner(
        <button type="button" className={a.design} onClick={() => onDesign(page.design, imgRef.current)}>
          <img ref={imgRef} className={a.designPrint} src={page.design.image} alt={page.design.name} />
          <span className={a.designName}>{page.design.name}</span>
          <span className={a.designGo}>לעיצוב הזה ←</span>
        </button>,
        'design',
      );
    case 'kinds':
      return inner(
        <>
          <p className={a.pageEyebrow}>{page.chapter.name}</p>
          <h2 className={a.pageHeading}>כל סוגי הכרטיסים בפרק</h2>
          <ul className={a.kinds}>
            {page.chapter.kinds.map((k) => (
              <li key={k.name}>
                <Link href={k.href}>
                  <span>{k.name}</span>
                  {k.count != null && <span className={a.kindCount}>{k.count === 1 ? 'עיצוב אחד' : `${k.count} עיצובים`}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </>,
        'kinds',
      );
    case 'end':
      return inner(
        <>
          <span className={a.pageCrest} aria-hidden="true" />
          <h2 className={a.pageHeading}>לא מצאתם?</h2>
          <p className={a.pageLead}>כל העיצובים מחכים לפי סוג השמחה.</p>
          <Link className={a.pageLink} href="/#cats">
            לכל העיצובים ←
          </Link>
        </>,
        'end',
      );
    default:
      return inner(null, 'blank');
  }
}
