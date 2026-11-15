'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Stage, Layer, Rect, Text, Shape, Group, Line, Image as KImage, Transformer } from 'react-konva';
import useImage from 'use-image';
import type Konva from 'konva';
import {
  addElement as addTo,
  allElements,
  findElement,
  moveInLayer,
  moveToLayer,
  PAGE_PRESETS,
  removeElement,
  replaceElement,
  setBackground,
  updateElement,
} from '@/lib/canvas';
import { DIVIDERS, newDivider, newImage, newRect, newText, type DividerKind } from '@/lib/elements';
import { arcBox, drawArc, hasArc } from '@/lib/arcText';
import { cropOf, fillLook, LINE_HEIGHT, maskPath, shapeLook, textLook } from '@/lib/nodeStyle';
import { intersects, linesOf, snapBox, unionOf, type Box, type Mark } from '@/lib/snap';
import { EditorRulers } from './EditorRulers';
import { InlineTextEditor } from './InlineTextEditor';
import { fontFamilies, nearestWeight, WEIGHT_NAMES, type FontFamily } from '@/lib/fonts';
import { loadFont, registerUploadedFonts } from '@/lib/fonts-client';
import { useToast } from './Toast';
import { AgentPanel } from './AgentPanel';
import { DownloadIcon, FitIcon, RedoIcon, UndoIcon } from './Icons';
import type {
  BackgroundLayer,
  CanvasDoc,
  CanvasElement,
  Category,
  ImageAsset,
  ImageElement,
  LayerName,
  Locks,
  Project,
  TextElement,
} from '@/lib/types';

const PX = 3; // canvas pixels per mm at zoom 1
/** how far inside the page's edge the safe area line runs, in mm: a print shop's cut can wander this much */
const SAFE_MM = 4;
const PT_TO_MM = 25.4 / 72;
const HISTORY_LIMIT = 100;
/** Quick colour choices for customers (the site palette plus black and white). */
const BG_SWATCHES = ['#FAF8F3', '#FFFFFF', '#E4ECE3', '#DCE7DA', '#2F5D46', '#1F3A2E', '#C9A24B', '#1B1F1C'];
const SWATCHES = ['#1F3A2E', '#2F5D46', '#C9A24B', '#FAF8F3', '#1B1F1C'];
const LAYER_LABEL: Record<LayerName, string> = { content: 'תוכן', overlay: 'שכבה עליונה' };
const LOCK_LABELS: [keyof Locks, string][] = [
  ['content', 'לשנות את התוכן (טקסט / החלפת תמונה)'],
  ['style', 'לשנות צבע'],
  ['transform', 'להזיז, לשנות גודל ולסובב'],
  ['delete', 'למחוק'],
];

type SaveState = 'saved' | 'saving' | 'dirty' | 'error';

const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));
const fontStyle = (w: number) => (w === 400 ? 'normal' : String(w));
const uploadUrl = (a: ImageAsset | undefined) => (a ? `/api/uploads/${a.file}` : '');

/** A picture: drawn through its mask, showing its crop. The group carries the id, place and size. */
function ImageNode({
  el,
  asset,
  draggable,
  listening,
  onSelect,
  onChange,
}: {
  el: ImageElement;
  asset: ImageAsset | undefined;
  draggable: boolean;
  listening: boolean;
  onSelect?: (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onChange: (patch: Partial<CanvasElement>) => void;
}) {
  const [img, status] = useImage(uploadUrl(asset));
  const w = el.w_mm * PX;
  const h = el.h_mm * PX;
  let face: React.ReactNode;
  if (el.colorOverride) face = <Rect width={w} height={h} fill={el.colorOverride} />;
  else if (!asset || status === 'failed') face = <Rect width={w} height={h} fill="#f0e6e4" stroke="#a33a2e" strokeWidth={2} dash={[10, 6]} />;
  else if (!img) face = <Rect width={w} height={h} fill="rgba(0,0,0,0)" />;
  else face = <KImage width={w} height={h} image={img} crop={cropOf(el, img.naturalWidth, img.naturalHeight)} />;
  const mask = el.mask;
  return (
    <Group
      id={el.id}
      x={el.x_mm * PX}
      y={el.y_mm * PX}
      width={w}
      height={h}
      rotation={el.rotation}
      draggable={draggable}
      listening={listening}
      onMouseDown={onSelect}
      onTap={onSelect}
      clipFunc={mask ? (ctx) => maskPath(ctx._context, mask, w, h) : undefined}
      // a drag ends in the layer, which also moves the rest of the selection (onLayerDragEnd)
      onTransformEnd={(e) => {
        const n = e.target;
        const nw = n.width() * n.scaleX();
        const nh = n.height() * n.scaleY();
        n.scaleX(1);
        n.scaleY(1);
        onChange({ x_mm: n.x() / PX, y_mm: n.y() / PX, w_mm: nw / PX, h_mm: nh / PX, rotation: n.rotation() });
      }}
    >
      {face}
    </Group>
  );
}

/** The background layer: its fill (flat or gradient), and its image filling the page (cover or contain). Never takes clicks. */
function BackgroundNode({ bg, asset, w, h }: { bg: BackgroundLayer; asset: ImageAsset | undefined; w: number; h: number }) {
  const [img] = useImage(bg.image && !bg.image.colorOverride ? uploadUrl(asset) : '');
  const fill = <Rect x={0} y={0} width={w} height={h} {...fillLook(bg.fill, w, h)} />;
  if (!bg.image) return fill;
  if (bg.image.colorOverride) return <Rect x={0} y={0} width={w} height={h} fill={bg.image.colorOverride} />;
  if (!img) return fill;
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (bg.image.fit === 'cover') {
    // crop the image to the page's proportions, centred
    const s = Math.max(w / iw, h / ih);
    const cw = w / s;
    const ch = h / s;
    return <KImage x={0} y={0} width={w} height={h} image={img} crop={{ x: (iw - cw) / 2, y: (ih - ch) / 2, width: cw, height: ch }} />;
  }
  const s = Math.min(w / iw, h / ih);
  return (
    <>
      {fill}
      <KImage x={(w - iw * s) / 2} y={(h - ih * s) / 2} width={iw * s} height={ih * s} image={img} />
    </>
  );
}

/** The author's lock inspector: what customers may do with this element, and the field they see. */
function LockInspector({
  locks,
  field,
  allowed,
  onChange,
  children,
}: {
  locks: Locks;
  field?: { label: string; variable?: string };
  allowed: (keyof Locks)[];
  onChange: (patch: { locks?: Locks; field?: { label: string; variable?: string } | undefined }, key?: string) => void;
  children?: React.ReactNode;
}) {
  const customer = locks.content || locks.style || locks.transform || locks.delete;
  return (
    <div className="card" style={{ display: 'grid', gap: 8, padding: 12 }}>
      <h3 className="panel-title" style={{ margin: 0 }}>הלקוח יכול</h3>
      {LOCK_LABELS.filter(([k]) => allowed.includes(k)).map(([k, label]) => (
        <label key={k} className="row" style={{ gap: 8 }}>
          <input
            type="checkbox"
            checked={locks[k]}
            onChange={(e) => {
              const next = { ...locks, [k]: e.target.checked };
              const open = next.content || next.style || next.transform || next.delete;
              onChange({ locks: next, field: open ? (field ?? { label: '' }) : undefined });
            }}
          />
          <span>{label}</span>
        </label>
      ))}
      {customer && (
        <>
          <label className="field">
            שם השדה שהלקוח רואה
            <input
              type="text"
              maxLength={60}
              value={field?.label ?? ''}
              placeholder="למשל: שם החתן"
              onChange={(e) => onChange({ field: { ...field, label: e.target.value } }, 'label')}
            />
          </label>
          <label className="field">
            משתנה (לא חובה)
            <input
              type="text"
              dir="ltr"
              maxLength={41}
              value={field?.variable ?? ''}
              placeholder="event_name"
              onChange={(e) => {
                const v = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '');
                const { variable: _old, ...rest } = field ?? { label: '' };
                void _old;
                onChange({ field: v && /^[a-z_]/.test(v) ? { ...rest, variable: v } : rest }, 'variable');
              }}
            />
          </label>
        </>
      )}
      {children}
    </div>
  );
}

export default function Editor({ id }: { id: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [canAgent, setCanAgent] = useState(false);
  const [pubStatus, setPubStatus] = useState<'draft' | 'published'>('draft');
  const [pubBusy, setPubBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [activeField, setActiveField] = useState<string | null>(null);
  const [hintOpen, setHintOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiTouched, setAiTouched] = useState<Set<string>>(new Set());
  const aiTimer = useRef<number | undefined>(undefined);
  const { push } = useToast();
  const fieldRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const [doc, setDoc] = useState<CanvasDoc | null>(null);
  const [name, setName] = useState('');
  /** the element the side panel shows; `multi` is the rest of a selection of several */
  const [selectedId, setPrimary] = useState<string | null>(null);
  const [multi, setMulti] = useState<string[]>([]);
  const setSelectedId = useCallback((elId: string | null) => {
    setPrimary(elId);
    setMulti([]);
  }, []);
  /** lines drawn while a dragged element snaps, and the frame of a drag-to-select */
  const [snapMarks, setSnapMarks] = useState<Mark[]>([]);
  const [marquee, setMarquee] = useState<Box | null>(null);
  const [showSafe, setShowSafe] = useState(true);
  /** the text being written straight on the card */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [library, setLibrary] = useState<{ categories: Category[]; images: ImageAsset[] }>({ categories: [], images: [] });
  const [libCat, setLibCat] = useState<string>('');
  const [zoomOverride, setZoomOverride] = useState<number | null>(null);
  const [fit, setFit] = useState(0.5);
  const [save, setSave] = useState<SaveState>('saved');
  const [loadError, setLoadError] = useState('');
  const [fontsTick, setFontsTick] = useState(0);
  const [families, setFamilies] = useState<FontFamily[]>(() => fontFamilies([]));

  const stageRef = useRef<Konva.Stage>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  /** the card's content layer (boxes are measured in its coordinates) and the editor's own lines, kept out of every picture */
  const contentRef = useRef<Konva.Layer>(null);
  const chromeRef = useRef<Konva.Layer>(null);
  const dragRef = useRef<{ id: string; start: { x: number; y: number }; others: { node: Konva.Node; x: number; y: number }[]; lines: { x: number[]; y: number[] }; boxes: Box[] } | null>(null);
  const marqueeStart = useRef<{ x: number; y: number; add: boolean } | null>(null);
  const spaceDown = useRef(false);
  const lastMerge = useRef<{ key: string; at: number } | null>(null);
  const loadedRef = useRef(false);

  // ---- loading -------------------------------------------------------------
  useEffect(() => {
    (async () => {
      try {
        const [pRes, lRes] = await Promise.all([fetch(`/api/projects/${id}`), fetch('/api/library')]);
        if (!pRes.ok) throw new Error(pRes.status === 404 ? 'העיצוב לא נמצא' : 'טעינת העיצוב נכשלה');
        const p: Project & { canManage: boolean; canAgent: boolean } = await pRes.json();
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

  useEffect(() => {
    try {
      setHintOpen(localStorage.getItem('hint-editor-v1') !== '1');
    } catch {
      setHintOpen(true);
    }
  }, []);

  // uploaded fonts join the font list; each family and weight the card uses is loaded before the
  // texts are measured, and again whenever a text switches to one not loaded yet
  useEffect(() => {
    registerUploadedFonts().then((fonts) => setFamilies(fontFamilies(fonts)));
  }, []);
  const usedFonts = useMemo(() => {
    const set = new Set<string>();
    for (const e of doc ? allElements(doc) : []) if (e.type === 'text') set.add(JSON.stringify([e.font.family, e.font.weight]));
    // a string, so the effect below runs only when the set changes, not on every edit
    return JSON.stringify([...set].sort());
  }, [doc]);
  useEffect(() => {
    const used = (JSON.parse(usedFonts) as string[]).map((k) => JSON.parse(k) as [string, number]);
    if (!used.length) return;
    let alive = true;
    registerUploadedFonts()
      .then(() => Promise.all(used.map(([family, weight]) => loadFont(family, weight))))
      .then(() => alive && setFontsTick((n) => n + 1));
    return () => {
      alive = false;
    };
  }, [usedFonts]);

  // ---- fit zoom ------------------------------------------------------------
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || !doc) return;
    const calc = () => {
      const w = el.clientWidth - 48;
      const h = el.clientHeight - 48;
      setFit(clamp(Math.min(w / (doc.page.width_mm * PX), h / (doc.page.height_mm * PX)), 0.1, 3));
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    return () => ro.disconnect();
  }, [doc?.page.width_mm, doc?.page.height_mm, !!doc]); // eslint-disable-line react-hooks/exhaustive-deps

  const zoom = zoomOverride ?? fit;
  const fitRef = useRef(fit);
  fitRef.current = fit;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

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

  /** a change to the current doc, recorded in the history */
  const change = useCallback(
    (fn: (d: CanvasDoc) => CanvasDoc, mergeKey?: string) => {
      const cur = docRef.current;
      if (cur) commit(fn(cur), mergeKey);
    },
    [commit],
  );

  /** Applies the assistant's card and briefly marks every element it touched. */
  const applyAgent = useCallback(
    (next: CanvasDoc) => {
      const cur = docRef.current;
      const before = new Map(cur ? allElements(cur).map((e) => [e.id, JSON.stringify(e)]) : []);
      const changed = new Set<string>(allElements(next).filter((e) => before.get(e.id) !== JSON.stringify(e)).map((e) => e.id));
      if (cur && JSON.stringify(cur.layers.background) !== JSON.stringify(next.layers.background)) changed.add('background');
      commit(next);
      setAiTouched(changed);
      window.clearTimeout(aiTimer.current);
      aiTimer.current = window.setTimeout(() => setAiTouched(new Set()), 2800);
      return changed.size;
    },
    [commit],
  );

  const patchElement = useCallback(
    (elId: string, patch: Partial<CanvasElement>, mergeKey?: string) => change((d) => updateElement(d, elId, patch), mergeKey),
    [change],
  );
  const patchBackground = useCallback(
    (patch: Partial<BackgroundLayer>, mergeKey?: string) => change((d) => setBackground(d, patch), mergeKey),
    [change],
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
  }, [doc, name, save, id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (save === 'dirty' || save === 'saving' || save === 'error') e.preventDefault();
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [save]);

  // ---- actions -----------------------------------------------------------------
  const found = doc && selectedId ? findElement(doc, selectedId) : null;
  const selected = found?.el ?? null;
  const assetById = useMemo(() => new Map(library.images.map((i) => [i.id, i])), [library.images]);

  const addElement = (el: CanvasElement, layer: LayerName = 'content') => {
    change((d) => addTo(d, el, layer));
    setSelectedId(el.id);
  };

  const addText = () => doc && addElement(newText(doc));
  const addRect = () => doc && addElement(newRect(doc));
  const addImage = (asset: ImageAsset) => doc && addElement(newImage(doc, asset));

  // ---- selections of several elements (ported from feature/business-ads) -----------------------
  /** everything selected, the panel's element first */
  const selIds = useMemo(() => (selectedId ? [selectedId, ...multi.filter((m) => m !== selectedId)] : []), [selectedId, multi]);

  /** the element and the rest of its group: they are selected together */
  const withGroup = (elId: string) => {
    const els = docRef.current ? allElements(docRef.current) : [];
    const g = els.find((e) => e.id === elId)?.group;
    return g ? els.filter((e) => e.group === g).map((e) => e.id) : [elId];
  };

  /** A click on an element: it alone (with its group), or added to the selection with Shift. A click on one already selected keeps the selection, so all of it can be dragged. */
  const selectEl = (elId: string, add: boolean) => {
    const ids = withGroup(elId);
    if (add) {
      const all = ids.every((x) => selIds.includes(x));
      const next = all ? selIds.filter((x) => !ids.includes(x)) : [...selIds, ...ids.filter((x) => !selIds.includes(x))];
      setPrimary(next[0] ?? null);
      setMulti(next.slice(1));
      return;
    }
    if (selIds.includes(elId)) return;
    setPrimary(elId);
    setMulti(ids.filter((x) => x !== elId));
  };

  const selectMany = (ids: string[]) => {
    setPrimary(ids[0] ?? null);
    setMulti(ids.slice(1));
  };

  /** one change to several elements, in their layers, as one undo step */
  const patchMany = useCallback(
    (ids: string[], fn: (e: CanvasElement) => Partial<CanvasElement>, mergeKey?: string) => {
      if (!ids.length) return;
      const map = (els: CanvasElement[]) => els.map((e) => (ids.includes(e.id) ? ({ ...e, ...fn(e) } as CanvasElement) : e));
      change((d) => ({ ...d, layers: { ...d.layers, content: map(d.layers.content), overlay: map(d.layers.overlay) } }), mergeKey);
    },
    [change],
  );

  const removeSelected = useCallback(() => {
    if (!selIds.length) return;
    change((d) => selIds.reduce((acc, x) => removeElement(acc, x), d));
    setSelectedId(null);
  }, [selIds, change, setSelectedId]);

  const duplicateSelected = useCallback(() => {
    const d = docRef.current;
    if (!d || !selIds.length) return;
    // a copied group is a new group of its own; each copy goes on top of its own layer
    const groups = new Map<string, string>();
    const copies: { el: CanvasElement; layer: LayerName }[] = [];
    for (const x of selIds) {
      const at = findElement(d, x);
      if (!at) continue;
      const g = at.el.group;
      const group = g ? (groups.get(g) ?? groups.set(g, crypto.randomUUID()).get(g)) : undefined;
      copies.push({ el: { ...at.el, id: crypto.randomUUID(), x_mm: at.el.x_mm + 5, y_mm: at.el.y_mm + 5, ...(group && { group }) }, layer: at.layer });
    }
    change((doc0) => copies.reduce((acc, c) => addTo(acc, c.el, c.layer), doc0));
    selectMany(copies.map((c) => c.el.id));
  }, [selIds, change]); // eslint-disable-line react-hooks/exhaustive-deps

  const groupSelected = () => {
    if (selIds.length < 2) return;
    const g = crypto.randomUUID();
    patchMany(selIds, () => ({ group: g }));
  };
  const ungroupSelected = () => patchMany(selIds, () => ({ group: undefined }));

  /** the boxes of these elements on the page, in canvas pixels, as drawn (a turned one by its outer box) */
  const boxesOf = (ids: string[]) => {
    const stage = stageRef.current;
    const layer = contentRef.current;
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
    const d = docRef.current;
    if (!items.length || !d) return;
    const ref = items.length === 1 ? { x: 0, y: 0, w: d.page.width_mm * PX, h: d.page.height_mm * PX } : unionOf(items.map((i) => i.box));
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

  /** the author's guides live on the card, so they come back next time (never drawn in a download) */
  const guides = doc?.guides ?? { x: [], y: [] };
  const keepGuides = (g: { x: number[]; y: number[] }) => change((d) => ({ ...d, guides: g }));

  const addDivider = (kind: DividerKind) => {
    const d = docRef.current;
    if (!d) return;
    const parts = newDivider(d, kind);
    change((doc0) => parts.reduce((acc, p) => addTo(acc, p, 'content'), doc0));
    selectMany(parts.map((x) => x.id));
  };

  const moveZ = (dir: 'front' | 'back' | 'up' | 'down') => selectedId && change((d) => moveInLayer(d, selectedId, dir));

  const makeThumb = (): string | undefined => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    chromeRef.current?.visible(false);
    stage.draw();
    const url = stage.toDataURL({ pixelRatio: 600 / stage.width(), mimeType: 'image/jpeg', quality: 0.7 });
    chromeRef.current?.visible(true);
    stage.draw();
    return url;
  };

  const setPublished = async (status: 'draft' | 'published') => {
    const d = docRef.current;
    if (!d) return;
    if (status === 'published') {
      const fields = allElements(d).filter((e) => e.type === 'text' && e.locks.content).length;
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

  const exportPng = async () => {
    const stage = stageRef.current;
    if (!stage || !doc || exporting) return;
    setExporting(true);
    await new Promise((r) => setTimeout(r, 40)); // let the button show its busy state before the heavy render
    try {
      // the selection frame, guides and safe area stay out of the file
      chromeRef.current?.visible(false);
      stage.draw();
      const ratio = ((doc.page.width_mm / 25.4) * 300) / stage.width();
      const url = stage.toDataURL({ pixelRatio: ratio, mimeType: 'image/png' });
      chromeRef.current?.visible(true);
      stage.draw();
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(name || 'עיצוב').replace(/[\\/:*?"<>|]/g, '_')}.png`;
      a.click();
      push('הכרטיס הורד למחשב', 'success');
    } catch {
      push('לא הצלחנו להכין את הקובץ. נסו שוב.', 'error');
    } finally {
      setExporting(false);
    }
  };

  // ---- transformer + keyboard ---------------------------------------------------
  useEffect(() => {
    const tr = trRef.current;
    const stage = stageRef.current;
    if (!tr || !stage) return;
    // the author's whole selection; a customer's frame marks the field they are on
    const targets = canManage ? selIds : [activeField].filter((x): x is string => !!x);
    const nodes = targets.flatMap((t) => {
      const n = t !== editingId ? stage.findOne('#' + t) : null;
      return n ? [n] : [];
    });
    tr.nodes(nodes);
    tr.getLayer()?.batchDraw();
  }, [selIds, activeField, canManage, doc, fontsTick, editingId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable]')) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (!canManage && !(mod && (key === 'z' || key === 'y'))) return;
      if (mod && key === 'z') {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if (mod && key === 'y') {
        e.preventDefault();
        redo();
      } else if (mod && key === 'd') {
        e.preventDefault();
        duplicateSelected();
      } else if (mod && key === 'g') {
        e.preventDefault();
        if (e.shiftKey) ungroupSelected();
        else groupSelected();
      } else if (mod && key === 'a') {
        e.preventDefault();
        const d = docRef.current;
        if (d) selectMany(allElements(d).filter((x) => !x.pinned && !x.hidden).map((x) => x.id));
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selIds.length) {
        e.preventDefault();
        removeSelected();
      } else if (e.key === 'Escape') {
        setSelectedId(null);
      } else if (selIds.length && e.key.startsWith('Arrow')) {
        e.preventDefault();
        // a millimetre a press, ten with Shift; held down, it is one undo step
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        patchMany(selIds, (x) => ({ x_mm: x.x_mm + dx, y_mm: x.y_mm + dy }), 'nudge');
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
  }, [undo, redo, duplicateSelected, removeSelected, selIds, patchMany, canManage]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- zoom with Ctrl + the wheel or two fingers, and moving the view with Space or the middle button ----
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
  }, [!!doc]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const bg = doc.layers.background;
  const elements = allElements(doc);
  const swappables = elements.filter((e): e is ImageElement => e.type === 'image' && e.locks.content);
  const textFields = elements.filter((e): e is TextElement => e.type === 'text' && (e.locks.content || e.locks.style));
  const bgChoice = bg.locks.content || bg.locks.style;
  const textEl = selected?.type === 'text' ? selected : null;
  const textFamily = textEl ? families.find((f) => f.family === textEl.font.family) : undefined;
  const textWeights = textEl ? [...new Set([...(textFamily?.weights ?? []), textEl.font.weight])].sort((a, b) => a - b) : [];
  const updateText = (patch: Partial<TextElement>, key?: string) => selected && patchElement(selected.id, patch, key);
  const num = (v: string) => (v === '' || Number.isNaN(Number(v)) ? null : Number(v));
  /** a lock-inspector change; a field only exists while customers may do something with the element */
  const setLocks = (el: CanvasElement, p: { locks?: Locks; field?: CanvasElement['field'] }, key?: string) => {
    const next = { ...el, ...p } as CanvasElement;
    if (!next.field) delete next.field;
    change((d) => replaceElement(d, el.id, next), key && `${key}:${el.id}`);
  };

  /** one card element on its Konva layer */
  const renderElement = (el: CanvasElement) => {
    // hidden: left out of the card, its previews and downloads (the layers panel still lists it)
    if (el.hidden) return null;
    // pinned: the author's own lock; it stays put and clicks go through to what is under it
    const pinned = full && !!el.pinned;
    const onSelect =
      full && !pinned
        ? (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
            const ev = e.evt as MouseEvent;
            selectEl(el.id, !!(ev.shiftKey || ev.ctrlKey || ev.metaKey));
          }
        : undefined;
    // customers may drag what its transform lock allows; the server checks it again on save
    const draggable = (full && !pinned) || (!full && el.locks.transform);
    const onChange = (patch: Partial<CanvasElement>) => patchElement(el.id, patch);
    const transformEnd = (e: Konva.KonvaEventObject<Event>, withHeight: boolean) => {
      const n = e.target;
      const w = n.width() * n.scaleX();
      const h = n.height() * n.scaleY();
      n.scaleX(1);
      n.scaleY(1);
      onChange({ x_mm: n.x() / PX, y_mm: n.y() / PX, w_mm: w / PX, ...(withHeight && { h_mm: h / PX }), rotation: n.rotation() });
    };
    if (el.type === 'image') {
      return (
        <ImageNode
          key={el.id}
          el={el}
          asset={assetById.get(el.asset_id)}
          draggable={draggable}
          listening={!pinned}
          onSelect={onSelect}
          onChange={onChange}
        />
      );
    }
    if (el.type === 'shape') {
      return (
        <Rect
          key={el.id}
          id={el.id}
          x={el.x_mm * PX}
          y={el.y_mm * PX}
          width={el.w_mm * PX}
          height={el.h_mm * PX}
          rotation={el.rotation}
          {...shapeLook(el, PX)}
          draggable={draggable}
          listening={!pinned}
          onMouseDown={onSelect}
          onTap={onSelect}
          onTransformEnd={(e) => transformEnd(e, true)}
        />
      );
    }
    const focusField = () => {
      if (!el.locks.content && !el.locks.style) return;
      setActiveField(el.id);
      fieldRefs.current[el.id]?.focus({ preventScroll: false });
    };
    // what a text takes the same, straight or on an arc
    const textNode = {
      id: el.id,
      x: el.x_mm * PX,
      y: el.y_mm * PX,
      rotation: el.rotation,
      draggable,
      listening: !pinned,
      dragBoundFunc: function (this: Konva.Node, pos: Konva.Vector2d) {
        // keep the text box inside the page while dragging (pos is in screen pixels)
        const w = this.width() * zoom;
        const h = this.height() * zoom;
        return {
          x: clamp(pos.x, 0, Math.max(0, pageW * zoom - w)),
          y: clamp(pos.y, 0, Math.max(0, pageH * zoom - h)),
        };
      },
      onMouseDown: onSelect ?? focusField,
      onTap: onSelect ?? focusField,
      onMouseEnter: (e: Konva.KonvaEventObject<MouseEvent>) => {
        if (draggable) e.target.getStage()!.container().style.cursor = 'move';
      },
      onMouseLeave: (e: Konva.KonvaEventObject<MouseEvent>) => {
        e.target.getStage()!.container().style.cursor = '';
      },
      // writing straight on the card: the author on any text, a customer on a text they may change
      onDblClick: () => (full || el.locks.content) && setEditingId(el.id),
      onDblTap: () => (full || el.locks.content) && setEditingId(el.id),
      opacity: editingId === el.id ? 0 : 1,
      onTransformEnd: (e: Konva.KonvaEventObject<Event>) => transformEnd(e, false),
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
        // explicit, not inherited: exports and previews are drawn on a canvas off the page, which is left-to-right
        direction="rtl"
        fontFamily={el.font.family}
        fontStyle={fontStyle(el.font.weight)}
        fill={el.font.color}
        {...textLook(el, PX)}
        wrap="word"
      />
    );
  };

  // ---- dragging: the selection moves together and snaps (ported from feature/business-ads) ----
  const cardLayer = (n: Konva.Node) => {
    const l = n.getLayer();
    return !!l && l !== chromeRef.current;
  };

  /** A drag starts: what moves with it (the rest of an author's selection), and what it can snap to. */
  const onLayerDragStart = (e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target;
    const nodeId = node.id();
    const stg = stageRef.current;
    // with several nodes, the Transformer starts a drag on each of the others too: the first one leads
    if (dragRef.current || !nodeId || !stg || !cardLayer(node)) return;
    const moving = full && selIds.includes(nodeId) ? selIds : [nodeId];
    const others = moving
      .filter((m) => m !== nodeId)
      .flatMap((m) => {
        const n = stg.findOne('#' + m);
        return n ? [{ node: n, x: n.x(), y: n.y() }] : [];
      });
    const still = boxesOf(elements.filter((x) => !moving.includes(x.id) && !x.hidden).map((x) => x.id)).map((b) => b.box);
    dragRef.current = {
      id: nodeId,
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
    const layer = contentRef.current!;
    const box = unionOf(
      [node, ...d.others.map((o) => o.node)].map((n) => {
        const r = n.getClientRect({ relativeTo: layer });
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      }),
    );
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

  const editingEl = (() => {
    const at = editingId ? findElement(doc, editingId) : null;
    return at?.el.type === 'text' ? at.el : undefined;
  })();

  /** six alignment buttons: to the page for one element, to each other for several */
  const alignButtons = (label: string) => (
    <div role="group" aria-label={label} className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
      {(
        [
          ['right', 'ימין', 'M20 4v16M6 8h10v3H6zM9 13h7v3H9z'],
          ['hcenter', 'מרכז', 'M12 4v16M6 8h12v3H6zM8 13h8v3H8z'],
          ['left', 'שמאל', 'M4 4v16M8 8h10v3H8zM8 13h7v3H8z'],
          ['top', 'למעלה', 'M4 4h16M8 8h3v10H8zM13 8h3v7h-3z'],
          ['vmiddle', 'אמצע', 'M4 12h16M8 6h3v12H8zM13 8h3v8h-3z'],
          ['bottom', 'למטה', 'M4 20h16M8 6h3v10H8zM13 9h3v7h-3z'],
        ] as const
      ).map(([how, name, d]) => (
        <button key={how} type="button" className="icon-btn" title={`${label}: ${name}`} aria-label={`${label}: ${name}`} onClick={() => alignSel(how)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <path d={d} />
          </svg>
        </button>
      ))}
    </div>
  );

  const colorSwatches = (palette: string[], current: string | undefined, label: string, pick: (c: string) => void, key: string) => (
    <div className="swatches" role="group" aria-label={label}>
      {palette.map((c) => (
        <button
          key={c}
          type="button"
          className="swatch"
          style={{ background: c }}
          aria-label={`צבע ${c}`}
          aria-pressed={current?.toLowerCase() === c.toLowerCase()}
          onClick={() => pick(c)}
        />
      ))}
      <input type="color" className="swatch-picker" aria-label="צבע אחר" value={current ?? '#faf8f3'} onChange={(e) => pick(e.target.value)} data-key={key} />
    </div>
  );

  /** the image options a customer may pick for a swappable image */
  const imagePicker = (collection: string | undefined, current: string | undefined, pick: (asset: ImageAsset) => void) => {
    const options = library.images.filter((i) => !collection || i.categoryId === collection);
    if (options.length === 0) return <span className="status">אין תמונות להחלפה.</span>;
    return (
      <div className="pick-grid">
        {options.map((img) => (
          <button key={img.id} type="button" className="pick" title={img.name} aria-pressed={img.id === current} onClick={() => pick(img)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={uploadUrl(img)} alt={img.name} />
          </button>
        ))}
      </div>
    );
  };

  return (
    <div className="editor-wrap">
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
        <button className="btn primary small shine" onClick={exportPng} disabled={exporting}>
          <DownloadIcon size={16} />
          {exporting ? 'מכין קובץ…' : full ? 'הורדת PNG (300dpi)' : 'הורדת הכרטיס'}
        </button>
      </div>

      <div className={'editor' + (full ? '' : ' customer')}>
        {!full && (
          <aside className="left" aria-label="פרטי הכרטיס">
            <header className="panel-head" style={{ order: -3 }}>
              <h2>הפרטים בכרטיס</h2>
              <p>ממלאים, בוחרים צבע, וזהו. הכרטיס מתעדכן מולכם.</p>
            </header>
            {hintOpen && (
              <div className="hint" style={{ order: -2 }} role="note">
                <span>טיפ: לחצו על טקסט בכרטיס כדי לערוך אותו, וגררו אותו כדי להזיז. הצבעים נמצאים ליד כל שדה.</span>
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
            {canAgent && (textFields.length > 0 || swappables.length > 0 || bgChoice) && (
              <div style={{ order: -2 }}>
                <AgentPanel
                  projectId={id}
                  getDoc={() => docRef.current}
                  onApply={applyAgent}
                  onBusyChange={setAiBusy}
                  placeholder="למשל: החתונה של דן ונועה, 12 במאי, אולם הגן"
                  suggestions={['נסחו לי הזמנה חגיגית', 'כל הטקסטים בזהב', 'קצרו את הנוסח']}
                />
              </div>
            )}
            {textFields.length === 0 && swappables.length === 0 && !bgChoice ? (
              <p className="status">בתבנית הזו אין שדות לעריכה.</p>
            ) : (
              textFields.map((f) => (
                <div key={f.id} className={'field field-card' + (aiTouched.has(f.id) ? ' ai-touched' : '')}>
                  <div className="field-head">
                    <label htmlFor={`f-${f.id}`}>{f.field?.label || 'טקסט'}</label>
                    {f.locks.style &&
                      colorSwatches(SWATCHES, f.font.color, `צבע הטקסט: ${f.field?.label || 'טקסט'}`, (c) => patchElement(f.id, { font: { ...f.font, color: c } }, 'color:' + f.id), f.id)}
                  </div>
                  {f.locks.content && (
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
                  )}
                  {f.locks.delete && (
                    <button type="button" className="btn small" onClick={() => change((d) => removeElement(d, f.id))}>
                      הסרה מהכרטיס
                    </button>
                  )}
                </div>
              ))
            )}
            {bgChoice && (
              <div className={'field field-card' + (aiTouched.has('background') ? ' ai-touched' : '')} style={{ order: -1 }}>
                <span className="field-label">{bg.field?.label || 'רקע'}</span>
                {bg.locks.content &&
                  imagePicker(bg.swap_collection_id, bg.image && !bg.image.colorOverride ? bg.image.asset_id : undefined, (img) =>
                    patchBackground({ image: { asset_id: img.id, fit: bg.image?.fit ?? 'cover' } }),
                  )}
                <div className="field-head">
                  <span>{bg.locks.content ? 'או צבע אחיד' : 'צבע הרקע'}</span>
                  {colorSwatches(
                    BG_SWATCHES,
                    bg.locks.content && bg.image ? bg.image.colorOverride : bg.fill.color,
                    `צבע אחיד: ${bg.field?.label || 'רקע'}`,
                    (c) =>
                      bg.locks.content && bg.image
                        ? patchBackground({ image: { ...bg.image, colorOverride: c } }, 'bgcolor')
                        : patchBackground({ fill: { type: 'solid', color: c } }, 'bgcolor'),
                    'background',
                  )}
                </div>
              </div>
            )}
            {swappables.map((el) => (
              <div key={el.id} className={'field field-card' + (aiTouched.has(el.id) ? ' ai-touched' : '')} style={{ order: -1 }}>
                <span className="field-label">{el.field?.label || 'תמונה'}</span>
                {imagePicker(el.swap_collection_id, el.colorOverride ? undefined : el.asset_id, (img) => patchElement(el.id, { asset_id: img.id, colorOverride: undefined }))}
                <div className="field-head">
                  <span>או צבע אחיד</span>
                  {colorSwatches(BG_SWATCHES, el.colorOverride, `צבע אחיד: ${el.field?.label || 'תמונה'}`, (c) => patchElement(el.id, { colorOverride: c }, 'bgcolor:' + el.id), el.id)}
                </div>
              </div>
            ))}
            <footer className="panel-foot">
              {textFields.some((f) => f.locks.transform) && <p>אפשר לגרור טקסט בכרטיס כדי לשנות את מיקומו.</p>}
              <p>שינויים נשמרים אוטומטית. כשמסיימים אפשר להוריד את הכרטיס כקובץ תמונה.</p>
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
              <h2 className="panel-title">קווים מפרידים</h2>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                {DIVIDERS.map((d) => (
                  <button key={d.id} className="btn small" onClick={() => addDivider(d.id)}>
                    {d.label}
                  </button>
                ))}
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
                    <>
                      <div className="pick-grid">
                        {libImages.map((img) => (
                          <button key={img.id} className="pick" title={`${img.name}: הוספה לכרטיס`} onClick={() => addImage(img)}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={uploadUrl(img)} alt={img.name} />
                          </button>
                        ))}
                      </div>
                      <p className="status">לחיצה מוסיפה את התמונה לכרטיס. לתמונת רקע: בטלו את הבחירה ובחרו בהגדרות העמוד.</p>
                    </>
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

        <div className="stage-wrap" ref={wrapRef} onMouseDown={(e) => e.target === e.currentTarget && setSelectedId(null)}>
          <div
            className={'stage-frame' + (aiBusy ? ' ai-working' : '') + (aiTouched.size ? ' ai-done' : '')}
            style={{ width: pageW * zoom, height: pageH * zoom }}
          >
            {full && (
              <EditorRulers
                widthMm={doc.page.width_mm}
                heightMm={doc.page.height_mm}
                scale={PX * zoom}
                onGuide={(axis, mm) => keepGuides({ ...guides, [axis]: [...guides[axis], mm] })}
              />
            )}
            <Stage
              ref={stageRef}
              width={pageW * zoom}
              height={pageH * zoom}
              scaleX={zoom}
              scaleY={zoom}
              onMouseDown={(e) => {
                if (e.target !== e.target.getStage()) return;
                setActiveField(null);
                // an author drags a frame over the page to select what it touches
                const p = e.target.getStage()!.getPointerPosition();
                if (full && p) {
                  marqueeStart.current = { x: p.x / zoom, y: p.y / zoom, add: e.evt.shiftKey };
                  if (!e.evt.shiftKey) setSelectedId(null);
                } else {
                  setSelectedId(null);
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
                const hit = boxesOf(elements.filter((x) => !x.pinned && !x.hidden).map((x) => x.id))
                  .filter((b) => intersects(b.box, marquee))
                  .flatMap((b) => withGroup(b.id));
                selectMany([...new Set([...(st.add ? selIds : []), ...hit])]);
                setMarquee(null);
              }}
              onTap={(e) => {
                if (e.target === e.target.getStage()) {
                  setSelectedId(null);
                  setActiveField(null);
                }
              }}
            >
              {/* one Konva layer per card layer: the background never takes clicks and is always below */}
              <Layer listening={false}>
                <BackgroundNode bg={bg} asset={bg.image ? assetById.get(bg.image.asset_id) : undefined} w={pageW} h={pageH} />
              </Layer>
              <Layer ref={contentRef} onDragStart={onLayerDragStart} onDragMove={onLayerDragMove} onDragEnd={onLayerDragEnd}>
                {doc.layers.content.map(renderElement)}
              </Layer>
              <Layer onDragStart={onLayerDragStart} onDragMove={onLayerDragMove} onDragEnd={onLayerDragEnd}>
                {doc.layers.overlay.map(renderElement)}
              </Layer>
              {/* the editor's own lines: never in the thumbnail or a download */}
              <Layer ref={chromeRef}>
                {full && showSafe && (
                  <Rect
                    x={SAFE_MM * PX}
                    y={SAFE_MM * PX}
                    width={pageW - SAFE_MM * 2 * PX}
                    height={pageH - SAFE_MM * 2 * PX}
                    stroke="#E0457B"
                    strokeWidth={1 / zoom}
                    dash={[6 / zoom, 4 / zoom]}
                    listening={false}
                  />
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
                {marquee && (
                  <Rect x={marquee.x} y={marquee.y} width={marquee.w} height={marquee.h} fill="rgba(31,155,209,0.08)" stroke="#1F9BD1" strokeWidth={1 / zoom} listening={false} />
                )}
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
                lineHeight={editingEl.font.line_height ?? LINE_HEIGHT}
                onDone={(text) => {
                  if (text !== null && text !== editingEl.text) patchElement(editingEl.id, { text }, 'text:' + editingEl.id);
                  setEditingId(null);
                }}
              />
            )}
            {aiBusy && (
              <div className="ai-veil" aria-hidden="true">
                <span className="ai-scan" />
                <span className="ai-pill">
                  <span className="ai-pill-dot" />
                  העוזר מעצב את הכרטיס…
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
                      if (p) change((d) => ({ ...d, page: { width_mm: p.width_mm, height_mm: p.height_mm } }));
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

                <label className="row" style={{ gap: 8 }}>
                  <input type="checkbox" checked={showSafe} onChange={(e) => setShowSafe(e.target.checked)} />
                  <span>קו אזור בטוח להדפסה ({SAFE_MM} מ״מ מהקצה). לא מופיע בהורדה.</span>
                </label>
                <p className="status">גוררים מהסרגלים כדי להוסיף קו עזר, וגוררים אותו אל מחוץ לדף כדי להסיר. Ctrl עם הגלגלת מגדיל, רווח עם גרירה מזיז את התצוגה.</p>

                <h2 className="panel-title">רקע</h2>
                <label className="field">
                  צבע רקע
                  <input type="color" value={bg.fill.color} onChange={(e) => patchBackground({ fill: { type: 'solid', color: e.target.value } }, 'bg')} />
                </label>
                <div className="field">
                  <span>תמונת רקע: {bg.image ? (assetById.get(bg.image.asset_id)?.name ?? 'התמונה נמחקה') : 'אין'}</span>
                  <span className="status">{bg.image ? 'להחלפה' : 'להוספה'}, בחרו תמונה מהקטגוריה שנבחרה בפאנל ההוספה:</span>
                  {libImages.length > 0 &&
                    imagePicker(libCat, bg.image?.asset_id, (img) => patchBackground({ image: { asset_id: img.id, fit: bg.image?.fit ?? 'cover' } }))}
                  {bg.image && (
                    <div className="row">
                      <div className="seg" role="group" aria-label="התאמת התמונה">
                        {(['cover', 'contain'] as const).map((f) => (
                          <button key={f} aria-pressed={bg.image?.fit === f} onClick={() => bg.image && patchBackground({ image: { ...bg.image, fit: f } })}>
                            {f === 'cover' ? 'ממלאת את הדף' : 'כולה בתוך הדף'}
                          </button>
                        ))}
                      </div>
                      <button
                        className="btn small"
                        onClick={() =>
                          change((d) => {
                            const { image: _i, ...rest } = d.layers.background;
                            void _i;
                            return { ...d, layers: { ...d.layers, background: rest } };
                          })
                        }
                      >
                        הסרת התמונה
                      </button>
                    </div>
                  )}
                </div>
                <LockInspector
                  locks={bg.locks}
                  field={bg.field}
                  allowed={['content', 'style']}
                  onChange={(p, key) =>
                    change((d) => {
                      const next = { ...d.layers.background, ...p };
                      if (next.locks.content && !next.swap_collection_id && bg.image) {
                        const cat = assetById.get(bg.image.asset_id)?.categoryId;
                        if (cat) next.swap_collection_id = cat;
                      }
                      if (!next.field) delete next.field;
                      return { ...d, layers: { ...d.layers, background: next } };
                    }, key && `bg-${key}`)
                  }
                >
                  {bg.locks.content && (
                    <label className="field">
                      הלקוח בוחר מהקטגוריה
                      <select value={bg.swap_collection_id ?? ''} onChange={(e) => patchBackground({ swap_collection_id: e.target.value || undefined })}>
                        <option value="">כל התמונות</option>
                        {library.categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </LockInspector>
                <p className="status">בחרו אלמנט על הדף כדי לערוך אותו. מקשי החיצים מזיזים, Delete מוחק, Ctrl+Z מבטל.</p>
              </>
            ) : selIds.length > 1 ? (
              <>
                <h2 className="panel-title">{selIds.length} אלמנטים נבחרו</h2>
                {alignButtons('יישור זה לזה')}
                <div className="row" style={{ flexWrap: 'wrap' }}>
                  <button className="btn small" disabled={selIds.length < 3} onClick={() => distributeSel('x')}>
                    רווחים שווים לרוחב
                  </button>
                  <button className="btn small" disabled={selIds.length < 3} onClick={() => distributeSel('y')}>
                    רווחים שווים לגובה
                  </button>
                </div>
                <div className="row" style={{ flexWrap: 'wrap' }}>
                  {selIds.some((x) => findElement(doc, x)?.el.group) ? (
                    <button className="btn small" onClick={ungroupSelected}>
                      פירוק קבוצה (Ctrl+Shift+G)
                    </button>
                  ) : null}
                  <button className="btn small" onClick={groupSelected}>
                    קיבוץ (Ctrl+G)
                  </button>
                  <button className="btn small" onClick={duplicateSelected}>
                    שכפול
                  </button>
                  <button className="btn small danger" onClick={removeSelected}>
                    מחיקה
                  </button>
                </div>
                <p className="status">גוררים אחד מהם כדי להזיז את כולם. Shift עם לחיצה מוסיף או מוריד אלמנט מהבחירה.</p>
              </>
            ) : (
              <>
                <h2 className="panel-title">
                  {selected.type === 'text' ? 'טקסט' : selected.type === 'image' ? 'תמונה' : 'מלבן'} · {LAYER_LABEL[found!.layer]}
                </h2>
                {alignButtons('יישור לדף')}

                {textEl && (
                  <>
                    <label className="field">
                      תוכן
                      <textarea rows={3} dir="auto" value={textEl.text} onChange={(e) => updateText({ text: e.target.value }, 'text:' + textEl.id)} />
                    </label>
                    <label className="field">
                      פונט
                      <select
                        value={textEl.font.family}
                        onChange={(e) => {
                          const fam = families.find((f) => f.family === e.target.value);
                          const weight = fam ? nearestWeight(fam.weights, textEl.font.weight) : textEl.font.weight;
                          updateText({ font: { ...textEl.font, family: e.target.value, weight } });
                        }}
                      >
                        {!textFamily && <option value={textEl.font.family}>{textEl.font.family} (לא זמין)</option>}
                        {families.map((f) => (
                          <option key={f.family} value={f.family}>
                            {f.family}
                            {f.builtin ? '' : ' · הועלה'}
                            {f.hebrew ? '' : ' · ללא עברית'}
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
                      <label className="field">
                        משקל
                        <select
                          value={textEl.font.weight}
                          disabled={textWeights.length < 2}
                          onChange={(e) => updateText({ font: { ...textEl.font, weight: Number(e.target.value) } })}
                        >
                          {textWeights.map((w) => (
                            <option key={w} value={w}>
                              {WEIGHT_NAMES[w] ?? w}
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

                {selected.type === 'shape' && (
                  <label className="field">
                    צבע מילוי
                    <input
                      type="color"
                      value={selected.fill.color}
                      onChange={(e) => patchElement(selected.id, { fill: { type: 'solid', color: e.target.value } }, 'fill:' + selected.id)}
                    />
                  </label>
                )}

                {selected.type === 'image' && <p className="status">{assetById.get(selected.asset_id)?.name ?? 'התמונה נמחקה מהקטגוריה'}</p>}

                <LockInspector
                  locks={selected.locks}
                  field={selected.field}
                  allowed={['content', 'style', 'transform', 'delete'].filter((k) => !(k === 'style' && selected.type === 'image')) as (keyof Locks)[]}
                  onChange={(p, key) => {
                    const next = { ...p };
                    // a swappable image offers its own category by default
                    if (selected.type === 'image' && p.locks?.content && !selected.swap_collection_id) {
                      const cat = assetById.get(selected.asset_id)?.categoryId;
                      if (cat) Object.assign(next, { swap_collection_id: cat });
                    }
                    setLocks(selected, next, key);
                  }}
                >
                  {selected.type === 'image' && selected.locks.content && (
                    <label className="field">
                      הלקוח בוחר מהקטגוריה
                      <select
                        value={selected.swap_collection_id ?? ''}
                        onChange={(e) => patchElement(selected.id, { swap_collection_id: e.target.value || undefined })}
                      >
                        <option value="">כל התמונות</option>
                        {library.categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </LockInspector>

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
                  <h3 className="panel-title">סדר בתוך השכבה</h3>
                  <div className="row">
                    <button className="btn small" onClick={() => moveZ('front')}>לחזית</button>
                    <button className="btn small" onClick={() => moveZ('up')}>קדימה</button>
                    <button className="btn small" onClick={() => moveZ('down')}>אחורה</button>
                    <button className="btn small" onClick={() => moveZ('back')}>לתחתית</button>
                  </div>
                  <div className="seg" role="group" aria-label="שכבה" style={{ marginTop: 8 }}>
                    {(['content', 'overlay'] as const).map((l) => (
                      <button key={l} aria-pressed={found!.layer === l} onClick={() => change((d) => moveToLayer(d, selected.id, l))}>
                        {LAYER_LABEL[l]}
                      </button>
                    ))}
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
