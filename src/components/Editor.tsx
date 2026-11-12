'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Stage, Layer, Rect, Text, Shape, Group, Line, Image as KImage, Transformer } from 'react-konva';
import useImage from 'use-image';
import type Konva from 'konva';
import { checkAd, type AdIssue } from '@/lib/adCheck';
import { AD_FORMATS, formatOfPage, MEDIUM_LABEL, type AdMedium } from '@/lib/adFormats';
import { placePhoto } from '@/lib/adText';
import { BRAND_COLOR_ROLES, BRAND_TEXT_ROLES, isBrandColorRole, isBrandTextRole } from '@/lib/brand';
import { CUSTOMER_FONTS, FONTS, MAX_OWN_TEXTS, MAX_STICKERS, PAGE_PRESETS } from '@/lib/canvas';
import { categoryHref, LOGO_TOPIC, type Audience } from '@/lib/categories';
import { loadUploadedFonts, type UploadedFont } from '@/lib/fontsClient';
import { applyProducts, hasProducts } from '@/lib/products';
import { SHABBAT_TOPIC } from '@/lib/shabbatDoc';
import { jpegToPdf } from '@/lib/pdf';
import { formatPrice } from '@/lib/price';
import { professionOf } from '@/lib/professions';
import { VIDEO_WIDTH } from '@/lib/shabbatLoops';
import { trimTransparent } from '@/lib/trimCanvas';
import { DIVIDERS, newDivider, newImage, newRect, newText, type DividerKind } from '@/lib/elements';
import { fitDocColors } from '@/lib/fitColor';
import { cardPixels, type DrawableDoc } from '@/lib/renderCard';
import { placeSticker } from '@/lib/sticker';
import { applyWording, type Wording } from '@/lib/wording';
import { applyBackdrop, type Backdrop } from '@/lib/backdrop';
import { ARC_LIMIT, arcBox, drawArc, hasArc } from '@/lib/arcText';
import { describeChange } from '@/lib/historyLabel';
import { cropOf, LINE_HEIGHT, maskPath, pageLook, shapeLook, textLook } from '@/lib/nodeStyle';
import { intersects, linesOf, snapBox, unionOf, type Box, type Mark } from '@/lib/snap';
import { PhotoPicker } from './PhotoPicker';
import { ProductPicker } from './ProductPicker';
import { StickerPicker } from './StickerPicker';
import { useToast } from './Toast';
import { AgentPanel } from './AgentPanel';
import { WordingPicker } from './WordingPicker';
import { BackdropPicker } from './BackdropPicker';
import { EditorRulers } from './EditorRulers';
import { FontPicker } from './FontPicker';
import { InlineTextEditor } from './InlineTextEditor';
import { LayersPanel } from './LayersPanel';
import { TextStylesPicker } from './TextStylesPicker';
import { landCard } from './CardFlight';
import { setDoor } from './SiteBackdrop';
import { DownloadIcon, FitIcon, RedoIcon, UndoIcon } from './Icons';
import type { CanvasDoc, CanvasElement, Category, ImageAsset, ImageElement, Project, TextElement } from '@/lib/types';

const PX = 3; // canvas pixels per mm at zoom 1
/** how far inside the page's edge the safe area line runs, in mm: a print shop's cut can wander this much */
const SAFE_MM = 4;
type WorkTab = 'details' | 'wordings' | 'backdrops' | 'stickers' | 'agent';
/** the rail's icons beside a private card (24-unit stroke paths) */
const TAB_ICON: Record<WorkTab, string> = {
  details: 'M4 5h16M4 10h16M4 15h10M4 20h7',
  wordings: 'M6 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM9 7h6M8 11h8M10 14h4M9 17h6',
  backdrops: 'M4 4h16v16H4zM4 12h8v8M12 4v8h8',
  stickers: 'M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6-5.3-3-5.3 3 1.2-6L3.4 9.3l6-.7z',
  agent: 'M12 3c.8 4.6 3.4 7.2 8 8-4.6.8-7.2 3.4-8 8-.8-4.6-3.4-7.2-8-8 4.6-.8 7.2-3.4 8-8z',
};
const PT_TO_MM = 25.4 / 72;
const HISTORY_LIMIT = 100;
/** Quick colour choices for customers (the site palette plus black and white). */
const BG_SWATCHES = ['#FAF8F3', '#FFFFFF', '#E4ECE3', '#DCE7DA', '#2F5D46', '#1F3A2E', '#C9A24B', '#1B1F1C'];
const SWATCHES = ['#1F3A2E', '#2F5D46', '#C9A24B', '#FAF8F3', '#1B1F1C'];

type SaveState = 'saved' | 'saving' | 'dirty' | 'error';
type Billing = { allowed: true } | { allowed: false; price: number; seriesPrice: number | null; subscriptionPrice: number };

/** the editor's words, by the door the design came through */
const WORDS = {
  private: {
    download: 'הורדת הכרטיס',
    downloaded: 'הכרטיס הורד למחשב',
    panelLabel: 'פרטי הכרטיס',
    panelTitle: 'הפרטים בכרטיס',
    panelLead: 'ממלאים, בוחרים צבע, וזהו. הכרטיס מתעדכן מולכם.',
    tip: 'טיפ: לחצו על טקסט בכרטיס כדי לערוך אותו, וגררו אותו כדי להזיז. הצבעים נמצאים ליד כל שדה.',
    drag: 'אפשר לגרור כל טקסט בכרטיס כדי לשנות את מיקומו.',
    foot: 'שינויים נשמרים אוטומטית. כשמסיימים אפשר להוריד את הכרטיס כקובץ תמונה.',
    working: 'העוזר מעצב את הכרטיס…',
    placeholder: 'למשל: החתונה של דן ונועה, 12 במאי, אולם הגן',
    suggestions: ['נסחו לי הזמנה חגיגית', 'כל הטקסטים בזהב', 'קצרו את הנוסח'],
  },
  business: {
    download: 'הורדת המודעה',
    downloaded: 'המודעה הורדה למחשב. עכשיו אפשר לשלוח אותה למי שרוצים.',
    panelLabel: 'פרטי המודעה',
    panelTitle: 'הפרטים במודעה',
    panelLead: 'הפרטים של העסק כבר בפנים. מחדדים את המסר, מורידים ושולחים למי שרוצים.',
    tip: 'טיפ: לחצו על טקסט במודעה כדי לערוך אותו, וגררו אותו כדי להזיז. הצבעים נמצאים ליד כל שדה.',
    drag: 'אפשר לגרור כל טקסט במודעה כדי לשנות את מיקומו.',
    foot: 'שינויים נשמרים אוטומטית. כשמסיימים מורידים את המודעה כקובץ תמונה ושולחים אותה בעצמכם.',
    working: 'העוזר עובד על המודעה…',
    placeholder: 'למשל: מבצע לשבוע הקרוב, ניקוי מזגן לפני הקיץ',
    suggestions: ['תציע לי שלושה כיוונים למודעה'],
  },
} satisfies Record<Audience, unknown>;

/** the business's buttons in the assistant: what they want from the ad, in their words */
const AD_INTENTS = [
  { label: 'כותרת חזקה יותר', prompt: 'כתוב כותרת קצרה וחזקה יותר למודעה, על בסיס מה שכבר כתוב בה. שנה רק את הכותרת.' },
  { label: 'לקצר', prompt: 'קצר את הטקסטים במודעה ככל שאפשר, בלי לאבד את המסר ובלי לשנות את פרטי העסק.' },
  { label: 'יותר יוקרתי', prompt: 'נסח מחדש את הטקסטים במודעה בטון יוקרתי ומכובד יותר. בלי להוסיף עובדות חדשות, ובלי לשנות את פרטי העסק.' },
  { label: 'יותר חם ואישי', prompt: 'נסח מחדש את הטקסטים במודעה בטון חם ואישי יותר. בלי להוסיף עובדות חדשות, ובלי לשנות את פרטי העסק.' },
  { label: 'קריאה לפעולה ברורה', prompt: 'כתוב קריאה לפעולה ברורה וקצרה יותר: מה בדיוק הקורא צריך לעשות. שנה רק את הקריאה לפעולה.' },
];

const normalize = (els: CanvasElement[]): CanvasElement[] => els.map((e, i) => ({ ...e, z: i }));
const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));

function ImageNode({
  el,
  asset,
  interactive,
  onSelect,
  onChange,
}: {
  el: Extract<CanvasElement, { type: 'image' }>;
  asset: ImageAsset | undefined;
  interactive: boolean;
  onSelect: (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onChange: (patch: Partial<CanvasElement>) => void;
}) {
  const [img, status] = useImage(asset ? `/api/uploads/${asset.file}` : '');
  const w = el.w_mm * PX;
  const h = el.h_mm * PX;
  const common = {
    id: el.id,
    x: el.x_mm * PX,
    y: el.y_mm * PX,
    width: w,
    height: h,
    rotation: el.rotation,
    draggable: interactive,
    listening: interactive || !el.locked,
    onMouseDown: interactive ? onSelect : undefined,
    onTap: interactive ? onSelect : undefined,
    // a drag ends in the layer, which also moves the rest of the selection (see onLayerDragEnd)
    onTransformEnd: (e: Konva.KonvaEventObject<Event>) => {
      const n = e.target;
      const nw = n.width() * n.scaleX();
      const nh = n.height() * n.scaleY();
      n.scaleX(1);
      n.scaleY(1);
      onChange({ x_mm: n.x() / PX, y_mm: n.y() / PX, w_mm: nw / PX, h_mm: nh / PX, rotation: n.rotation() });
    },
  };
  let face: React.ReactNode;
  if (el.colorOverride) face = <Rect width={w} height={h} fill={el.colorOverride} />;
  else if (!asset || status === 'failed') face = <Rect width={w} height={h} fill="#f0e6e4" stroke="#a33a2e" strokeWidth={2} dash={[10, 6]} />;
  else if (!img) face = <Rect width={w} height={h} fill="rgba(0,0,0,0)" />;
  else face = <KImage width={w} height={h} image={img} crop={cropOf(el, img.naturalWidth, img.naturalHeight)} />;
  const mask = el.mask;
  return (
    <Group {...common} clipFunc={mask ? (ctx) => maskPath(ctx._context, mask, w, h) : undefined}>
      {face}
    </Group>
  );
}

export default function Editor({ id }: { id: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [canAgent, setCanAgent] = useState(false);
  const [pubStatus, setPubStatus] = useState<'draft' | 'published'>('draft');
  const [pubBusy, setPubBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [topic, setTopic] = useState<string | null>(null);
  const [audience, setAudience] = useState<Audience>('private');
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoSaved, setLogoSaved] = useState(false);
  const [billing, setBilling] = useState<Billing>({ allowed: true });
  const [paywall, setPaywall] = useState(false);
  const [payBusy, setPayBusy] = useState(false);
  const [outOfDate, setOutOfDate] = useState(false);
  const [hasVideo, setHasVideo] = useState(false);
  const [videoBusy, setVideoBusy] = useState(false);
  const [gifBusy, setGifBusy] = useState(false);
  const [zipBusy, setZipBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [sizes, setSizes] = useState<string[]>([]);
  const [resizing, setResizing] = useState(false);
  const [issues, setIssues] = useState<AdIssue[]>([]);
  /** the download the business asked for, waiting while the ad check's findings are on the screen */
  const [pending, setPending] = useState<(() => void) | null>(null);
  const [activeField, setActiveField] = useState<string | null>(null);
  const [hintOpen, setHintOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiTouched, setAiTouched] = useState<Set<string>>(new Set());
  const aiTimer = useRef<number | undefined>(undefined);
  const { push } = useToast();
  const fieldRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const [doc, setDoc] = useState<CanvasDoc | null>(null);
  const [name, setName] = useState('');
  const [selectedId, setPrimary] = useState<string | null>(null);
  /** the rest of a selection of several elements; `selectedId` is the one the side panel shows */
  const [multi, setMulti] = useState<string[]>([]);
  const setSelectedId = useCallback((id: string | null) => {
    setPrimary(id);
    setMulti([]);
  }, []);
  /** lines drawn while a dragged element snaps, and the frame of a drag-to-select */
  const [snapMarks, setSnapMarks] = useState<Mark[]>([]);
  const [marquee, setMarquee] = useState<Box | null>(null);
  /** the author's guides, in mm from the page's left and top edges; kept in this browser for this card */
  const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] });
  const [showSafe, setShowSafe] = useState(true);
  /** the text being written straight on the card */
  const [editingId, setEditingId] = useState<string | null>(null);
  /** an author looking at the card as a customer will */
  const [preview, setPreview] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const layerRef = useRef<Konva.Layer>(null);
  const overlayRef = useRef<Konva.Layer>(null);
  const dragRef = useRef<{ id: string; start: { x: number; y: number }; others: { node: Konva.Node; x: number; y: number }[]; lines: { x: number[]; y: number[] }; boxes: Box[] } | null>(null);
  const marqueeStart = useRef<{ x: number; y: number; add: boolean } | null>(null);
  const spaceDown = useRef(false);
  const [library, setLibrary] = useState<{ categories: Category[]; images: ImageAsset[] }>({ categories: [], images: [] });
  const [libCat, setLibCat] = useState<string>('');
  const [zoomOverride, setZoomOverride] = useState<number | null>(null);
  const [fit, setFit] = useState(0.5);
  /** the canvas has its real fitted size (not the 0.5 placeholder) */
  const [fitted, setFitted] = useState(false);
  const [save, setSave] = useState<SaveState>('saved');
  const [loadError, setLoadError] = useState('');
  const [fontsTick, setFontsTick] = useState(0);
  const [uploadedFonts, setUploadedFonts] = useState<UploadedFont[]>([]);
  const [kept, setKept] = useState(false);
  const [keepBusy, setKeepBusy] = useState(false);
  /** the wordings and backdrops a customer can move between inside a private card (see looks.ts) */
  const [looks, setLooks] = useState<{ wordings: Wording[]; backdrops: Backdrop[] } | null>(null);
  /** a private card's open library beside it; on a phone 'details' is the form, a tab like the others */
  const [tab, setTab] = useState<WorkTab>('details');

  const stageRef = useRef<Konva.Stage>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const pageRef = useRef<Konva.Rect>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const lastMerge = useRef<{ key: string; at: number } | null>(null);
  const loadedRef = useRef(false);

  // ---- loading -------------------------------------------------------------
  useEffect(() => {
    (async () => {
      try {
        const [pRes, lRes] = await Promise.all([fetch(`/api/projects/${id}`), fetch('/api/library')]);
        if (!pRes.ok) throw new Error(pRes.status === 404 ? 'העיצוב לא נמצא' : 'טעינת העיצוב נכשלה');
        const p: Project & { canManage: boolean; canAgent: boolean; topic: string | null; audience: Audience; billing: Billing; shabbatOutOfDate: boolean; hasVideo: boolean; sizes: string[] } = await pRes.json();
        setSizes(p.sizes);
        setBilling(p.billing);
        setOutOfDate(p.shabbatOutOfDate);
        setHasVideo(p.hasVideo);
        setTopic(p.topic);
        setAudience(p.audience);
        setCanManage(p.canManage);
        setCanAgent(p.canAgent);
        setPubStatus(p.status);
        setKept(!!p.keep);
        const lib = await lRes.json();
        setProject(p);
        setDoc(p.canvas);
        setName(p.name);
        setLibrary(lib);
        setLibCat(lib.categories[0]?.id ?? '');
        loadedRef.current = true;
        // a project that was never saved has no preview image yet: the autosave creates one
        if (!p.thumbnail && (p.canManage || p.kind === 'design')) setSave('dirty');
      } catch (e) {
        setLoadError((e as Error).message);
      }
    })();
  }, [id]);

  const looksFor = project?.kind === 'design' && !canManage && audience === 'private' ? project.id : null;
  useEffect(() => {
    if (!looksFor) return;
    let alive = true;
    fetch(`/api/projects/${looksFor}/looks`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((l) => alive && setLooks(l));
    return () => {
      alive = false;
    };
  }, [looksFor]);

  // a business's ad takes that door's look, around the editor too
  useEffect(() => {
    setDoor(audience);
    return () => setDoor(null);
  }, [audience]);

  useEffect(() => {
    try {
      const g = JSON.parse(localStorage.getItem('guides:' + id) ?? 'null');
      if (g && Array.isArray(g.x) && Array.isArray(g.y)) setGuides(g);
    } catch {}
  }, [id]);
  const keepGuides = (g: { x: number[]; y: number[] }) => {
    setGuides(g);
    try {
      localStorage.setItem('guides:' + id, JSON.stringify(g));
    } catch {}
  };

  useEffect(() => {
    try {
      setHintOpen(localStorage.getItem('hint-editor-v1') !== '1');
    } catch {
      setHintOpen(true);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    const loads = FONTS.flatMap((f) => [`400 16px "${f}"`, `700 16px "${f}"`].map((s) => document.fonts.load(s, 'אבגabc')));
    Promise.allSettled([...loads, loadUploadedFonts().then((list) => alive && setUploadedFonts(list))]).then(() => alive && setFontsTick((n) => n + 1));
    return () => {
      alive = false;
    };
  }, []);

  // ---- the ad check --------------------------------------------------------
  const adDesign = audience === 'business' && !canManage && topic !== LOGO_TOPIC && topic !== SHABBAT_TOPIC;
  useEffect(() => {
    if (!adDesign || !doc) return;
    // after the canvas drew the change: the check reads the real height of each text from it
    const t = window.setTimeout(() => {
      const stage = stageRef.current;
      const measured: Record<string, number> = {};
      for (const e of doc.elements) {
        const node = e.type === 'text' ? stage?.findOne('#' + e.id) : null;
        if (node) measured[e.id] = node.height() / PX;
      }
      setIssues(checkAd(doc, { risky: professionOf(topic)?.risky, measured }));
    }, 300);
    return () => window.clearTimeout(t);
  }, [adDesign, doc, topic, fontsTick]);

  // ---- fit zoom ------------------------------------------------------------
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || !doc) return;
    const calc = () => {
      const w = el.clientWidth - 48;
      const h = el.clientHeight - 48;
      setFit(clamp(Math.min(w / (doc.page.width_mm * PX), h / (doc.page.height_mm * PX)), 0.1, 3));
      setFitted(true);
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    return () => ro.disconnect();
  }, [doc?.page.width_mm, doc?.page.height_mm, !!doc, preview, canManage, audience]); // eslint-disable-line react-hooks/exhaustive-deps

  const zoom = zoomOverride ?? fit;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const fitRef = useRef(fit);
  fitRef.current = fit;

  // a card flying in from the home page lands on the canvas once it has its fitted size and its pictures
  // (otherwise the flying card fades into a bare canvas); see CardFlight. Runs once, when the editor opens.
  useEffect(() => {
    if (loadError) {
      landCard(null);
      return;
    }
    if (!fitted || !doc) return;
    let alive = true;
    const files = doc.elements.flatMap((e) => (e.type === 'image' ? library.images.filter((i) => i.id === e.asset_id).map((i) => i.file) : []));
    const loads = files.map((f) => {
      const img = new Image();
      img.src = `/api/uploads/${f}`;
      return img.decode().catch(() => {});
    });
    // a slow picture does not hold the card in the air for long
    Promise.race([Promise.all(loads), new Promise((r) => setTimeout(r, 2500))]).then(() =>
      requestAnimationFrame(() => alive && landCard(wrapRef.current?.querySelector('.stage-frame')?.getBoundingClientRect() ?? null)),
    );
    return () => {
      alive = false;
    };
  }, [fitted, loadError]); // eslint-disable-line react-hooks/exhaustive-deps

  const isWording = project?.kind === 'wording';

  // ---- history-aware updates ----------------------------------------------
  // The current doc and the undo/redo stacks live in refs so updates stay free of
  // side effects inside state updaters; `setDoc` just triggers the re-render.
  const docRef = useRef<CanvasDoc | null>(null);
  /** each card kept for undo, with how it was reached ("הזזה: כותרת"); the current card's is in `labelRef` */
  const pastRef = useRef<{ doc: CanvasDoc; label: string }[]>([]);
  const futureRef = useRef<{ doc: CanvasDoc; label: string }[]>([]);
  const labelRef = useRef('פתיחת העיצוב');
  const [, bump] = useState(0);
  docRef.current = doc;

  const commit = useCallback((next: CanvasDoc, mergeKey?: string) => {
    const cur = docRef.current;
    if (cur) {
      const now = Date.now();
      const merge = !!mergeKey && lastMerge.current?.key === mergeKey && now - lastMerge.current.at < 1000;
      lastMerge.current = mergeKey ? { key: mergeKey, at: now } : null;
      if (!merge) {
        pastRef.current = [...pastRef.current.slice(-(HISTORY_LIMIT - 1)), { doc: cur, label: labelRef.current }];
        labelRef.current = describeChange(cur, next);
      } else {
        labelRef.current = describeChange(pastRef.current[pastRef.current.length - 1]?.doc ?? cur, next);
      }
      futureRef.current = [];
    }
    docRef.current = next;
    setDoc(next);
    setSave('dirty');
    bump((n) => n + 1);
  }, []);

  /** Applies the assistant's card and briefly marks every element it touched. */
  const applyAgent = useCallback(
    (next: CanvasDoc) => {
      const before = new Map(docRef.current?.elements.map((e) => [e.id, JSON.stringify(e)]));
      const changed = new Set(next.elements.filter((e) => before.get(e.id) !== JSON.stringify(e)).map((e) => e.id));
      commit(next);
      setAiTouched(changed);
      window.clearTimeout(aiTimer.current);
      aiTimer.current = window.setTimeout(() => setAiTouched(new Set()), 2800);
      return changed.size;
    },
    [commit],
  );

  const patchElement = useCallback(
    (elId: string, patch: Partial<CanvasElement>, mergeKey?: string) => {
      const cur = docRef.current;
      if (!cur) return;
      commit({ ...cur, elements: cur.elements.map((e) => (e.id === elId ? ({ ...e, ...patch } as CanvasElement) : e)) }, mergeKey);
    },
    [commit],
  );

  /** the card as renderCard draws it: each picture with its URL */
  const drawable = (d: CanvasDoc): DrawableDoc => ({
    ...d,
    elements: d.elements.map((e) => {
      if (e.type !== 'image') return e;
      const asset = library.images.find((i) => i.id === e.asset_id);
      return { ...e, src: asset ? `/api/uploads/${asset.file}` : null };
    }),
  });

  const fitSeq = useRef(0);
  /**
   * A change to what is under a wording's texts, or to the wording itself: its colours follow, in one undo step. Finding them
   * takes a moment, so the change is applied again to the card as it stands by then, and only the last change counts.
   */
  const commitFitted = async (change: (d: CanvasDoc) => CanvasDoc, mergeKey?: string) => {
    const cur = docRef.current;
    if (!cur) return;
    const draft = change(cur);
    if (!draft.elements.some((e) => e.type === 'text' && e.designColor)) {
      commit(draft, mergeKey);
      return;
    }
    const seq = ++fitSeq.current;
    const fitted = await cardPixels(drawable(draft)).then((px) => fitDocColors(draft, px)).catch((e) => {
      console.error('could not match the colours', e);
      return draft;
    });
    if (seq !== fitSeq.current || !docRef.current) return;
    const colors = new Map(fitted.elements.flatMap((e) => (e.type === 'text' ? [[e.id, e.font.color] as const] : [])));
    const now = change(docRef.current);
    commit(
      { ...now, elements: now.elements.map((e) => (e.type === 'text' && colors.has(e.id) ? { ...e, font: { ...e.font, color: colors.get(e.id)! } } : e)) },
      mergeKey,
    );
  };

  /** a change to a background the customer can swap */
  const patchBackground = (elId: string, patch: Partial<CanvasElement>, mergeKey?: string) =>
    commitFitted((d) => ({ ...d, elements: d.elements.map((e) => (e.id === elId ? ({ ...e, ...patch } as CanvasElement) : e)) }), mergeKey);

  const pickWording = (w: Wording) => {
    setSelectedId(null);
    setActiveField(null);
    return commitFitted((d) => applyWording(d, w));
  };

  const pickBackdrop = (b: Backdrop, mergeKey?: string) => commitFitted((d) => applyBackdrop(d, b), mergeKey);

  const undo = useCallback(() => {
    const cur = docRef.current;
    const prev = pastRef.current[pastRef.current.length - 1];
    if (!cur || !prev) return;
    pastRef.current = pastRef.current.slice(0, -1);
    futureRef.current = [{ doc: cur, label: labelRef.current }, ...futureRef.current];
    labelRef.current = prev.label;
    lastMerge.current = null;
    docRef.current = prev.doc;
    setDoc(prev.doc);
    setSave('dirty');
    bump((n) => n + 1);
  }, []);

  const redo = useCallback(() => {
    const cur = docRef.current;
    const next = futureRef.current[0];
    if (!cur || !next) return;
    futureRef.current = futureRef.current.slice(1);
    pastRef.current = [...pastRef.current, { doc: cur, label: labelRef.current }];
    labelRef.current = next.label;
    lastMerge.current = null;
    docRef.current = next.doc;
    setDoc(next.doc);
    setSave('dirty');
    bump((n) => n + 1);
  }, []);

  /** goes straight to a step of the history list: `index` counts the kept steps, then the current card, then those undone */
  const jumpTo = (index: number) => {
    const cur = docRef.current;
    if (!cur) return;
    const steps = [...pastRef.current, { doc: cur, label: labelRef.current }, ...futureRef.current];
    const step = steps[index];
    if (!step) return;
    pastRef.current = steps.slice(0, index);
    futureRef.current = steps.slice(index + 1);
    labelRef.current = step.label;
    lastMerge.current = null;
    docRef.current = step.doc;
    setDoc(step.doc);
    setSave('dirty');
    bump((n) => n + 1);
    setHistoryOpen(false);
  };

  /**
   * The server answers 401, 403 or 404 when the browser is no longer signed in as the one who opened the card: an
   * author whose sign-in went (signed out, another address such as 127.0.0.1, a cleared cookie) works on as a guest.
   */
  const lostAccess = (status: number) =>
    status === 401 || status === 403 || status === 404
      ? canManage
        ? 'הדפדפן כבר לא מחובר כמנהל, ולכן אי אפשר לשמור או לפרסם. התחברו שוב כמנהל באותה כתובת, ואז נסו שוב.'
        : 'הדפדפן כבר לא מחובר לחשבון שפתח את העיצוב. התחברו שוב ונסו שוב.'
      : null;

  // ---- autosave --------------------------------------------------------------
  const nameRef = useRef(name);
  nameRef.current = name;
  useEffect(() => {
    if (!loadedRef.current || save !== 'dirty' || !doc) return;
    const t = setTimeout(async () => {
      setSave('saving');
      try {
        const res = await fetch(`/api/projects/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ canvas: doc, name: nameRef.current || 'עיצוב ללא שם', thumbnail: makeThumb() }),
        });
        if (!res.ok) throw new Error(lostAccess(res.status) ?? undefined);
        // a newer edit may have arrived while saving; only mark saved if nothing changed
        setSave((s) => (s === 'saving' ? 'saved' : s));
      } catch (e) {
        setSave('error');
        push((e as Error).message || 'השמירה נכשלה. בדקו את החיבור ונסו שוב.', 'error');
      }
    }, 1200);
    return () => clearTimeout(t);
  }, [doc, name, save, id]);

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (save === 'dirty' || save === 'saving' || save === 'error') e.preventDefault();
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [save]);

  // ---- actions -----------------------------------------------------------------
  const selected = doc?.elements.find((e) => e.id === selectedId) ?? null;
  const assetById = useMemo(() => new Map(library.images.map((i) => [i.id, i])), [library.images]);

  const addElement = (el: CanvasElement) => {
    const doc = docRef.current;
    if (!doc) return;
    commit({ ...doc, elements: normalize([...doc.elements, el]) });
    setSelectedId(el.id);
  };

  const addText = () => {
    const doc = docRef.current;
    if (doc) addElement(newText(doc));
  };

  const addRect = () => {
    const doc = docRef.current;
    if (doc) addElement(newRect(doc));
  };

  const addImage = (asset: ImageAsset) => {
    const doc = docRef.current;
    if (doc) addElement(newImage(doc, asset));
  };

  /** everything selected, the panel's element first */
  const selIds = useMemo(() => (selectedId ? [selectedId, ...multi.filter((m) => m !== selectedId)] : []), [selectedId, multi]);

  /** the element and the rest of its group: they are selected together */
  const withGroup = (id: string) => {
    const els = docRef.current?.elements ?? [];
    const g = els.find((e) => e.id === id)?.group;
    return g ? els.filter((e) => e.group === g).map((e) => e.id) : [id];
  };

  /** A click on an element: it alone (with its group), or added to the selection with Shift. A click on one already in a selection keeps it, so all of it can be dragged. */
  const selectEl = (id: string, add: boolean) => {
    const ids = withGroup(id);
    if (add) {
      const all = ids.every((x) => selIds.includes(x));
      const next = all ? selIds.filter((x) => !ids.includes(x)) : [...selIds, ...ids.filter((x) => !selIds.includes(x))];
      setPrimary(next[0] ?? null);
      setMulti(next.slice(1));
      return;
    }
    if (selIds.includes(id)) return;
    setPrimary(id);
    setMulti(ids.filter((x) => x !== id));
  };

  const selectMany = (ids: string[]) => {
    setPrimary(ids[0] ?? null);
    setMulti(ids.slice(1));
  };

  /** one change to several elements, in one undo step */
  const patchMany = (ids: string[], change: (e: CanvasElement) => Partial<CanvasElement>, mergeKey?: string) => {
    const d = docRef.current;
    if (!d || !ids.length) return;
    commit({ ...d, elements: d.elements.map((e) => (ids.includes(e.id) ? ({ ...e, ...change(e) } as CanvasElement) : e)) }, mergeKey);
  };

  const removeSelected = useCallback(() => {
    const doc = docRef.current;
    if (!doc || !selIds.length) return;
    commit({ ...doc, elements: normalize(doc.elements.filter((e) => !selIds.includes(e.id))) });
    setSelectedId(null);
  }, [selIds, commit, setSelectedId]);

  const duplicateSelected = useCallback(() => {
    const doc = docRef.current;
    if (!doc || !selIds.length) return;
    // a copied group is a new group of its own
    const groups = new Map<string, string>();
    const copies = doc.elements
      .filter((e) => selIds.includes(e.id))
      .map((e) => {
        const group = e.group ? (groups.get(e.group) ?? groups.set(e.group, crypto.randomUUID()).get(e.group)) : undefined;
        return { ...e, id: crypto.randomUUID(), x_mm: e.x_mm + 5, y_mm: e.y_mm + 5, ...(group ? { group } : {}) } as CanvasElement;
      });
    commit({ ...doc, elements: normalize([...doc.elements, ...copies]) });
    selectMany(copies.map((c) => c.id));
  }, [selIds, commit]); // eslint-disable-line react-hooks/exhaustive-deps

  const groupSelected = () => {
    if (selIds.length < 2) return;
    const g = crypto.randomUUID();
    patchMany(selIds, () => ({ group: g }));
  };
  const ungroupSelected = () => patchMany(selIds, () => ({ group: undefined }));

  /** the boxes of these elements on the page, in canvas pixels, as drawn (a turned one by its outer box) */
  const boxesOf = (ids: string[]) => {
    const stage = stageRef.current;
    const layer = layerRef.current;
    if (!stage || !layer) return [];
    return ids.flatMap((i) => {
      const n = stage.findOne('#' + i);
      if (!n) return [];
      const r = n.getClientRect({ relativeTo: layer });
      return [{ id: i, box: { x: r.x, y: r.y, w: r.width, h: r.height } }];
    });
  };

  /** lines up the selection: one element with the page, several with the box around them all */
  const alignSel = (how: 'right' | 'hcenter' | 'left' | 'top' | 'vmiddle' | 'bottom') => {
    const items = boxesOf(selIds);
    if (!items.length) return;
    const pageW = (docRef.current?.page.width_mm ?? 0) * PX;
    const pageH = (docRef.current?.page.height_mm ?? 0) * PX;
    const ref = items.length === 1 ? { x: 0, y: 0, w: pageW, h: pageH } : unionOf(items.map((i) => i.box));
    const shift = new Map(
      items.map(({ id: i, box: b }) => {
        const dx = how === 'left' ? ref.x - b.x : how === 'right' ? ref.x + ref.w - (b.x + b.w) : how === 'hcenter' ? ref.x + ref.w / 2 - (b.x + b.w / 2) : 0;
        const dy = how === 'top' ? ref.y - b.y : how === 'bottom' ? ref.y + ref.h - (b.y + b.h) : how === 'vmiddle' ? ref.y + ref.h / 2 - (b.y + b.h / 2) : 0;
        return [i, { dx, dy }];
      }),
    );
    patchMany(selIds, (e) => ({ x_mm: e.x_mm + (shift.get(e.id)?.dx ?? 0) / PX, y_mm: e.y_mm + (shift.get(e.id)?.dy ?? 0) / PX }));
  };

  /** equal gaps between three or more elements, keeping the first and the last where they are */
  const distributeSel = (axis: 'x' | 'y') => {
    const items = boxesOf(selIds);
    if (items.length < 3) return;
    const at = (b: Box) => (axis === 'x' ? b.x : b.y);
    const len = (b: Box) => (axis === 'x' ? b.w : b.h);
    const sorted = [...items].sort((p, q) => at(p.box) - at(q.box));
    const first = sorted[0].box;
    const last = sorted[sorted.length - 1].box;
    const gap = (at(last) + len(last) - at(first) - sorted.reduce((sum, i) => sum + len(i.box), 0)) / (sorted.length - 1);
    let run = at(first);
    const shift = new Map<string, number>();
    for (const i of sorted) {
      shift.set(i.id, run - at(i.box));
      run += len(i.box) + gap;
    }
    patchMany(selIds, (e) => (axis === 'x' ? { x_mm: e.x_mm + (shift.get(e.id) ?? 0) / PX } : { y_mm: e.y_mm + (shift.get(e.id) ?? 0) / PX }));
  };

  const addDivider = (kind: DividerKind) => {
    const d = docRef.current;
    if (!d) return;
    const parts = newDivider(d, kind);
    commit({ ...d, elements: normalize([...d.elements, ...parts]) });
    selectMany(parts.map((x) => x.id));
  };

  /** puts an element at this index of the drawing order (0 is the bottom) */
  const moveTo = (elId: string, index: number) => {
    const d = docRef.current;
    if (!d) return;
    const els = d.elements.filter((e) => e.id !== elId);
    const it = d.elements.find((e) => e.id === elId);
    if (!it) return;
    els.splice(clamp(index, 0, els.length), 0, it);
    commit({ ...d, elements: normalize(els) });
  };

  /** the transformer and the editor's own lines stay out of every picture made of the card */
  const chrome = (on: boolean) => {
    trRef.current?.visible(on);
    overlayRef.current?.visible(on);
  };

  const moveZ = (dir: 'front' | 'back' | 'up' | 'down') => {
    const doc = docRef.current;
    if (!doc || !selectedId) return;
    const els = [...doc.elements];
    const i = els.findIndex((e) => e.id === selectedId);
    if (i < 0) return;
    const [it] = els.splice(i, 1);
    const target = dir === 'front' ? els.length : dir === 'back' ? 0 : dir === 'up' ? Math.min(els.length, i + 1) : Math.max(0, i - 1);
    els.splice(target, 0, it);
    commit({ ...doc, elements: normalize(els) });
  };

  const setPage = (patch: Partial<CanvasDoc['page']>, mergeKey?: string) => {
    const doc = docRef.current;
    if (!doc) return;
    commit({ ...doc, page: { ...doc.page, ...patch } }, mergeKey);
  };

  const makeThumb = (): string | undefined => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    chrome(false);
    stage.draw();
    const url = stage.toDataURL({ pixelRatio: 600 / stage.width(), mimeType: 'image/jpeg', quality: 0.7 });
    chrome(true);
    stage.draw();
    return url;
  };

  const setPublished = async (status: 'draft' | 'published') => {
    const d = docRef.current;
    if (!d) return;
    if (status === 'published') {
      const fields = d.elements.filter((e) => e.type === 'text' && e.editable).length;
      if (fields === 0 && !confirm('בתבנית אין אף שדה טקסט שהלקוח יכול לערוך. לפרסם בכל זאת?')) return;
    }
    setPubBusy(true);
    try {
      // save the latest content together with the status so customers never see a stale template
      const res = await fetch(`/api/projects/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ canvas: d, name: nameRef.current || 'תבנית ללא שם', thumbnail: makeThumb(), status }),
      });
      if (!res.ok) throw new Error(lostAccess(res.status) ?? (await res.json().catch(() => ({}))).error);
      setPubStatus(status);
      setSave((v) => (v === 'dirty' ? v : 'saved'));
      if (isWording) push(status === 'published' ? 'הנוסח פורסם. לקוחות יכולים לבחור בו בעריכת הכרטיס.' : 'הפרסום בוטל. לקוחות כבר לא יכולים לבחור בנוסח הזה.', 'success');
      else push(status === 'published' ? 'התבנית פורסמה. לקוחות רואים אותה עכשיו בגלריה.' : 'הפרסום בוטל. הלקוחות כבר לא רואים את התבנית.', 'success');
    } catch (e) {
      push((e as Error).message || 'הפעולה נכשלה. נסו שוב.', 'error');
    } finally {
      setPubBusy(false);
    }
  };

  /** whether this design may be taken away right now; the server decides, and otherwise the paywall opens */
  const mayDownload = async () => {
    const res = await fetch(`/api/projects/${id}/export`, { method: 'POST' });
    if (res.status === 402) {
      setBilling(await res.json());
      setPaywall(true);
      return false;
    }
    if (!res.ok) throw new Error();
    return true;
  };

  const startPayment = async (kind: 'ad' | 'series' | 'subscription') => {
    setPayBusy(true);
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, projectId: id }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error);
      window.location.href = d.url;
    } catch (e) {
      push((e as Error).message || 'לא הצלחנו לפתוח את התשלום. נסו שוב.', 'error');
      setPayBusy(false);
    }
  };

  const exportPng = async () => {
    const stage = stageRef.current;
    if (!stage || !doc || exporting) return;
    setExporting(true);
    await new Promise((r) => setTimeout(r, 40)); // let the button show its busy state before the heavy render
    try {
      if (!(await mayDownload())) return;
      chrome(false);
      stage.draw();
      const ratio = ((doc.page.width_mm / 25.4) * 300) / stage.width();
      const url = stage.toDataURL({ pixelRatio: ratio, mimeType: 'image/png' });
      chrome(true);
      stage.draw();
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(name || 'עיצוב').replace(/[\\/:*?"<>|]/g, '_')}.png`;
      a.click();
      push(WORDS[audience].downloaded, 'success');
    } catch {
      push('לא הצלחנו להכין את הקובץ. נסו שוב.', 'error');
    } finally {
      setExporting(false);
    }
  };

  /** The design as a video: the server puts the moving background under what is drawn here. */
  const exportVideo = async () => {
    const stage = stageRef.current;
    if (!stage || !doc || videoBusy) return;
    setVideoBusy(true);
    const hidden = doc.elements.flatMap((e) => (e.type === 'image' && e.loopId ? [stage.findOne('#' + e.id)] : []));
    try {
      if (!(await mayDownload())) return;
      chrome(false);
      pageRef.current?.visible(false);
      hidden.forEach((n) => n?.visible(false));
      stage.draw();
      // half a pixel over: the canvas truncates its size, and at most zooms the exact ratio comes out a pixel short of the video
      const overlay = stage.toCanvas({ pixelRatio: (VIDEO_WIDTH + 0.5) / stage.width() });
      chrome(true);
      pageRef.current?.visible(true);
      hidden.forEach((n) => n?.visible(true));
      stage.draw();
      const blob = await new Promise<Blob | null>((r) => overlay.toBlob(r, 'image/png'));
      if (!blob) throw new Error();
      const form = new FormData();
      form.set('overlay', new File([blob], 'overlay.png', { type: 'image/png' }));
      const res = await fetch(`/api/projects/${id}/video`, { method: 'POST', body: form });
      if (res.status === 402) {
        setBilling(await res.json());
        setPaywall(true);
        return;
      }
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(await res.blob());
      a.download = `${(name || 'עיצוב').replace(/[\\/:*?"<>|]/g, '_')}.mp4`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      push('הסרטון הורד למחשב. עכשיו אפשר להעלות אותו לסטטוס.', 'success');
    } catch (e) {
      push((e as Error).message || 'הכנת הסרטון נכשלה. נסו שוב.', 'error');
    } finally {
      setVideoBusy(false);
    }
  };

  /** The design as an animated GIF: Shabbat designs get the moving background; business ads get a fade-in/out. */
  const exportGif = async () => {
    const stage = stageRef.current;
    if (!stage || !doc || gifBusy) return;
    setGifBusy(true);
    const hidden = doc.elements.flatMap((e) => (e.type === 'image' && e.loopId ? [stage.findOne('#' + e.id)] : []));
    try {
      if (!(await mayDownload())) return;
      chrome(false);
      pageRef.current?.visible(false);
      hidden.forEach((n) => n?.visible(false));
      stage.draw();
      const overlay = stage.toCanvas({ pixelRatio: (VIDEO_WIDTH + 0.5) / stage.width() });
      chrome(true);
      pageRef.current?.visible(true);
      hidden.forEach((n) => n?.visible(true));
      stage.draw();
      const blob = await new Promise<Blob | null>((r) => overlay.toBlob(r, 'image/png'));
      if (!blob) throw new Error();
      const form = new FormData();
      form.set('overlay', new File([blob], 'overlay.png', { type: 'image/png' }));
      const res = await fetch(`/api/projects/${id}/gif`, { method: 'POST', body: form });
      if (res.status === 402) {
        setBilling(await res.json());
        setPaywall(true);
        return;
      }
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(await res.blob());
      a.download = `${(name || 'עיצוב').replace(/[\\/:*?"<>|]/g, '_')}.gif`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      push('ה-GIF הורד למחשב. אפשר לשתף אותו ישירות.', 'success');
    } catch (e) {
      push((e as Error).message || 'הכנת ה-GIF נכשלה. נסו שוב.', 'error');
    } finally {
      setGifBusy(false);
    }
  };

  /** All formats in one ZIP: PNG + WhatsApp JPEG + video (for digital designs). */
  const exportZip = async () => {
    const stage = stageRef.current;
    if (!stage || !doc || zipBusy) return;
    setZipBusy(true);
    const hidden = doc.elements.flatMap((e) => (e.type === 'image' && e.loopId ? [stage.findOne('#' + e.id)] : []));
    try {
      if (!(await mayDownload())) return;
      chrome(false);
      pageRef.current?.visible(false);
      hidden.forEach((n) => n?.visible(false));
      stage.draw();
      const overlay = stage.toCanvas({ pixelRatio: (VIDEO_WIDTH + 0.5) / stage.width() });
      chrome(true);
      pageRef.current?.visible(true);
      hidden.forEach((n) => n?.visible(true));
      stage.draw();
      const blob = await new Promise<Blob | null>((r) => overlay.toBlob(r, 'image/png'));
      if (!blob) throw new Error();
      const form = new FormData();
      form.set('overlay', new File([blob], 'overlay.png', { type: 'image/png' }));
      const res = await fetch(`/api/projects/${id}/zip`, { method: 'POST', body: form });
      if (res.status === 402) {
        setBilling(await res.json());
        setPaywall(true);
        return;
      }
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(await res.blob());
      a.download = `${(name || 'עיצוב').replace(/[\\/:*?"<>|]/g, '_')}_קמפיין.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      push('הקמפיין המלא הורד — PNG, JPEG לוואטסאפ, וסרטון.', 'success');
    } catch (e) {
      push((e as Error).message || 'הכנת הקמפיין נכשלה. נסו שוב.', 'error');
    } finally {
      setZipBusy(false);
    }
  };

  /** The ad as a PDF of its real size, at 300dpi, for a print shop. */
  const exportPdf = async () => {
    const stage = stageRef.current;
    if (!stage || !doc || pdfBusy) return;
    setPdfBusy(true);
    await new Promise((r) => setTimeout(r, 40));
    try {
      if (!(await mayDownload())) return;
      chrome(false);
      stage.draw();
      const drawn = stage.toCanvas({ pixelRatio: ((doc.page.width_mm / 25.4) * 300) / stage.width() });
      chrome(true);
      stage.draw();
      const jpeg = await new Promise<Blob | null>((r) => drawn.toBlob(r, 'image/jpeg', 0.95));
      if (!jpeg) throw new Error();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(jpegToPdf(new Uint8Array(await jpeg.arrayBuffer()), drawn.width, drawn.height, doc.page.width_mm, doc.page.height_mm));
      a.download = `${(name || 'עיצוב').replace(/[\\/:*?"<>|]/g, '_')}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      push('הקובץ לדפוס הורד למחשב. אפשר לשלוח אותו לבית הדפוס.', 'success');
    } catch {
      push('לא הצלחנו להכין את הקובץ. נסו שוב.', 'error');
    } finally {
      setPdfBusy(false);
    }
  };

  /** Keeps this design as the business's own template, or stops keeping it. */
  const toggleKeep = async () => {
    setKeepBusy(true);
    try {
      const res = await fetch(`/api/projects/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keep: !kept }) });
      if (!res.ok) throw new Error();
      setKept(!kept);
    } catch {
      push('הפעולה נכשלה. נסו שוב.', 'error');
    } finally {
      setKeepBusy(false);
    }
  };

  /** pictures the assistant works with arrive with its answer, for those it placed */
  const setLibraryFromAgent = (assets: ImageAsset[]) =>
    setLibrary((l) => ({ ...l, images: [...assets.filter((a) => !l.images.some((i) => i.id === a.id)), ...l.images] }));

  /** The same ad in another size: a new design with the words as they stand now. */
  const openSize = async (format: string) => {
    const current = docRef.current;
    if (!current || resizing) return;
    setResizing(true);
    try {
      const texts = Object.fromEntries(current.elements.flatMap((e) => (e.type === 'text' && e.editable && e.label ? [[e.label, e.text]] : [])));
      const res = await fetch(`/api/projects/${id}/resize`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ format, texts }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error);
      window.location.href = `/editor/${d.id}`;
    } catch (e) {
      push((e as Error).message || 'לא הצלחנו ליצור את המידה הזו. נסו שוב.', 'error');
      setResizing(false);
    }
  };

  /** Keeps this design as the business's logo: no page behind it and no empty margin, so it sits cleanly on any ad. */
  const saveAsLogo = async () => {
    const stage = stageRef.current;
    if (!stage || logoBusy) return;
    setLogoBusy(true);
    try {
      chrome(false);
      pageRef.current?.visible(false);
      stage.draw();
      const drawn = stage.toCanvas({ pixelRatio: 1600 / stage.width() });
      chrome(true);
      pageRef.current?.visible(true);
      stage.draw();
      const logo = trimTransparent(drawn);
      if (!logo) throw new Error('הלוגו ריק. כתבו בו משהו ונסו שוב.');
      const blob = await new Promise<Blob | null>((r) => logo.toBlob(r, 'image/png'));
      if (!blob) throw new Error('לא הצלחנו להכין את הקובץ. נסו שוב.');
      const form = new FormData();
      form.set('file', new File([blob], 'logo.png', { type: 'image/png' }));
      form.set('width', String(logo.width));
      form.set('height', String(logo.height));
      const res = await fetch('/api/brand/logo', { method: 'POST', body: form });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'השמירה נכשלה');
      setLogoSaved(true);
      push('הלוגו נשמר במיתוג של העסק', 'success');
    } catch (e) {
      push((e as Error).message, 'error');
    } finally {
      setLogoBusy(false);
    }
  };

  // ---- transformer + keyboard ---------------------------------------------------
  useEffect(() => {
    const tr = trRef.current;
    const stage = stageRef.current;
    if (!tr || !stage) return;
    // a customer selects only stickers; otherwise the frame marks the text field they are on
    const els = docRef.current?.elements ?? [];
    const targets = canManage && !preview ? selIds : [selectedId ?? activeField].filter((x): x is string => !!x);
    const nodes = targets.flatMap((t) => {
      const e = els.find((x) => x.id === t);
      const n = e && !e.hidden && t !== editingId ? stage.findOne('#' + t) : null;
      return n ? [n] : [];
    });
    tr.nodes(nodes);
    tr.getLayer()?.batchDraw();
  }, [selIds, selectedId, activeField, canManage, preview, doc, fontsTick, editingId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable]')) return;
      const mod = e.ctrlKey || e.metaKey;
      const onSticker = selected?.type === 'image' && selected.role === 'sticker';
      const author = canManage && !preview;
      if (!author && !onSticker && !(mod && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y'))) return;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicateSelected();
      } else if (author && mod && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        if (e.shiftKey) ungroupSelected();
        else groupSelected();
      } else if (author && mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        selectMany((docRef.current?.elements ?? []).filter((x) => !x.locked && !x.hidden).map((x) => x.id));
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault();
        removeSelected();
      } else if (e.key === 'Escape') {
        setSelectedId(null);
        setHistoryOpen(false);
      } else if (selected && e.key.startsWith('Arrow')) {
        e.preventDefault();
        // a millimetre a press, ten with Shift
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        patchMany(author ? selIds : [selected.id], (x) => ({ x_mm: x.x_mm + dx, y_mm: x.y_mm + dy }), 'nudge');
      }
    };
    // Space held down: dragging moves the view instead of the card
    const onSpace = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || (e.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return;
      spaceDown.current = e.type === 'keydown';
      if (e.type === 'keydown') e.preventDefault();
      wrapRef.current?.classList.toggle('panning', spaceDown.current);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keydown', onSpace);
    window.addEventListener('keyup', onSpace);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keydown', onSpace);
      window.removeEventListener('keyup', onSpace);
    };
  }, [undo, redo, duplicateSelected, removeSelected, selectedId, selected, selIds, patchElement, canManage, preview]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- zoom with the wheel (Ctrl) or two fingers, and moving the view with Space ----------------
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoomOverride((z) => clamp((z ?? fitRef.current) * Math.exp(-e.deltaY * 0.0015), 0.1, 3));
    };
    let pinch: { d: number; z: number } | null = null;
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) pinch = { d: dist(e.touches), z: zoomRef.current };
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      setZoomOverride(clamp((pinch.z * dist(e.touches)) / pinch.d, 0.1, 3));
    };
    const onTouchEnd = () => {
      pinch = null;
    };
    let pan: { x: number; y: number; left: number; top: number } | null = null;
    const onDown = (e: PointerEvent) => {
      if (!spaceDown.current && e.button !== 1) return;
      e.preventDefault();
      e.stopPropagation();
      pan = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
    };
    const onMove = (e: PointerEvent) => {
      if (!pan) return;
      el.scrollLeft = pan.left - (e.clientX - pan.x);
      el.scrollTop = pan.top - (e.clientY - pan.y);
    };
    const onUp = () => {
      pan = null;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [!!doc, preview, canManage, audience]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- render --------------------------------------------------------------------
  if (loadError) {
    return (
      <main className="page">
        <p className="error" role="alert">{loadError}</p>
        <Link className="btn" href="/">חזרה לעיצובים</Link>
      </main>
    );
  }
  if (!doc || !project) {
    return (
      <div className="editor-skel" aria-busy="true" aria-label="טוען את העורך">
        <div className="skel" style={{ height: 52 }} />
        <div className="skel-body">
          <div className="skel" style={{ height: 420 }} />
          <div className="skel" style={{ aspectRatio: '210 / 297', maxHeight: 520 }} />
        </div>
      </div>
    );
  }

  const pageW = doc.page.width_mm * PX;
  const pageH = doc.page.height_mm * PX;
  const libImages = library.images.filter((i) => i.categoryId === libCat);
  const saveLabel = { saved: 'נשמר', saving: 'שומר…', dirty: 'שינויים לא שמורים', error: 'השמירה נכשלה, מנסה שוב בעריכה הבאה' }[save];

  const full = canManage && !preview;
  const words = WORDS[audience];
  const pageFormat = formatOfPage(doc.page.width_mm, doc.page.height_mm);
  const mustFix = issues.filter((i) => i.level === 'must');
  /** a download goes through the ad check first: the business sees what it found, and decides */
  const checked = (download: () => void) => () => {
    if (adDesign && mustFix.length) setPending(() => download);
    else download();
  };
  const swappables = doc.elements.filter((e): e is Extract<CanvasElement, { type: 'image' }> => e.type === 'image' && !!e.swappable);
  const editableFields = doc.elements.filter((e): e is TextElement => e.type === 'text' && !!e.editable);
  /** a private card's working screen: the details beside the card, and under it strips of wordings, backgrounds and stickers */
  const work = !full && audience === 'private';
  const stickerSelected = selected?.type === 'image' && selected.role === 'sticker';
  const stickerLibrary = library.images.filter((i) => i.sticker);
  const ownStickers = library.images.filter((i) => i.ownSticker && !i.removed);
  const placeOnDoc = (s: ImageAsset) => {
    const d = docRef.current;
    if (!d) return;
    if (d.elements.filter((e) => e.type === 'image' && e.role === 'sticker').length >= MAX_STICKERS) {
      push(`אפשר עד ${MAX_STICKERS} מדבקות בעיצוב אחד.`, 'error');
      return;
    }
    addElement(placeSticker(d, { assetId: s.id, width: s.width, height: s.height }).elements.at(-1)!);
  };
  const addToLibrary = (a: ImageAsset) => setLibrary((l) => ({ ...l, images: [a, ...l.images] }));
  const forgetPicture = async (a: ImageAsset) => {
    const res = await fetch(`/api/my-images/${a.id}`, { method: 'DELETE' }).catch(() => null);
    if (!res?.ok) return push('ההסרה נכשלה. נסו שוב.', 'error');
    setLibrary((l) => ({ ...l, images: l.images.map((i) => (i.id === a.id ? { ...i, removed: true } : i)) }));
  };
  // the ad's picture: what it can take is the business's own pictures, and those of the same library category
  const photoEl = adDesign ? doc.elements.find((e): e is ImageElement => e.type === 'image' && e.role === 'photo' && !!e.photoBox) : undefined;
  const photoCategory = photoEl && assetById.get(photoEl.asset_id)?.categoryId;
  const photoOptions = library.images.filter((i) => !i.removed && !i.ownSticker && !i.sticker && (i.categoryId.startsWith('brand:') ? !/לוגו/.test(i.name) : i.categoryId === photoCategory));
  const fontChoices = [...CUSTOMER_FONTS, ...uploadedFonts.filter((f) => f.customer).map((f) => f.family)];
  const addOwnText = () => {
    const d = docRef.current;
    if (!d) return;
    if (d.elements.filter((e) => e.type === 'text' && e.own).length >= MAX_OWN_TEXTS) return push(`אפשר עד ${MAX_OWN_TEXTS} טקסטים משלכם במודעה.`, 'error');
    const el: TextElement = { ...newText(d, 'הטקסט שלי'), own: true, label: 'טקסט שלי', font: { family: fontChoices[0], weight: 700, size_pt: Math.round(d.page.width_mm / 5), color: '#111111' } };
    commit({ ...d, elements: normalize([...d.elements, el]) });
    setActiveField(el.id);
    requestAnimationFrame(() => fieldRefs.current[el.id]?.focus());
  };
  const removeOwnText = (elId: string) => {
    const d = docRef.current;
    if (!d) return;
    commit({ ...d, elements: normalize(d.elements.filter((e) => e.id !== elId)) });
    setActiveField(null);
  };
  const textEl = selected?.type === 'text' ? selected : null;
  const updateText = (patch: Partial<TextElement>, key?: string) => selected && patchElement(selected.id, patch, key);
  const num = (v: string) => (v === '' || Number.isNaN(Number(v)) ? null : Number(v));

  const agent = canAgent && (editableFields.length > 0 || swappables.length > 0) && (
    <AgentPanel
      projectId={id}
      getDoc={() => docRef.current}
      onApply={applyAgent}
      onBusyChange={setAiBusy}
      placeholder={words.placeholder}
      suggestions={words.suggestions}
      intents={adDesign ? AD_INTENTS : []}
      audience={audience}
      onLibrary={setLibraryFromAgent}
      onOpenSize={openSize}
    />
  );

  const wordingPicker = looks && topic && (
        <WordingPicker
          doc={doc}
          topic={topic}
          manage={false}
          drawable={drawable}
          onPick={pickWording}
          list={looks.wordings}
          current={doc.wordingId ?? project?.templateId}
          title="נוסחים מוכנים"
        />
      );
  const backdropPicker = looks && swappables.length === 0 && (
        <BackdropPicker
          doc={doc}
          list={looks.backdrops}
          current={doc.backdropId ?? project?.templateId}
          swatches={BG_SWATCHES}
          drawable={drawable}
          onPick={pickBackdrop}
        />
      );
  const stickerPicker = topic !== LOGO_TOPIC && topic !== SHABBAT_TOPIC && (
        <StickerPicker
          stickers={stickerLibrary}
          own={ownStickers}
          topic={topic}
          selected={stickerSelected}
          onPick={placeOnDoc}
          onRemove={removeSelected}
          onUpload={audience === 'business' ? addToLibrary : undefined}
          onForget={forgetPicture}
        />
      );
  const swapPickers = swappables.map((el) => {
        // a background of a card with a wording fills its page: one of another shape would come out stretched
        const fills = (i: ImageAsset) => !doc.wordingId || Math.abs(i.width / i.height / (el.w_mm / el.h_mm) - 1) < 0.02;
        const options = library.images.filter((i) => (!el.swapCategoryId || i.categoryId === el.swapCategoryId) && fills(i));
        return (
          <div key={el.id} className={'field field-card' + (aiTouched.has(el.id) ? ' ai-touched' : '')} style={{ order: -1 }}>
            <span className="field-label">{el.label || 'תמונה'}</span>
            {options.length === 0 ? (
              <span className="status">אין תמונות להחלפה.</span>
            ) : (
              <div className="pick-grid">
                {options.map((img) => (
                  <button
                    key={img.id}
                    type="button"
                    className="pick"
                    title={img.name}
                    aria-pressed={!el.colorOverride && img.id === el.asset_id}
                    onClick={() => patchBackground(el.id, { asset_id: img.id, colorOverride: undefined } as Partial<CanvasElement>)}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/uploads/${img.file}`} alt={img.name} />
                  </button>
                ))}
              </div>
            )}
            <div className="field-head">
              <span>או צבע אחיד</span>
              <div className="swatches" role="group" aria-label={`צבע אחיד: ${el.label || 'רקע'}`}>
                {BG_SWATCHES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className="swatch"
                    style={{ background: c }}
                    aria-label={`צבע ${c}`}
                    aria-pressed={el.colorOverride?.toLowerCase() === c.toLowerCase()}
                    onClick={() => patchBackground(el.id, { colorOverride: c } as Partial<CanvasElement>)}
                  />
                ))}
                <input
                  type="color"
                  className="swatch-picker"
                  aria-label="צבע אחיד חופשי"
                  value={el.colorOverride ?? '#faf8f3'}
                  onChange={(e) => patchBackground(el.id, { colorOverride: e.target.value } as Partial<CanvasElement>, 'bgcolor:' + el.id)}
                />
              </div>
            </div>
          </div>
        );
      });

  const pickers = (
    <>
      {wordingPicker}
      {backdropPicker}
      {stickerPicker}
      {swapPickers}
    </>
  );

  const libTabs = (
    [
      ['wordings', 'נוסחים', 'נוסחים מוכנים', (looks?.wordings.length ?? 0) > 1],
      ['backdrops', 'רקע', 'רקע', !!looks || swappables.length > 0],
      ['stickers', 'מדבקות', 'מדבקות', !!stickerPicker],
      ['agent', 'עוזר AI', 'העוזר', !!agent],
    ] as const
  ).filter((t) => t[3]);
  /** what the library beside the card shows: the tab chosen, or the first one while the form is open */
  const shown = libTabs.find((t) => t[0] === tab) ?? libTabs[0];
  const activeEl = work ? editableFields.find((f) => f.id === activeField) : undefined;
  const preset = PAGE_PRESETS.find((p) => p.width_mm === doc.page.width_mm && p.height_mm === doc.page.height_mm);

  const editingEl = (() => {
    const e = editingId ? doc.elements.find((x) => x.id === editingId) : undefined;
    return e?.type === 'text' ? e : undefined;
  })();

  /** A drag starts: what moves with it (the rest of an author's selection), and what it can snap to. */
  const onLayerDragStart = (e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target;
    const id = node.id();
    const stg = stageRef.current;
    if (!id || !stg || node.getLayer() !== layerRef.current) return;
    const moving = full && selIds.includes(id) ? selIds : [id];
    const others = moving.filter((m) => m !== id).flatMap((m) => {
      const n = stg.findOne('#' + m);
      return n ? [{ node: n, x: n.x(), y: n.y() }] : [];
    });
    const still = boxesOf(doc.elements.filter((x) => !moving.includes(x.id) && !x.hidden).map((x) => x.id)).map((b) => b.box);
    dragRef.current = {
      id,
      start: { x: node.x(), y: node.y() },
      others,
      boxes: still,
      lines: linesOf(still, { w: pageW, h: pageH }, { x: guides.x.map((g) => g * PX), y: guides.y.map((g) => g * PX) }),
    };
  };

  /** While dragging: the rest of the selection follows, and the whole of it snaps (Alt lets it move freely). */
  const onLayerDragMove = (e: Konva.KonvaEventObject<DragEvent>) => {
    const d = dragRef.current;
    const node = e.target;
    if (!d || node.id() !== d.id) return;
    const dx = node.x() - d.start.x;
    const dy = node.y() - d.start.y;
    d.others.forEach((o) => o.node.position({ x: o.x + dx, y: o.y + dy }));
    if (e.evt.altKey) return setSnapMarks([]);
    const layer = layerRef.current!;
    const box = unionOf([node, ...d.others.map((o) => o.node)].map((n) => {
      const r = n.getClientRect({ relativeTo: layer });
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    }));
    const snap = snapBox(box, d.lines, d.boxes, { w: pageW, h: pageH }, 6 / zoom);
    if (snap.dx || snap.dy) {
      node.position({ x: node.x() + snap.dx, y: node.y() + snap.dy });
      d.others.forEach((o) => o.node.position({ x: o.node.x() + snap.dx, y: o.node.y() + snap.dy }));
    }
    setSnapMarks(snap.marks);
  };

  /** A drag ends: every element that moved is saved where it stands, in one undo step. */
  const onLayerDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    const d = dragRef.current;
    dragRef.current = null;
    setSnapMarks([]);
    if (!d || e.target.id() !== d.id) return;
    const at = new Map([[d.id, e.target], ...d.others.map((o) => [o.node.id(), o.node] as const)]);
    patchMany([...at.keys()], (x) => {
      const n = at.get(x.id)!;
      return { x_mm: n.x() / PX, y_mm: n.y() / PX };
    });
  };

  const stage = (
        <div
          className="stage-wrap"
          ref={wrapRef}
          onMouseDown={(e) => e.target === e.currentTarget && setSelectedId(null)}
        >
          <div
            className={'stage-frame' + (aiBusy ? ' ai-working' : '') + (aiTouched.size ? ' ai-done' : '')}
            style={{ width: pageW * zoom, height: pageH * zoom }}
          >
            {full && <EditorRulers widthMm={doc.page.width_mm} heightMm={doc.page.height_mm} scale={PX * zoom} onGuide={(axis, mm) => keepGuides({ ...guides, [axis]: [...guides[axis], mm] })} />}
            <Stage
              ref={stageRef}
              width={pageW * zoom}
              height={pageH * zoom}
              scaleX={zoom}
              scaleY={zoom}
              onMouseDown={(e) => {
                const onPage = e.target === e.target.getStage() || e.target === pageRef.current;
                if (onPage) {
                  setActiveField(null);
                  // an author drags a frame over the page to select what it touches
                  const p = e.target.getStage()!.getPointerPosition();
                  if (full && p) {
                    marqueeStart.current = { x: p.x / zoom, y: p.y / zoom, add: e.evt.shiftKey };
                    if (!e.evt.shiftKey) setSelectedId(null);
                  } else {
                    setSelectedId(null);
                  }
                } else if (!full && !e.target.findAncestor('Transformer')) {
                  // a customer's background doesn't take clicks, so this is how a click beside a sticker lets go of it
                  const hit = doc.elements.find((x) => x.id === e.target.id() || x.id === e.target.parent?.id());
                  if (hit?.type !== 'image' || hit.role !== 'sticker') setSelectedId(null);
                }
              }}
              onMouseMove={(e) => {
                const st = marqueeStart.current;
                const p = e.target.getStage()?.getPointerPosition();
                if (!st || !p) return;
                const x = p.x / zoom;
                const y = p.y / zoom;
                setMarquee({ x: Math.min(x, st.x), y: Math.min(y, st.y), w: Math.abs(x - st.x), h: Math.abs(y - st.y) });
              }}
              onMouseUp={() => {
                const st = marqueeStart.current;
                marqueeStart.current = null;
                if (!st || !marquee) return setMarquee(null);
                const hit = boxesOf(doc.elements.filter((x) => !x.locked && !x.hidden).map((x) => x.id))
                  .filter((b) => intersects(b.box, marquee))
                  .flatMap((b) => withGroup(b.id));
                const ids = [...new Set([...(st.add ? selIds : []), ...hit])];
                selectMany(ids);
                setMarquee(null);
              }}
              onTap={(e) => {
                if (e.target === e.target.getStage() || e.target === pageRef.current) {
                  setSelectedId(null);
                  setActiveField(null);
                }
              }}
            >
              <Layer ref={layerRef} onDragStart={onLayerDragStart} onDragMove={onLayerDragMove} onDragEnd={onLayerDragEnd}>
                <Rect ref={pageRef} x={0} y={0} width={pageW} height={pageH} fill={doc.page.background} {...pageLook(doc.page, pageW, pageH)} />
                {doc.elements.map((el) => {
                  if (el.hidden) return null;
                  const locked = full && !!el.locked;
                  const onSelect = (e?: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
                    const ev = e?.evt as MouseEvent | undefined;
                    if (full) selectEl(el.id, !!(ev?.shiftKey || ev?.ctrlKey || ev?.metaKey));
                    else setSelectedId(el.id);
                  };
                  const focusField = () => {
                    if (el.type !== 'text' || !el.editable) return;
                    setActiveField(el.id);
                    fieldRefs.current[el.id]?.focus({ preventScroll: false });
                  };
                  const onChange = (patch: Partial<CanvasElement>) => patchElement(el.id, patch);
                  if (el.type === 'image') {
                    return <ImageNode key={el.id} el={el} asset={assetById.get(el.asset_id)} interactive={(full && !locked) || el.role === 'sticker'} onSelect={onSelect} onChange={onChange} />;
                  }
                  if (el.type === 'rect') {
                    return (
                      <Rect
                        key={el.id}
                        id={el.id}
                        x={el.x_mm * PX}
                        y={el.y_mm * PX}
                        width={el.w_mm * PX}
                        height={el.h_mm * PX}
                        rotation={el.rotation}
                        fill={el.fill}
                        {...shapeLook(el, PX)}
                        cornerRadius={(el.cornerRadius_mm ?? 0) * PX}
                        opacity={el.opacity ?? 1}
                        draggable={full && !locked}
                        listening={!locked}
                        onMouseDown={full ? onSelect : undefined}
                        onTap={full ? onSelect : undefined}
                        onTransformEnd={(e) => {
                          const n = e.target;
                          const w = n.width() * n.scaleX();
                          const h = n.height() * n.scaleY();
                          n.scaleX(1);
                          n.scaleY(1);
                          onChange({ x_mm: n.x() / PX, y_mm: n.y() / PX, w_mm: w / PX, h_mm: h / PX, rotation: n.rotation() });
                        }}
                      />
                    );
                  }
                  // what a text takes the same, straight or on an arc
                  const textNode = {
                    id: el.id,
                    x: el.x_mm * PX,
                    y: el.y_mm * PX,
                    rotation: el.rotation,
                    // customers can drag the texts they are allowed to edit; the position is saved with the card
                    draggable: (full && !locked) || (!full && !!el.editable),
                    listening: !locked,
                    // writing straight on the card
                    onDblClick: () => (full || el.editable) && setEditingId(el.id),
                    onDblTap: () => (full || el.editable) && setEditingId(el.id),
                    opacity: editingId === el.id ? 0 : 1,
                    dragBoundFunc: function (this: Konva.Node, pos: Konva.Vector2d) {
                      // keep the text box inside the page while dragging (pos is in screen pixels)
                      const w = this.width() * zoom;
                      const h = this.height() * zoom;
                      return {
                        x: clamp(pos.x, 0, Math.max(0, pageW * zoom - w)),
                        y: clamp(pos.y, 0, Math.max(0, pageH * zoom - h)),
                      };
                    },
                    onMouseDown: full ? onSelect : focusField,
                    onTap: full ? onSelect : focusField,
                    onMouseEnter: (e: Konva.KonvaEventObject<MouseEvent>) => {
                      if (full || el.editable) e.target.getStage()!.container().style.cursor = 'move';
                    },
                    onMouseLeave: (e: Konva.KonvaEventObject<MouseEvent>) => {
                      e.target.getStage()!.container().style.cursor = '';
                    },
                    onTransformEnd: (e: Konva.KonvaEventObject<Event>) => {
                      const n = e.target;
                      const w = n.width() * n.scaleX();
                      n.scaleX(1);
                      n.scaleY(1);
                      onChange({ x_mm: n.x() / PX, y_mm: n.y() / PX, w_mm: w / PX, rotation: n.rotation() });
                    },
                  };
                  if (hasArc(el)) {
                    const box = arcBox(el, PX);
                    return (
                      <Shape
                        key={`${el.id}-${fontsTick}`}
                        {...textNode}
                        width={box.width}
                        height={box.height}
                        sceneFunc={(ctx) => drawArc(ctx._context, el, PX)}
                        // the whole box takes clicks, not only the letters
                        hitFunc={(ctx, shape) => {
                          ctx.beginPath();
                          ctx.rect(0, 0, shape.width(), shape.height());
                          ctx.closePath();
                          ctx.fillStrokeShape(shape);
                        }}
                      />
                    );
                  }
                  return (
                    <Text
                      key={`${el.id}-${fontsTick}`}
                      {...textNode}
                      width={el.w_mm * PX}
                      text={el.text}
                      align={el.align}
                      // explicit, not inherited: the PNG and the preview are drawn on a canvas off the page, which is left-to-right
                      direction="rtl"
                      fontFamily={el.font.family}
                      fontStyle={el.font.weight === 700 ? 'bold' : 'normal'}
                      fill={el.font.color}
                      {...textLook(el, PX)}
                      wrap="word"
                    />
                  );
                })}
                <Transformer
                  ref={trRef}
                  resizeEnabled={canManage || stickerSelected}
                  rotateEnabled={canManage || stickerSelected}
                  borderStroke="#1fb37c"
                  borderStrokeWidth={2}
                  borderDash={canManage || stickerSelected ? undefined : [6, 4]}
                  padding={canManage || stickerSelected ? 0 : 4}
                  keepRatio={selected?.type === 'image'}
                  enabledAnchors={
                    selected?.type === 'text'
                      ? ['middle-left', 'middle-right']
                      : ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'middle-left', 'middle-right', 'top-center', 'bottom-center']
                  }
                  boundBoxFunc={(oldBox, newBox) => (newBox.width < 10 || newBox.height < 10 ? oldBox : newBox)}
                />
              </Layer>
              <Layer ref={overlayRef}>
                {full && showSafe && (
                  <Rect x={SAFE_MM * PX} y={SAFE_MM * PX} width={pageW - SAFE_MM * 2 * PX} height={pageH - SAFE_MM * 2 * PX} stroke="#E0457B" strokeWidth={1 / zoom} dash={[6 / zoom, 4 / zoom]} listening={false} />
                )}
                {full &&
                  (['x', 'y'] as const).flatMap((axis) =>
                    guides[axis].map((mm, i) => (
                      <Line
                        key={axis + i}
                        points={axis === 'x' ? [mm * PX, 0, mm * PX, pageH] : [0, mm * PX, pageW, mm * PX]}
                        stroke="#1F9BD1"
                        strokeWidth={1 / zoom}
                        hitStrokeWidth={8 / zoom}
                        draggable
                        dragBoundFunc={function (this: Konva.Node, pos) {
                          return axis === 'x' ? { x: pos.x, y: this.getAbsolutePosition().y } : { x: this.getAbsolutePosition().x, y: pos.y };
                        }}
                        onMouseEnter={(e) => (e.target.getStage()!.container().style.cursor = axis === 'x' ? 'ew-resize' : 'ns-resize')}
                        onMouseLeave={(e) => (e.target.getStage()!.container().style.cursor = '')}
                        onDragEnd={(e) => {
                          // dragged off the page, the guide goes
                          const moved = mm + (axis === 'x' ? e.target.x() : e.target.y()) / PX;
                          e.target.position({ x: 0, y: 0 });
                          const rest = guides[axis].filter((_, j) => j !== i);
                          const max = axis === 'x' ? doc.page.width_mm : doc.page.height_mm;
                          keepGuides({ ...guides, [axis]: moved > 0 && moved < max ? [...rest, Math.round(moved * 2) / 2] : rest });
                        }}
                      />
                    )),
                  )}
                {snapMarks.map((m, i) => (
                  <Line key={'snap' + i} points={[m.x1, m.y1, m.x2, m.y2]} stroke="#E0457B" strokeWidth={1 / zoom} listening={false} />
                ))}
                {marquee && <Rect x={marquee.x} y={marquee.y} width={marquee.w} height={marquee.h} fill="rgba(31,155,209,0.08)" stroke="#1F9BD1" strokeWidth={1 / zoom} listening={false} />}
              </Layer>
            </Stage>
            {editingEl && (
              <InlineTextEditor
                el={editingEl}
                box={{
                  x: editingEl.x_mm * PX * zoom,
                  y: editingEl.y_mm * PX * zoom,
                  w: (hasArc(editingEl) ? arcBox(editingEl, PX).width : editingEl.w_mm * PX) * zoom,
                  h: (stageRef.current?.findOne('#' + editingEl.id)?.height() ?? 40) * zoom,
                  rotation: editingEl.rotation,
                }}
                fontSize={textLook(editingEl, PX).fontSize * zoom}
                lineHeight={editingEl.lineHeight ?? LINE_HEIGHT}
                onDone={(text) => {
                  if (text !== null && text !== editingEl.text) patchElement(editingEl.id, { text }, 'text:' + editingEl.id);
                  setEditingId(null);
                }}
              />
            )}
            {!billing.allowed && <div className="watermark" aria-hidden="true" />}
            {aiBusy && (
              <div className="ai-veil" aria-hidden="true">
                <span className="ai-scan" />
                <span className="ai-pill">
                  <span className="ai-pill-dot" />
                  {words.working}
                </span>
              </div>
            )}
          </div>
        </div>
  );

  return (
    <div className={(audience === 'business' ? 'editor-wrap for-business' : 'editor-wrap') + (work ? ' work-wrap' : '')}>
      <div className="editor-bar">
        <input
          className="title"
          type="text"
          value={name}
          aria-label="שם העיצוב"
          maxLength={100}
          onChange={(e) => {
            setName(e.target.value);
            setSave('dirty');
          }}
        />
        <span className="bar-group">
          <button className="icon-btn" onClick={undo} disabled={!pastRef.current.length} aria-label="ביטול" title="ביטול (Ctrl+Z)">
            <UndoIcon />
          </button>
          <button className="icon-btn" onClick={redo} disabled={!futureRef.current.length} aria-label="חזרה" title="חזרה (Ctrl+Y)">
            <RedoIcon />
          </button>
          <span className="history-wrap">
            <button className="icon-btn" onClick={() => setHistoryOpen((o) => !o)} aria-expanded={historyOpen} aria-label="היסטוריית שינויים" title="היסטוריית שינויים">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2" />
              </svg>
            </button>
            {historyOpen && (
              <div className="history-list" role="list" aria-label="היסטוריית שינויים">
                {[...pastRef.current, { doc, label: labelRef.current }, ...futureRef.current]
                  .map((step, i) => ({ step, i }))
                  .reverse()
                  .map(({ step, i }) => (
                    <button
                      key={i}
                      type="button"
                      role="listitem"
                      className={'history-step' + (i === pastRef.current.length ? ' now' : i > pastRef.current.length ? ' undone' : '')}
                      aria-current={i === pastRef.current.length}
                      onClick={() => jumpTo(i)}
                    >
                      {step.label}
                    </button>
                  ))}
              </div>
            )}
          </span>
        </span>
        {canManage && (
          <button className="btn small" aria-pressed={preview} onClick={() => { setPreview((v) => !v); setSelectedId(null); setZoomOverride(null); }}>
            {preview ? 'חזרה לעריכה' : 'תצוגת לקוח'}
          </button>
        )}
        <span className="spacer" />
        <span className="bar-group zoom-controls">
          <button className="icon-btn" onClick={() => setZoomOverride(clamp(zoom - 0.1, 0.1, 3))} aria-label="הקטנה">
            −
          </button>
          <span className="zoom-val">{Math.round(zoom * 100)}%</span>
          <button className="icon-btn" onClick={() => setZoomOverride(clamp(zoom + 0.1, 0.1, 3))} aria-label="הגדלה">
            +
          </button>
          <button className="icon-btn" onClick={() => setZoomOverride(null)} aria-label="התאמה למסך" title="התאמה למסך">
            <FitIcon />
          </button>
        </span>
        <span className={'save-state ' + save} role="status">
          {saveLabel}
        </span>
        {full && (
          <>
            <span className={'badge ' + pubStatus}>{pubStatus === 'published' ? 'פורסם' : 'טיוטה'}</span>
            {pubStatus === 'published' ? (
              <button className="btn small" disabled={pubBusy} onClick={() => setPublished('draft')}>
                ביטול פרסום
              </button>
            ) : (
              <button className="btn small primary" disabled={pubBusy} onClick={() => setPublished('published')}>
                פרסום ללקוחות
              </button>
            )}
          </>
        )}
        {hasVideo && !outOfDate && (
          <button className="btn small" onClick={checked(exportVideo)} disabled={videoBusy}>
            {videoBusy ? 'מכין סרטון… (עד דקה)' : 'הורדת סרטון לסטטוס'}
          </button>
        )}
        {pageFormat?.medium === 'digital' && !outOfDate && (
          <button className="btn small" onClick={checked(exportGif)} disabled={gifBusy}>
            {gifBusy ? 'מכין GIF… (עד דקה)' : 'הורד GIF'}
          </button>
        )}
        {!full && audience === 'business' && pageFormat?.medium === 'digital' && !outOfDate && (
          <button className="btn small" onClick={checked(exportZip)} disabled={zipBusy}>
            {zipBusy ? 'מכין קמפיין… (עד דקה)' : 'הורד קמפיין מלא (ZIP)'}
          </button>
        )}
        {!full && audience === 'business' && pageFormat?.medium === 'print' && (
          <button className="btn small" onClick={checked(exportPdf)} disabled={pdfBusy || outOfDate}>
            {pdfBusy ? 'מכין קובץ…' : 'הורדה לדפוס (PDF)'}
          </button>
        )}
        <button className="btn primary small shine" onClick={checked(exportPng)} disabled={exporting || outOfDate}>
          <DownloadIcon size={16} />
          {exporting ? 'מכין קובץ…' : full ? 'הורדת PNG (300dpi)' : words.download}
        </button>
      </div>

      {outOfDate && (
        <p className="hint" role="alert" style={{ margin: 0, borderRadius: 0 }}>
          <span>
            הזמנים בעיצוב הזה הם של שבת שכבר עברה, ולכן אי אפשר להוריד אותו.{' '}
            <Link href={categoryHref(SHABBAT_TOPIC, 'business')} style={{ textDecoration: 'underline' }}>
              לזמנים של השבת הקרובה ←
            </Link>
          </span>
        </p>
      )}

      {pending && (
        <div className="paywall" role="dialog" aria-modal="true" aria-label="בדיקת המודעה">
          <div className="paywall-card">
            <h2>רגע לפני שמורידים</h2>
            <p>מצאנו כמה דברים שכדאי לבדוק במודעה:</p>
            <ul className="ad-issues">
              {mustFix.map((i) => (
                <li key={i.id}>{i.text}</li>
              ))}
            </ul>
            <button className="btn primary" onClick={() => setPending(null)}>
              חזרה לתיקון
            </button>
            <button
              className="btn small"
              onClick={() => {
                pending();
                setPending(null);
              }}
            >
              להוריד בכל זאת
            </button>
          </div>
        </div>
      )}

      {paywall && !billing.allowed && (
        <div className="paywall" role="dialog" aria-modal="true" aria-label="תשלום להורדה">
          <div className="paywall-card">
            <h2>להורדה בלי סימן מים</h2>
            <p>העיצוב שמור אצלכם. בוחרים איך להמשיך:</p>
            <button className="btn primary" disabled={payBusy} onClick={() => startPayment('ad')}>
              העיצוב הזה, {formatPrice(billing.price)} חד־פעמי
            </button>
            {billing.seriesPrice !== null && (
              <button className="btn" disabled={payBusy} onClick={() => startPayment('series')}>
                כל הסדרה, {formatPrice(billing.seriesPrice)} חד־פעמי
              </button>
            )}
            <button className="btn" disabled={payBusy} onClick={() => startPayment('subscription')}>
              מנוי, {formatPrice(billing.subscriptionPrice)} לחודש: כל העיצובים, בלי קרדיט
            </button>
            <button className="btn small" onClick={() => setPaywall(false)}>
              אחר כך
            </button>
          </div>
        </div>
      )}

      <div className={'editor' + (full ? '' : ' customer') + (work ? ' work' : '')} data-tab={work ? tab : undefined}>
        {!full && (
          <aside className={'left' + (work ? ' work-fields' : '')} aria-label={words.panelLabel}>
            {work ? (
              <header className="work-head" style={{ order: -3 }}>
                <span className="num">1</span>
                <h2>הפרטים שלכם</h2>
                <p>כתבו כאן, והכרטיס מתעדכן מיד.</p>
              </header>
            ) : (
              <header className="panel-head" style={{ order: -3 }}>
                <h2>{words.panelTitle}</h2>
                <p>{words.panelLead}</p>
              </header>
            )}
            {!work && hintOpen && (
              <div className="hint" style={{ order: -2 }} role="note">
                <span>{words.tip}</span>
                <button
                  className="hint-x"
                  aria-label="סגירת הטיפ"
                  onClick={() => {
                    setHintOpen(false);
                    try {
                      localStorage.setItem('hint-editor-v1', '1');
                    } catch {}
                  }}
                >
                  ×
                </button>
              </div>
            )}
            {!work && agent && <div style={{ order: -2 }}>{agent}</div>}
            {adDesign && (
              <div className="field-card ad-check" style={{ order: -1 }} aria-live="polite">
                <span className="field-label">בדיקת המודעה</span>
                {issues.length === 0 ? (
                  <p className="status" style={{ margin: 0 }}>
                    ✓ המודעה נראית מוכנה
                  </p>
                ) : (
                  <ul className="ad-issues">
                    {issues.map((i) => (
                      <li key={i.id} className={i.level}>
                        {i.text}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {!full && audience === 'business' && sizes.length > 1 && (
              <div className="field-card size-picker" style={{ order: -1 }}>
                <span className="field-label">אותה מודעה במידה אחרת</span>
                {(['digital', 'print'] as AdMedium[]).map((m) => {
                  const list = AD_FORMATS.filter((f) => f.medium === m && sizes.includes(f.id));
                  return (
                    list.length > 0 && (
                      <div key={m} className="size-group" role="group" aria-label={MEDIUM_LABEL[m]}>
                        <span className="status">{MEDIUM_LABEL[m]}:</span>
                        {list.map((f) =>
                          f.id === pageFormat?.id ? (
                            <span key={f.id} className="btn small size-current" aria-current="true">
                              {f.label}
                            </span>
                          ) : (
                            <button key={f.id} type="button" className="btn small" disabled={resizing} onClick={() => openSize(f.id)}>
                              {f.label}
                            </button>
                          ),
                        )}
                      </div>
                    )
                  );
                })}
              </div>
            )}
            {editableFields.length === 0 && swappables.length === 0 ? (
              <p className="status">בתבנית הזו אין שדות לעריכה.</p>
            ) : (
              editableFields.map((f) => (
                <div key={f.id} className={'field field-card' + (aiTouched.has(f.id) ? ' ai-touched' : '')}>
                  <div className="field-head">
                    <label htmlFor={`f-${f.id}`}>{f.label || 'טקסט'}</label>
                    {!work && (
                    <div className="swatches" role="group" aria-label={`צבע הטקסט: ${f.label || 'טקסט'}`}>
                      {SWATCHES.map((c) => (
                        <button
                          key={c}
                          type="button"
                          className="swatch"
                          style={{ background: c }}
                          aria-label={`צבע ${c}`}
                          aria-pressed={f.font.color.toLowerCase() === c.toLowerCase()}
                          onClick={() => patchElement(f.id, { font: { ...f.font, color: c } } as Partial<CanvasElement>)}
                        />
                      ))}
                      <input
                        type="color"
                        className="swatch-picker"
                        aria-label="צבע אחר"
                        value={f.font.color}
                        onChange={(e) => patchElement(f.id, { font: { ...f.font, color: e.target.value } } as Partial<CanvasElement>, 'color:' + f.id)}
                      />
                    </div>
                    )}
                  </div>
                  <textarea
                    id={`f-${f.id}`}
                    onFocus={() => setActiveField(f.id)}
                    ref={(n) => {
                      fieldRefs.current[f.id] = n;
                    }}
                    rows={Math.min(5, Math.max(2, f.text.split('\n').length))}
                    dir="auto"
                    maxLength={500}
                    value={f.text}
                    onChange={(e) => patchElement(f.id, { text: e.target.value }, 'text:' + f.id)}
                  />
                  {f.own && (
                    <div className="own-text-tools">
                      <select aria-label={`פונט: ${f.label}`} value={f.font.family} onChange={(e) => patchElement(f.id, { font: { ...f.font, family: e.target.value } } as Partial<CanvasElement>)}>
                        {fontChoices.map((name) => (
                          <option key={name} value={name} style={{ fontFamily: name }}>
                            {name}
                          </option>
                        ))}
                      </select>
                      <button type="button" className="btn small" aria-label="הקטנת הטקסט" onClick={() => patchElement(f.id, { font: { ...f.font, size_pt: Math.max(6, f.font.size_pt * 0.88) } } as Partial<CanvasElement>)}>
                        א−
                      </button>
                      <button type="button" className="btn small" aria-label="הגדלת הטקסט" onClick={() => patchElement(f.id, { font: { ...f.font, size_pt: Math.min(200, f.font.size_pt * 1.14) } } as Partial<CanvasElement>)}>
                        א+
                      </button>
                      <button type="button" className="btn small" aria-pressed={f.font.weight === 700} onClick={() => patchElement(f.id, { font: { ...f.font, weight: f.font.weight === 700 ? 400 : 700 } } as Partial<CanvasElement>)}>
                        מודגש
                      </button>
                      <button type="button" className="btn small" onClick={() => removeOwnText(f.id)}>
                        מחיקה
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
            {adDesign && (
              <div className="field-card own-actions" style={{ order: -1 }}>
                <button type="button" className="btn small" onClick={addOwnText}>
                  + הוספת טקסט משלי
                </button>
                <button type="button" className="btn small" disabled={keepBusy} aria-pressed={kept} onClick={toggleKeep}>
                  {kept ? '✓ שמור בתבניות שלי' : 'לשמור כתבנית שלי'}
                </button>
                {kept && <span className="status">בסלסלה אפשר לפתוח ממנה מודעה חדשה בכל פעם.</span>}
              </div>
            )}
            {adDesign && hasProducts(doc) && (
              <ProductPicker
                chosen={doc.productIds ?? []}
                onChange={(items) => {
                  const d = docRef.current;
                  if (d) commit(applyProducts(d, items));
                }}
              />
            )}
            {photoEl && (
              <PhotoPicker
                el={photoEl}
                images={photoOptions}
                onUploaded={addToLibrary}
                onPick={(a) => {
                  const d = docRef.current;
                  if (d) commit(placePhoto(d, { assetId: a.id, width: a.width, height: a.height }));
                }}
                onColor={(color, key) => patchElement(photoEl.id, { colorOverride: color } as Partial<CanvasElement>, key)}
              />
            )}
            {!work && pickers}
            {topic === LOGO_TOPIC && (
              <div className="field field-card">
                <span className="field-label">הלוגו של העסק</span>
                <p className="status" style={{ margin: 0 }}>הרקע יורד, והלוגו נכנס לכל המודעות של העסק.</p>
                <button className="btn primary small" onClick={saveAsLogo} disabled={logoBusy}>
                  {logoBusy ? 'שומר…' : 'זה הלוגו שלי'}
                </button>
                {logoSaved && (
                  <Link className="status" href="/business/brand" style={{ textDecoration: 'underline' }}>
                    נשמר. למיתוג של העסק ←
                  </Link>
                )}
              </div>
            )}
            {work && (
              <button className="btn primary work-done" onClick={checked(exportPng)} disabled={exporting || outOfDate}>
                {exporting ? 'מכין קובץ…' : 'סיימתי, להורדה'}
              </button>
            )}
            <footer className="panel-foot">
              {editableFields.length > 0 && <p>{words.drag}</p>}
              <p>{words.foot}</p>
            </footer>
          </aside>
        )}
        {full && (
        <aside className="left" aria-label="הוספת אלמנטים">
          {isWording && (
            <p className="hint" role="note" style={{ margin: 0 }}>
              <span>
                נוסח של &quot;{topic}&quot; בגודל הזה. רק הטקסטים נכנסים לנוסח, והרקע כאן הוא לתצוגה בלבד. סמנו בכל שדה של שם, תאריך או מקום &quot;פרט של הלקוח&quot;.
              </span>
            </p>
          )}
          {!isWording && audience === 'private' && topic && <WordingPicker doc={doc} topic={topic} manage drawable={drawable} onPick={pickWording} />}
          <div>
            <h2 className="panel-title">הוספה</h2>
            <div className="row">
              <button className="btn small" onClick={addText}>
                טקסט
              </button>
              <button className="btn small" onClick={addRect}>
                מלבן
              </button>
            </div>
          </div>
          <div>
            <h2 className="panel-title">קווים מפרידים וקישוטים</h2>
            <div className="divider-grid">
              {DIVIDERS.map((d) => (
                <button key={d.id} type="button" className={'divider-pick d-' + d.id} onClick={() => addDivider(d.id)}>
                  <span aria-hidden="true" />
                  {d.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <h2 className="panel-title">שכבות</h2>
            <LayersPanel
              elements={doc.elements}
              selected={selIds}
              onSelect={(elId, add) => (add ? selectEl(elId, true) : selectMany(withGroup(elId).sort((a, b) => (a === elId ? -1 : b === elId ? 1 : 0))))}
              onToggle={(elId, key) => {
                const el = doc.elements.find((x) => x.id === elId);
                if (el) patchElement(elId, { [key]: el[key] ? undefined : true } as Partial<CanvasElement>);
                if (key === 'hidden' && !el?.hidden) setSelectedId(null);
              }}
              onMove={moveTo}
            />
          </div>
          <div>
            <h2 className="panel-title">תמונות מהקטגוריות</h2>
            {library.categories.length === 0 ? (
              <p className="status">
                אין עדיין קטגוריות. <Link href="/categories" style={{ textDecoration: 'underline' }}>צרו קטגוריה והוסיפו תמונות</Link>.
              </p>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                <select value={libCat} onChange={(e) => setLibCat(e.target.value)} aria-label="קטגוריה">
                  {library.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                {libImages.length === 0 ? (
                  <p className="status">אין תמונות בקטגוריה הזו.</p>
                ) : (
                  <div className="pick-grid">
                    {libImages.map((img) => (
                      <button key={img.id} className="pick" title={img.name} onClick={() => addImage(img)}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/api/uploads/${img.file}`} alt={img.name} />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          {canAgent && (
            <AgentPanel
              projectId={id}
              getDoc={() => docRef.current}
              onApply={applyAgent}
                  onBusyChange={setAiBusy}
              placeholder="למשל: הוסף כותרת 'חתונה' ושדות לשמות החתן והכלה"
              suggestions={['הוסף שדות לשמות, תאריך ומקום', 'סדר את הטקסטים במרכז']}
            />
          )}
        </aside>
        )}

        {work ? (
          <>
            <div className="work-stage">
              <div className="ctx-strip">
                {activeEl ? (
                  <>
                    <span className="ctx-now">
                      עורכים עכשיו: <b>{activeEl.label || 'טקסט'}</b>
                    </span>
                    <span className="ctx-sep" aria-hidden="true" />
                    <span className="ctx-label">צבע</span>
                    <div className="swatches" role="group" aria-label={`צבע הטקסט: ${activeEl.label || 'טקסט'}`}>
                      {SWATCHES.map((c) => (
                        <button
                          key={c}
                          type="button"
                          className="swatch"
                          style={{ background: c }}
                          aria-label={`צבע ${c}`}
                          aria-pressed={activeEl.font.color.toLowerCase() === c.toLowerCase()}
                          onClick={() => patchElement(activeEl.id, { font: { ...activeEl.font, color: c } } as Partial<CanvasElement>)}
                        />
                      ))}
                      <input
                        type="color"
                        className="swatch-picker"
                        aria-label="צבע אחר"
                        value={activeEl.font.color}
                        onChange={(e) => patchElement(activeEl.id, { font: { ...activeEl.font, color: e.target.value } } as Partial<CanvasElement>, 'color:' + activeEl.id)}
                      />
                    </div>
                  </>
                ) : (
                  <span className="ctx-idle">לחצו על טקסט בכרטיס או על שדה, וכאן יופיעו הצבעים שלו.</span>
                )}
                <span className="ctx-count">{editableFields.length} שדות פתוחים</span>
              </div>
              {stage}
              <div className="zoom-pill">
                <button type="button" aria-label="הקטנה" onClick={() => setZoomOverride(clamp(zoom - 0.1, 0.1, 3))}>
                  −
                </button>
                <span className="zoom-pct">{Math.round(zoom * 100)}%</span>
                <button type="button" aria-label="הגדלה" onClick={() => setZoomOverride(clamp(zoom + 0.1, 0.1, 3))}>
                  +
                </button>
                <span className="ctx-sep" aria-hidden="true" />
                <span>
                  {preset ? preset.label.split(' ')[0] + ' · ' : ''}
                  {doc.page.width_mm}×{doc.page.height_mm} מ״מ
                </span>
              </div>
            </div>
            <div className="work-tabs" role="tablist" aria-label="מה עורכים">
              {([['details', 'פרטים'], ...libTabs.map((t) => [t[0], t[1]] as const)] as const).map(([id, label]) => (
                <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
                  {label}
                </button>
              ))}
            </div>
            {shown && (
              <aside className="work-lib" aria-label={shown[2]}>
                <div className="lib-panel">
                  <header className="work-head">
                    <span className="num">2</span>
                    <h2>{shown[2]}</h2>
                    {shown[0] === 'wordings' && <p>כל הטקסט של הכרטיס בבת אחת. לחיצה מניחה אותו על הרקע הנוכחי.</p>}
                    {shown[0] === 'backdrops' && <p>כל רקע מוצג עם הנוסח שלכם, והצבע של הטקסט מתאים את עצמו.</p>}
                  </header>
                  {shown[0] === 'wordings' && wordingPicker}
                  {shown[0] === 'backdrops' && (
                    <>
                      {backdropPicker}
                      {swapPickers}
                    </>
                  )}
                  {shown[0] === 'stickers' && stickerPicker}
                  {shown[0] === 'agent' && agent}
                </div>
                <nav className="lib-rail" aria-label="ספריות">
                  {libTabs.map(([id, label]) => (
                    <button key={id} type="button" aria-pressed={shown[0] === id} onClick={() => setTab(id)}>
                      <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d={TAB_ICON[id]} />
                      </svg>
                      {label}
                    </button>
                  ))}
                </nav>
              </aside>
            )}
          </>
        ) : (
          stage
        )}

        {full && (
        <aside className="right" aria-label="מאפיינים">
          {!selected ? (
            <>
              <h2 className="panel-title">הגדרות עמוד</h2>
              <label className="field">
                גודל
                <select
                  value={PAGE_PRESETS.find((p) => p.width_mm === doc.page.width_mm && p.height_mm === doc.page.height_mm)?.id ?? 'custom'}
                  onChange={(e) => {
                    const p = PAGE_PRESETS.find((x) => x.id === e.target.value);
                    if (p) setPage({ width_mm: p.width_mm, height_mm: p.height_mm });
                  }}
                >
                  <option value="custom" disabled>
                    מותאם אישית
                  </option>
                  {PAGE_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="row" style={{ alignItems: 'end' }}>
                <label className="field">
                  צבע רקע
                  <input type="color" value={doc.page.background} onChange={(e) => setPage({ background: e.target.value }, 'bg')} />
                </label>
                <label className="row" style={{ gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={!!doc.page.background2}
                    onChange={(e) => setPage(e.target.checked ? { background2: '#FFFFFF', backgroundAngle: 90 } : { background2: undefined, backgroundAngle: undefined })}
                  />
                  <span>מעבר צבע</span>
                </label>
                {doc.page.background2 && (
                  <>
                    <label className="field">
                      אל
                      <input type="color" value={doc.page.background2} onChange={(e) => setPage({ background2: e.target.value }, 'bg2')} />
                    </label>
                    <label className="field" style={{ width: 76 }}>
                      זווית (°)
                      <input type="number" min={-360} max={360} value={doc.page.backgroundAngle ?? 90} onChange={(e) => { const v = num(e.target.value); if (v !== null) setPage({ backgroundAngle: clamp(v, -360, 360) }, 'bgangle'); }} />
                    </label>
                  </>
                )}
              </div>
              <label className="row" style={{ gap: 8 }}>
                <input type="checkbox" checked={showSafe} onChange={(e) => setShowSafe(e.target.checked)} />
                <span>קו אזור בטוח להדפסה ({SAFE_MM} מ״מ מהקצה). לא מופיע בהורדה.</span>
              </label>
              <p className="status">גוררים מהסרגלים כדי להוסיף קו עזר, ומחוץ לדף כדי להסיר אותו. גלגלת עם Ctrl מגדילה, ורווח עם גרירה מזיז את התצוגה.</p>
              <p className="status">בחרו אלמנט על הדף כדי לערוך אותו. מקשי החיצים מזיזים, Delete מוחק, Ctrl+Z מבטל.</p>
            </>
          ) : (
            <>
              <div className="align-box">
                <h3 className="panel-title">{selIds.length > 1 ? `${selIds.length} אלמנטים נבחרו` : 'יישור לדף'}</h3>
                <div className="align-row" role="group" aria-label="יישור">
                  {(
                    [
                      ['right', 'לימין', 'M20 4v16M6 8h10v3H6zM9 13h7v3H9z'],
                      ['hcenter', 'למרכז', 'M12 4v16M6 8h12v3H6zM8 13h8v3H8z'],
                      ['left', 'לשמאל', 'M4 4v16M8 8h10v3H8zM8 13h7v3H8z'],
                      ['top', 'למעלה', 'M4 4h16M8 8h3v10H8zM13 8h3v7h-3z'],
                      ['vmiddle', 'לאמצע', 'M4 12h16M8 6h3v12H8zM13 8h3v8h-3z'],
                      ['bottom', 'למטה', 'M4 20h16M8 6h3v10H8zM13 9h3v7h-3z'],
                    ] as const
                  ).map(([how, label, d]) => (
                    <button key={how} type="button" className="icon-btn" title={label} aria-label={label} onClick={() => alignSel(how)}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                        <path d={d} />
                      </svg>
                    </button>
                  ))}
                </div>
                {selIds.length > 2 && (
                  <div className="row">
                    <button className="btn small" onClick={() => distributeSel('x')}>רווחים שווים לרוחב</button>
                    <button className="btn small" onClick={() => distributeSel('y')}>רווחים שווים לגובה</button>
                  </div>
                )}
                <div className="row">
                  {selIds.length > 1 && (
                    <button className="btn small" onClick={groupSelected} title="Ctrl+G">
                      קיבוץ
                    </button>
                  )}
                  {doc.elements.some((x) => selIds.includes(x.id) && x.group) && (
                    <button className="btn small" onClick={ungroupSelected} title="Ctrl+Shift+G">
                      פירוק קבוצה
                    </button>
                  )}
                  <button className="btn small" aria-pressed={!!selected.locked} onClick={() => patchMany(selIds, () => ({ locked: selected.locked ? undefined : true }))}>
                    {selected.locked ? 'שחרור נעילה' : 'נעילה'}
                  </button>
                </div>
              </div>
              <h2 className="panel-title">
                {selected.type === 'text' ? 'טקסט' : selected.type === 'image' ? 'תמונה' : 'מלבן'}
              </h2>

              {textEl && (
                <>
                  <label className="field">
                    תוכן
                    <textarea
                      rows={3}
                      dir="auto"
                      value={textEl.text}
                      onChange={(e) => updateText({ text: e.target.value }, 'text:' + textEl.id)}
                    />
                  </label>
                  <div className="field">
                    <span>פונט</span>
                    <FontPicker
                      value={textEl.font.family}
                      sample={textEl.text}
                      builtIn={FONTS}
                      uploaded={uploadedFonts.map((u) => u.family)}
                      bold={textEl.font.weight === 700}
                      onPick={(family) => updateText({ font: { ...textEl.font, family } })}
                    />
                  </div>
                  <div className="row" style={{ alignItems: 'end' }}>
                    <label className="field" style={{ width: 90 }}>
                      גודל (pt)
                      <input
                        type="number"
                        min={4}
                        max={400}
                        value={textEl.font.size_pt}
                        onChange={(e) => {
                          const v = num(e.target.value);
                          if (v !== null) updateText({ font: { ...textEl.font, size_pt: clamp(v, 4, 400) } }, 'size:' + textEl.id);
                        }}
                      />
                    </label>
                    <label className="field">
                      צבע
                      <input type="color" value={textEl.font.color} onChange={(e) => updateText({ font: { ...textEl.font, color: e.target.value } }, 'color:' + textEl.id)} />
                    </label>
                    <div className="seg" role="group" aria-label="משקל">
                      <button aria-pressed={textEl.font.weight === 700} onClick={() => updateText({ font: { ...textEl.font, weight: textEl.font.weight === 700 ? 400 : 700 } })}>
                        מודגש
                      </button>
                    </div>
                  </div>
                  <div className="card" style={{ display: 'grid', gap: 8, padding: 12 }}>
                    <label className="row" style={{ gap: 8 }}>
                      <input
                        type="checkbox"
                        checked={!!textEl.editable}
                        onChange={(e) => updateText({ editable: e.target.checked })}
                      />
                      <span>הלקוח יכול לערוך את הטקסט</span>
                    </label>
                    {textEl.editable && (
                      <label className="field">
                        שם השדה שהלקוח רואה
                        <input
                          type="text"
                          maxLength={60}
                          value={textEl.label ?? ''}
                          placeholder="למשל: שם החתן"
                          onChange={(e) => updateText({ label: e.target.value }, 'label:' + textEl.id)}
                        />
                      </label>
                    )}
                    {(isWording || audience === 'private') && (
                      <label className="row" style={{ gap: 8 }}>
                        <input type="checkbox" checked={!!textEl.detail} onChange={(e) => updateText({ detail: e.target.checked || undefined })} />
                        <span>פרט של הלקוח: נכתב פעם אחת לכל הסט, ונשאר כשמחליפים נוסח (לפי שם השדה)</span>
                      </label>
                    )}
                    <label className="field">
                      פרט מהמיתוג של העסק
                      <select value={textEl.role ?? ''} onChange={(e) => updateText({ role: isBrandTextRole(e.target.value) ? e.target.value : undefined })}>
                        <option value="">בלי (טקסט רגיל)</option>
                        {BRAND_TEXT_ROLES.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      צבע מהמיתוג של העסק
                      <select value={textEl.colorRole ?? ''} onChange={(e) => updateText({ colorRole: isBrandColorRole(e.target.value) ? e.target.value : undefined })}>
                        <option value="">בלי (הצבע שנבחר)</option>
                        {BRAND_COLOR_ROLES.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="seg" role="group" aria-label="יישור">
                    {(['right', 'center', 'left'] as const).map((a) => (
                      <button key={a} aria-pressed={textEl.align === a} onClick={() => updateText({ align: a })}>
                        {a === 'right' ? 'ימין' : a === 'center' ? 'מרכז' : 'שמאל'}
                      </button>
                    ))}
                  </div>
                  <div className="field">
                    <span>ריווח</span>
                    <div className="spacing-grid">
                      <label htmlFor="ls-range">בין אותיות</label>
                      <input id="ls-range" type="range" min={-5} max={30} step={0.5} value={textEl.letterSpacing ?? 0} onChange={(e) => updateText({ letterSpacing: Number(e.target.value) || undefined }, 'ls:' + textEl.id)} />
                      <output>{textEl.letterSpacing ?? 0}</output>
                      <label htmlFor="lh-range">בין שורות</label>
                      <input id="lh-range" type="range" min={0.8} max={2.5} step={0.05} value={textEl.lineHeight ?? LINE_HEIGHT} onChange={(e) => updateText({ lineHeight: Number(e.target.value) === LINE_HEIGHT ? undefined : Number(e.target.value) }, 'lh:' + textEl.id)} />
                      <output>{(textEl.lineHeight ?? LINE_HEIGHT).toFixed(2)}</output>
                    </div>
                  </div>
                  <label className="field">
                    טקסט ארוך
                    <select value={textEl.fit ?? ''} onChange={(e) => updateText({ fit: e.target.value === 'shrink' ? 'shrink' : undefined })}>
                      <option value="">גולש לשורה הבאה</option>
                      <option value="shrink">קטן עד שכל שורה נכנסת ברוחב</option>
                    </select>
                  </label>
                  <div className="field">
                    <span>אפקטים</span>
                    <label className="row" style={{ gap: 8 }}>
                      <input type="checkbox" checked={!!textEl.shadow} onChange={(e) => updateText({ shadow: e.target.checked || undefined })} />
                      <span>צל עדין</span>
                    </label>
                    <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                      <label className="row" style={{ gap: 8 }}>
                        <input type="checkbox" checked={!!textEl.stroke} onChange={(e) => updateText({ stroke: e.target.checked ? { color: '#4A3210', width_mm: 0.3 } : undefined })} />
                        <span>קו מתאר</span>
                      </label>
                      {textEl.stroke && (
                        <>
                          <input type="color" aria-label="צבע קו המתאר" value={textEl.stroke.color} onChange={(e) => updateText({ stroke: { ...textEl.stroke!, color: e.target.value } }, 'stroke:' + textEl.id)} />
                          <input type="number" aria-label="עובי קו המתאר במ״מ" style={{ width: 64 }} min={0.05} max={10} step={0.05} value={textEl.stroke.width_mm} onChange={(e) => { const v = num(e.target.value); if (v !== null) updateText({ stroke: { ...textEl.stroke!, width_mm: clamp(v, 0.05, 10) } }, 'strokew:' + textEl.id); }} />
                        </>
                      )}
                    </div>
                    <div className="seg" role="group" aria-label="מילוי מתכתי">
                      {([['', 'צבע רגיל'], ['gold', 'רדיד זהב'], ['silver', 'רדיד כסף']] as const).map(([f, label]) => (
                        <button key={f} aria-pressed={(textEl.foil ?? '') === f} onClick={() => updateText({ foil: f || undefined })}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="field">
                    <span>סגנונות שמורים</span>
                    <TextStylesPicker text={textEl} onApply={(look) => updateText(look)} />
                  </div>
                  <div className="field arc-field">
                    <label htmlFor="arc-range">קשת</label>
                    <div className="arc-row">
                      <input
                        id="arc-range"
                        type="range"
                        min={-ARC_LIMIT}
                        max={ARC_LIMIT}
                        value={textEl.arc ?? 0}
                        onChange={(e) => updateText({ arc: Number(e.target.value) || undefined }, 'arc:' + textEl.id)}
                      />
                      <input
                        type="number"
                        aria-label="קשת במספר"
                        min={-ARC_LIMIT}
                        max={ARC_LIMIT}
                        value={textEl.arc ?? 0}
                        onChange={(e) => {
                          const v = num(e.target.value);
                          if (v !== null) updateText({ arc: clamp(Math.round(v), -ARC_LIMIT, ARC_LIMIT) || undefined }, 'arc:' + textEl.id);
                        }}
                      />
                    </div>
                    <span className="status">למעלה כמו קשת בענן, למטה כמו חיוך. האותיות עומדות על המעגל, וטקסט בקשת הוא שורה אחת.</span>
                  </div>
                </>
              )}

              {selected.type === 'rect' && (
                <>
                  <label className="field">
                    צבע מילוי
                    <input type="color" value={selected.fill} onChange={(e) => patchElement(selected.id, { fill: e.target.value }, 'fill:' + selected.id)} />
                  </label>
                  <label className="row" style={{ gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={selected.role === 'logoPlate'}
                      onChange={(e) => patchElement(selected.id, { role: e.target.checked ? 'logoPlate' : undefined } as Partial<CanvasElement>)}
                    />
                    <span>משטח מאחורי הלוגו (יורד כשלעסק אין לוגו)</span>
                  </label>
                  <div className="row">
                    <label className="field" style={{ width: 110 }}>
                      פינות מעוגלות (מ״מ)
                      <input
                        type="number"
                        min={0}
                        max={1000}
                        value={selected.cornerRadius_mm ?? 0}
                        onChange={(e) => {
                          const v = num(e.target.value);
                          if (v !== null) patchElement(selected.id, { cornerRadius_mm: clamp(v, 0, 1000) } as Partial<CanvasElement>, 'radius:' + selected.id);
                        }}
                      />
                    </label>
                    <label className="field" style={{ width: 90 }}>
                      אטימות (%)
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={Math.round((selected.opacity ?? 1) * 100)}
                        onChange={(e) => {
                          const v = num(e.target.value);
                          if (v !== null) patchElement(selected.id, { opacity: clamp(v, 0, 100) / 100 } as Partial<CanvasElement>, 'opacity:' + selected.id);
                        }}
                      />
                    </label>
                  </div>
                  <div className="row" style={{ alignItems: 'end' }}>
                    <label className="row" style={{ gap: 6 }}>
                      <input type="checkbox" checked={!!selected.fill2} onChange={(e) => patchElement(selected.id, (e.target.checked ? { fill2: '#FFFFFF', angle: 90 } : { fill2: undefined, angle: undefined }) as Partial<CanvasElement>)} />
                      <span>מעבר צבע</span>
                    </label>
                    {selected.fill2 && (
                      <>
                        <label className="field">
                          אל
                          <input type="color" value={selected.fill2} onChange={(e) => patchElement(selected.id, { fill2: e.target.value } as Partial<CanvasElement>, 'fill2:' + selected.id)} />
                        </label>
                        <label className="field" style={{ width: 76 }}>
                          זווית (°)
                          <input type="number" min={-360} max={360} value={selected.angle ?? 90} onChange={(e) => { const v = num(e.target.value); if (v !== null) patchElement(selected.id, { angle: clamp(v, -360, 360) } as Partial<CanvasElement>, 'angle:' + selected.id); }} />
                        </label>
                      </>
                    )}
                  </div>
                  <label className="field">
                    צבע מהמיתוג של העסק
                    <select
                      value={selected.colorRole ?? ''}
                      onChange={(e) => patchElement(selected.id, { colorRole: isBrandColorRole(e.target.value) ? e.target.value : undefined } as Partial<CanvasElement>)}
                    >
                      <option value="">בלי (הצבע שנבחר)</option>
                      {BRAND_COLOR_ROLES.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}

              {selected.type === 'image' && (
                <>
                  <p className="status">{assetById.get(selected.asset_id)?.name ?? 'התמונה נמחקה מהקטגוריה'}</p>
                  <div className="field">
                    <span>צורת התמונה</span>
                    <div className="seg" role="group" aria-label="צורת התמונה">
                      {([['', 'מלבן'], ['rounded', 'פינות עגולות'], ['circle', 'עיגול'], ['arch', 'קשת']] as const).map(([m, label]) => (
                        <button key={m} aria-pressed={(selected.mask ?? '') === m} onClick={() => patchElement(selected.id, { mask: m || undefined } as Partial<CanvasElement>)}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="field">
                    <label className="row" style={{ gap: 8 }}>
                      <input type="checkbox" checked={!!selected.crop} onChange={(e) => patchElement(selected.id, { crop: e.target.checked ? { zoom: 1, x: 0, y: 0 } : undefined } as Partial<CanvasElement>)} />
                      <span>חיתוך בתוך המסגרת (התמונה ממלאת את המסגרת בלי להימתח)</span>
                    </label>
                    {selected.crop && (
                      <div className="spacing-grid">
                        {([['zoom', 'קירוב', 1, 4, 0.05], ['x', 'ימינה ושמאלה', -1, 1, 0.02], ['y', 'למעלה ולמטה', -1, 1, 0.02]] as const).map(([k, label, min, max, step]) => (
                          <span key={k} style={{ display: 'contents' }}>
                            <label htmlFor={'crop-' + k}>{label}</label>
                            <input id={'crop-' + k} type="range" min={min} max={max} step={step} value={selected.crop![k]} onChange={(e) => patchElement(selected.id, { crop: { ...selected.crop!, [k]: Number(e.target.value) } } as Partial<CanvasElement>, 'crop:' + selected.id)} />
                            <output>{selected.crop![k].toFixed(2)}</output>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="card" style={{ display: 'grid', gap: 8, padding: 12 }}>
                    <label className="row" style={{ gap: 8 }}>
                      <input
                        type="checkbox"
                        checked={!!selected.swappable}
                        onChange={(e) =>
                          patchElement(selected.id, {
                            swappable: e.target.checked,
                            swapCategoryId: selected.swapCategoryId ?? assetById.get(selected.asset_id)?.categoryId,
                            label: selected.label ?? 'רקע',
                          } as Partial<CanvasElement>)
                        }
                      />
                      <span>הלקוח יכול להחליף את התמונה</span>
                    </label>
                    <label className="row" style={{ gap: 8 }}>
                      <input
                        type="checkbox"
                        checked={selected.role === 'logo'}
                        onChange={(e) => patchElement(selected.id, { role: e.target.checked ? 'logo' : undefined } as Partial<CanvasElement>)}
                      />
                      <span>כאן יופיע הלוגו של העסק</span>
                    </label>
                    {selected.swappable && (
                      <>
                        <label className="field">
                          שם שהלקוח רואה
                          <input
                            type="text"
                            maxLength={60}
                            value={selected.label ?? ''}
                            placeholder="למשל: רקע"
                            onChange={(e) => patchElement(selected.id, { label: e.target.value } as Partial<CanvasElement>, 'label:' + selected.id)}
                          />
                        </label>
                        <label className="field">
                          הלקוח בוחר מהקטגוריה
                          <select
                            value={selected.swapCategoryId ?? ''}
                            onChange={(e) => patchElement(selected.id, { swapCategoryId: e.target.value } as Partial<CanvasElement>)}
                          >
                            {library.categories.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      </>
                    )}
                  </div>
                </>
              )}

              <div className="row">
                {(
                  [
                    ['x_mm', 'X'],
                    ['y_mm', 'Y'],
                    ['w_mm', 'רוחב'],
                    ...(selected.type !== 'text' ? [['h_mm', 'גובה']] : []),
                  ] as [string, string][]
                ).map(([k, label]) => (
                  <label key={k} className="field" style={{ width: 76 }}>
                    {label} (מ״מ)
                    <input
                      type="number"
                      step={1}
                      value={Math.round((selected as unknown as Record<string, number>)[k] * 10) / 10}
                      onChange={(e) => {
                        const v = num(e.target.value);
                        if (v === null) return;
                        const min = k === 'w_mm' || k === 'h_mm' ? 1 : -5000;
                        patchElement(selected.id, { [k]: clamp(v, min, 5000) } as Partial<CanvasElement>, `${k}:${selected.id}`);
                      }}
                    />
                  </label>
                ))}
                <label className="field" style={{ width: 76 }}>
                  סיבוב (°)
                  <input
                    type="number"
                    step={1}
                    value={Math.round(selected.rotation * 10) / 10}
                    onChange={(e) => {
                      const v = num(e.target.value);
                      if (v !== null) patchElement(selected.id, { rotation: clamp(v, -360, 360) }, 'rot:' + selected.id);
                    }}
                  />
                </label>
              </div>

              <div>
                <h3 className="panel-title">סדר שכבות</h3>
                <div className="row">
                  <button className="btn small" onClick={() => moveZ('front')}>לחזית</button>
                  <button className="btn small" onClick={() => moveZ('up')}>קדימה</button>
                  <button className="btn small" onClick={() => moveZ('down')}>אחורה</button>
                  <button className="btn small" onClick={() => moveZ('back')}>לרקע</button>
                </div>
              </div>

              <div className="row">
                <button className="btn small" onClick={duplicateSelected}>שכפול</button>
                <button className="btn small danger" onClick={removeSelected}>מחיקה</button>
              </div>
            </>
          )}
        </aside>
        )}
      </div>
    </div>
  );
}
