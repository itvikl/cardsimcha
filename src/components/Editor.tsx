'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Stage, Layer, Rect, Text, Image as KImage, Transformer } from 'react-konva';
import useImage from 'use-image';
import type Konva from 'konva';
import { BRAND_COLOR_ROLES, BRAND_TEXT_ROLES, isBrandColorRole, isBrandTextRole } from '@/lib/brand';
import { FONTS, PAGE_PRESETS } from '@/lib/canvas';
import { categoryHref, LOGO_TOPIC, type Audience } from '@/lib/categories';
import { SHABBAT_TOPIC } from '@/lib/shabbatDoc';
import { formatPrice } from '@/lib/price';
import { VIDEO_WIDTH } from '@/lib/shabbatLoops';
import { trimTransparent } from '@/lib/trimCanvas';
import { newImage, newRect, newText } from '@/lib/elements';
import { useToast } from './Toast';
import { AgentPanel } from './AgentPanel';
import { landCard } from './CardFlight';
import { setDoor } from './SiteBackdrop';
import { DownloadIcon, FitIcon, RedoIcon, UndoIcon } from './Icons';
import type { CanvasDoc, CanvasElement, Category, ImageAsset, Project, TextElement } from '@/lib/types';

const PX = 3; // canvas pixels per mm at zoom 1
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
    suggestions: ['תציע לי שלושה כיוונים למודעה', 'חדד לי את הכותרת', 'קצר את הנוסח'],
  },
} satisfies Record<Audience, unknown>;

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
  onSelect: () => void;
  onChange: (patch: Partial<CanvasElement>) => void;
}) {
  const [img, status] = useImage(asset ? `/api/uploads/${asset.file}` : '');
  const common = {
    id: el.id,
    x: el.x_mm * PX,
    y: el.y_mm * PX,
    width: el.w_mm * PX,
    height: el.h_mm * PX,
    rotation: el.rotation,
    draggable: interactive,
    onMouseDown: interactive ? onSelect : undefined,
    onTap: interactive ? onSelect : undefined,
    onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => onChange({ x_mm: e.target.x() / PX, y_mm: e.target.y() / PX }),
    onTransformEnd: (e: Konva.KonvaEventObject<Event>) => {
      const n = e.target;
      const w = n.width() * n.scaleX();
      const h = n.height() * n.scaleY();
      n.scaleX(1);
      n.scaleY(1);
      onChange({ x_mm: n.x() / PX, y_mm: n.y() / PX, w_mm: w / PX, h_mm: h / PX, rotation: n.rotation() });
    },
  };
  if (el.colorOverride) return <Rect {...common} fill={el.colorOverride} />;
  if (!asset || status === 'failed') {
    return <Rect {...common} fill="#f0e6e4" stroke="#a33a2e" strokeWidth={2} dash={[10, 6]} />;
  }
  if (!img) return <Rect {...common} fill="rgba(0,0,0,0)" listening={false} />;
  return <KImage {...common} image={img} />;
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
  const [activeField, setActiveField] = useState<string | null>(null);
  const [hintOpen, setHintOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiTouched, setAiTouched] = useState<Set<string>>(new Set());
  const aiTimer = useRef<number | undefined>(undefined);
  const { push } = useToast();
  const fieldRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const [doc, setDoc] = useState<CanvasDoc | null>(null);
  const [name, setName] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [library, setLibrary] = useState<{ categories: Category[]; images: ImageAsset[] }>({ categories: [], images: [] });
  const [libCat, setLibCat] = useState<string>('');
  const [zoomOverride, setZoomOverride] = useState<number | null>(null);
  const [fit, setFit] = useState(0.5);
  /** the canvas has its real fitted size (not the 0.5 placeholder) */
  const [fitted, setFitted] = useState(false);
  const [save, setSave] = useState<SaveState>('saved');
  const [loadError, setLoadError] = useState('');
  const [fontsTick, setFontsTick] = useState(0);

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
        const p: Project & { canManage: boolean; canAgent: boolean; topic: string | null; audience: Audience; billing: Billing; shabbatOutOfDate: boolean; hasVideo: boolean } = await pRes.json();
        setBilling(p.billing);
        setOutOfDate(p.shabbatOutOfDate);
        setHasVideo(p.hasVideo);
        setTopic(p.topic);
        setAudience(p.audience);
        setCanManage(p.canManage);
        setCanAgent(p.canAgent);
        setPubStatus(p.status);
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

  // a business's ad takes that door's look, around the editor too
  useEffect(() => {
    setDoor(audience);
    return () => setDoor(null);
  }, [audience]);

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
    Promise.allSettled(loads).then(() => alive && setFontsTick((n) => n + 1));
    return () => {
      alive = false;
    };
  }, []);

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
  }, [doc?.page.width_mm, doc?.page.height_mm, !!doc]); // eslint-disable-line react-hooks/exhaustive-deps

  const zoom = zoomOverride ?? fit;

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

  // ---- history-aware updates ----------------------------------------------
  // The current doc and the undo/redo stacks live in refs so updates stay free of
  // side effects inside state updaters; `setDoc` just triggers the re-render.
  const docRef = useRef<CanvasDoc | null>(null);
  const pastRef = useRef<CanvasDoc[]>([]);
  const futureRef = useRef<CanvasDoc[]>([]);
  const [, bump] = useState(0);
  docRef.current = doc;

  const commit = useCallback((next: CanvasDoc, mergeKey?: string) => {
    const cur = docRef.current;
    if (cur) {
      const now = Date.now();
      const merge = !!mergeKey && lastMerge.current?.key === mergeKey && now - lastMerge.current.at < 1000;
      lastMerge.current = mergeKey ? { key: mergeKey, at: now } : null;
      if (!merge) pastRef.current = [...pastRef.current.slice(-(HISTORY_LIMIT - 1)), cur];
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

  const undo = useCallback(() => {
    const cur = docRef.current;
    const prev = pastRef.current[pastRef.current.length - 1];
    if (!cur || !prev) return;
    pastRef.current = pastRef.current.slice(0, -1);
    futureRef.current = [cur, ...futureRef.current];
    lastMerge.current = null;
    docRef.current = prev;
    setDoc(prev);
    setSave('dirty');
    bump((n) => n + 1);
  }, []);

  const redo = useCallback(() => {
    const cur = docRef.current;
    const next = futureRef.current[0];
    if (!cur || !next) return;
    futureRef.current = futureRef.current.slice(1);
    pastRef.current = [...pastRef.current, cur];
    lastMerge.current = null;
    docRef.current = next;
    setDoc(next);
    setSave('dirty');
    bump((n) => n + 1);
  }, []);

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
        if (!res.ok) throw new Error();
        // a newer edit may have arrived while saving; only mark saved if nothing changed
        setSave((s) => (s === 'saving' ? 'saved' : s));
      } catch {
        setSave('error');
        push('השמירה נכשלה. בדקו את החיבור ונסו שוב.', 'error');
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

  const removeSelected = useCallback(() => {
    const doc = docRef.current;
    if (!doc || !selectedId) return;
    commit({ ...doc, elements: normalize(doc.elements.filter((e) => e.id !== selectedId)) });
    setSelectedId(null);
  }, [doc, selectedId, commit]);

  const duplicateSelected = useCallback(() => {
    const doc = docRef.current;
    if (!doc || !selected) return;
    addElement({ ...selected, id: crypto.randomUUID(), x_mm: selected.x_mm + 5, y_mm: selected.y_mm + 5, z: doc.elements.length });
  }, [doc, selected]); // eslint-disable-line react-hooks/exhaustive-deps

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
    const tr = trRef.current;
    tr?.visible(false);
    stage.draw();
    const url = stage.toDataURL({ pixelRatio: 600 / stage.width(), mimeType: 'image/jpeg', quality: 0.7 });
    tr?.visible(true);
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
      if (!res.ok) throw new Error();
      setPubStatus(status);
      setSave((v) => (v === 'dirty' ? v : 'saved'));
      push(status === 'published' ? 'התבנית פורסמה. לקוחות רואים אותה עכשיו בגלריה.' : 'הפרסום בוטל. הלקוחות כבר לא רואים את התבנית.', 'success');
    } catch {
      push('הפעולה נכשלה. נסו שוב.', 'error');
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
      const tr = trRef.current;
      tr?.visible(false);
      stage.draw();
      const ratio = ((doc.page.width_mm / 25.4) * 300) / stage.width();
      const url = stage.toDataURL({ pixelRatio: ratio, mimeType: 'image/png' });
      tr?.visible(true);
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
      trRef.current?.visible(false);
      pageRef.current?.visible(false);
      hidden.forEach((n) => n?.visible(false));
      stage.draw();
      const overlay = stage.toCanvas({ pixelRatio: VIDEO_WIDTH / stage.width() });
      trRef.current?.visible(true);
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

  /** Keeps this design as the business's logo: no page behind it and no empty margin, so it sits cleanly on any ad. */
  const saveAsLogo = async () => {
    const stage = stageRef.current;
    if (!stage || logoBusy) return;
    setLogoBusy(true);
    try {
      trRef.current?.visible(false);
      pageRef.current?.visible(false);
      stage.draw();
      const drawn = stage.toCanvas({ pixelRatio: 1600 / stage.width() });
      trRef.current?.visible(true);
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
    const target = canManage ? selectedId : activeField;
    const node = target ? stage.findOne('#' + target) : null;
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [selectedId, activeField, canManage, doc, fontsTick]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable]')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (!canManage && !(mod && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y'))) return;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicateSelected();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault();
        removeSelected();
      } else if (e.key === 'Escape') {
        setSelectedId(null);
      } else if (selected && e.key.startsWith('Arrow')) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        patchElement(selected.id, { x_mm: selected.x_mm + dx, y_mm: selected.y_mm + dy }, 'nudge:' + selected.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, duplicateSelected, removeSelected, selectedId, selected, patchElement, canManage]);

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

  const full = canManage;
  const words = WORDS[audience];
  const swappables = doc.elements.filter((e): e is Extract<CanvasElement, { type: 'image' }> => e.type === 'image' && !!e.swappable);
  const editableFields = doc.elements.filter((e): e is TextElement => e.type === 'text' && !!e.editable);
  const textEl = selected?.type === 'text' ? selected : null;
  const updateText = (patch: Partial<TextElement>, key?: string) => selected && patchElement(selected.id, patch, key);
  const num = (v: string) => (v === '' || Number.isNaN(Number(v)) ? null : Number(v));

  return (
    <div className={audience === 'business' ? 'editor-wrap for-business' : 'editor-wrap'}>
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
        </span>
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
          <button className="btn small" onClick={exportVideo} disabled={videoBusy}>
            {videoBusy ? 'מכין סרטון… (עד דקה)' : 'הורדת סרטון לסטטוס'}
          </button>
        )}
        <button className="btn primary small shine" onClick={exportPng} disabled={exporting || outOfDate}>
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

      <div className={'editor' + (full ? '' : ' customer')}>
        {!full && (
          <aside className="left" aria-label={words.panelLabel}>
            <header className="panel-head" style={{ order: -3 }}>
              <h2>{words.panelTitle}</h2>
              <p>{words.panelLead}</p>
            </header>
            {hintOpen && (
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
            {canAgent && (editableFields.length > 0 || swappables.length > 0) && (
              <div style={{ order: -2 }}>
                <AgentPanel
                  projectId={id}
                  getDoc={() => docRef.current}
                  onApply={applyAgent}
                  onBusyChange={setAiBusy}
                  placeholder={words.placeholder}
                  suggestions={words.suggestions}
                  audience={audience}
                />
              </div>
            )}
            {editableFields.length === 0 && swappables.length === 0 ? (
              <p className="status">בתבנית הזו אין שדות לעריכה.</p>
            ) : (
              editableFields.map((f) => (
                <div key={f.id} className={'field field-card' + (aiTouched.has(f.id) ? ' ai-touched' : '')}>
                  <div className="field-head">
                    <label htmlFor={`f-${f.id}`}>{f.label || 'טקסט'}</label>
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
                </div>
              ))
            )}
            {swappables.map((el) => {
              const options = library.images.filter((i) => !el.swapCategoryId || i.categoryId === el.swapCategoryId);
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
                          onClick={() => patchElement(el.id, { asset_id: img.id, colorOverride: undefined } as Partial<CanvasElement>)}
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
                          onClick={() => patchElement(el.id, { colorOverride: c } as Partial<CanvasElement>)}
                        />
                      ))}
                      <input
                        type="color"
                        className="swatch-picker"
                        aria-label="צבע אחיד חופשי"
                        value={el.colorOverride ?? '#faf8f3'}
                        onChange={(e) => patchElement(el.id, { colorOverride: e.target.value } as Partial<CanvasElement>, 'bgcolor:' + el.id)}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
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
            <footer className="panel-foot">
              {editableFields.length > 0 && <p>{words.drag}</p>}
              <p>{words.foot}</p>
            </footer>
          </aside>
        )}
        {full && (
        <aside className="left" aria-label="הוספת אלמנטים">
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

        <div
          className="stage-wrap"
          ref={wrapRef}
          onMouseDown={(e) => e.target === e.currentTarget && setSelectedId(null)}
        >
          <div
            className={'stage-frame' + (aiBusy ? ' ai-working' : '') + (aiTouched.size ? ' ai-done' : '')}
            style={{ width: pageW * zoom, height: pageH * zoom }}
          >
            <Stage
              ref={stageRef}
              width={pageW * zoom}
              height={pageH * zoom}
              scaleX={zoom}
              scaleY={zoom}
              onMouseDown={(e) => {
                if (e.target === e.target.getStage()) {
                  setSelectedId(null);
                  setActiveField(null);
                }
              }}
            >
              <Layer>
                <Rect ref={pageRef} x={0} y={0} width={pageW} height={pageH} fill={doc.page.background} onMouseDown={() => { setSelectedId(null); setActiveField(null); }} onTap={() => { setSelectedId(null); setActiveField(null); }} />
                {doc.elements.map((el) => {
                  const onSelect = () => setSelectedId(el.id);
                  const focusField = () => {
                    if (el.type !== 'text' || !el.editable) return;
                    setActiveField(el.id);
                    fieldRefs.current[el.id]?.focus({ preventScroll: false });
                  };
                  const onChange = (patch: Partial<CanvasElement>) => patchElement(el.id, patch);
                  if (el.type === 'image') {
                    return <ImageNode key={el.id} el={el} asset={assetById.get(el.asset_id)} interactive={full} onSelect={onSelect} onChange={onChange} />;
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
                        cornerRadius={(el.cornerRadius_mm ?? 0) * PX}
                        opacity={el.opacity ?? 1}
                        draggable={full}
                        onMouseDown={full ? onSelect : undefined}
                        onTap={full ? onSelect : undefined}
                        onDragEnd={(e) => onChange({ x_mm: e.target.x() / PX, y_mm: e.target.y() / PX })}
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
                  return (
                    <Text
                      key={`${el.id}-${fontsTick}`}
                      id={el.id}
                      x={el.x_mm * PX}
                      y={el.y_mm * PX}
                      width={el.w_mm * PX}
                      rotation={el.rotation}
                      text={el.text}
                      align={el.align}
                      // explicit, not inherited: the PNG and the preview are drawn on a canvas off the page, which is left-to-right
                      direction="rtl"
                      fontFamily={el.font.family}
                      fontStyle={el.font.weight === 700 ? 'bold' : 'normal'}
                      fontSize={el.font.size_pt * PT_TO_MM * PX}
                      fill={el.font.color}
                      lineHeight={1.25}
                      wrap="word"
                      // customers can drag the texts they are allowed to edit; the position is saved with the card
                      draggable={full || !!el.editable}
                      dragBoundFunc={function (this: Konva.Node, pos) {
                        // keep the text box inside the page while dragging (pos is in screen pixels)
                        const w = this.width() * zoom;
                        const h = this.height() * zoom;
                        return {
                          x: clamp(pos.x, 0, Math.max(0, pageW * zoom - w)),
                          y: clamp(pos.y, 0, Math.max(0, pageH * zoom - h)),
                        };
                      }}
                      onMouseDown={full ? onSelect : focusField}
                      onTap={full ? onSelect : focusField}
                      onMouseEnter={(e) => {
                        if (full || el.editable) e.target.getStage()!.container().style.cursor = 'move';
                      }}
                      onMouseLeave={(e) => {
                        e.target.getStage()!.container().style.cursor = '';
                      }}
                      onDragEnd={(e) => onChange({ x_mm: e.target.x() / PX, y_mm: e.target.y() / PX })}
                      onTransformEnd={(e) => {
                        const n = e.target;
                        const w = n.width() * n.scaleX();
                        n.scaleX(1);
                        n.scaleY(1);
                        onChange({ x_mm: n.x() / PX, y_mm: n.y() / PX, w_mm: w / PX, rotation: n.rotation() });
                      }}
                    />
                  );
                })}
                <Transformer
                  ref={trRef}
                  resizeEnabled={canManage}
                  rotateEnabled={canManage}
                  borderStroke="#1fb37c"
                  borderStrokeWidth={2}
                  borderDash={canManage ? undefined : [6, 4]}
                  padding={canManage ? 0 : 4}
                  keepRatio={selected?.type === 'image'}
                  enabledAnchors={
                    selected?.type === 'text'
                      ? ['middle-left', 'middle-right']
                      : ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'middle-left', 'middle-right', 'top-center', 'bottom-center']
                  }
                  boundBoxFunc={(oldBox, newBox) => (newBox.width < 10 || newBox.height < 10 ? oldBox : newBox)}
                />
              </Layer>
            </Stage>
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
              <label className="field">
                צבע רקע
                <input type="color" value={doc.page.background} onChange={(e) => setPage({ background: e.target.value }, 'bg')} />
              </label>
              <p className="status">בחרו אלמנט על הדף כדי לערוך אותו. מקשי החיצים מזיזים, Delete מוחק, Ctrl+Z מבטל.</p>
            </>
          ) : (
            <>
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
                  <label className="field">
                    פונט
                    <select value={textEl.font.family} onChange={(e) => updateText({ font: { ...textEl.font, family: e.target.value } })}>
                      {FONTS.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </select>
                  </label>
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
