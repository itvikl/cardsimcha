'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Stage, Layer, Rect, Text, Image as KImage, Transformer } from 'react-konva';
import useImage from 'use-image';
import type Konva from 'konva';
import {
  addElement as addTo,
  allElements,
  FONTS,
  findElement,
  moveInLayer,
  moveToLayer,
  PAGE_PRESETS,
  removeElement,
  replaceElement,
  setBackground,
  updateElement,
} from '@/lib/canvas';
import { newImage, newRect, newText } from '@/lib/elements';
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
const fontStyle = (w: number) => (w >= 700 ? 'bold' : w === 400 ? 'normal' : String(w));
const uploadUrl = (a: ImageAsset | undefined) => (a ? `/api/uploads/${a.file}` : '');

function ImageNode({
  el,
  asset,
  draggable,
  onSelect,
  onChange,
}: {
  el: ImageElement;
  asset: ImageAsset | undefined;
  draggable: boolean;
  onSelect?: () => void;
  onChange: (patch: Partial<CanvasElement>) => void;
}) {
  const [img, status] = useImage(uploadUrl(asset));
  const common = {
    id: el.id,
    x: el.x_mm * PX,
    y: el.y_mm * PX,
    width: el.w_mm * PX,
    height: el.h_mm * PX,
    rotation: el.rotation,
    draggable,
    onMouseDown: onSelect,
    onTap: onSelect,
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

/** The background layer: its fill, and its image filling the page (cover or contain). Never takes clicks. */
function BackgroundNode({ bg, asset, w, h }: { bg: BackgroundLayer; asset: ImageAsset | undefined; w: number; h: number }) {
  const [img] = useImage(bg.image && !bg.image.colorOverride ? uploadUrl(asset) : '');
  const fill = <Rect x={0} y={0} width={w} height={h} fill={bg.fill.color} />;
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [library, setLibrary] = useState<{ categories: Category[]; images: ImageAsset[] }>({ categories: [], images: [] });
  const [libCat, setLibCat] = useState<string>('');
  const [zoomOverride, setZoomOverride] = useState<number | null>(null);
  const [fit, setFit] = useState(0.5);
  const [save, setSave] = useState<SaveState>('saved');
  const [loadError, setLoadError] = useState('');
  const [fontsTick, setFontsTick] = useState(0);

  const stageRef = useRef<Konva.Stage>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
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
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    return () => ro.disconnect();
  }, [doc?.page.width_mm, doc?.page.height_mm, !!doc]); // eslint-disable-line react-hooks/exhaustive-deps

  const zoom = zoomOverride ?? fit;

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

  const removeSelected = useCallback(() => {
    if (!selectedId) return;
    change((d) => removeElement(d, selectedId));
    setSelectedId(null);
  }, [selectedId, change]);

  const duplicateSelected = useCallback(() => {
    if (!found) return;
    addElement({ ...found.el, id: crypto.randomUUID(), x_mm: found.el.x_mm + 5, y_mm: found.el.y_mm + 5 }, found.layer);
  }, [found]); // eslint-disable-line react-hooks/exhaustive-deps

  const moveZ = (dir: 'front' | 'back' | 'up' | 'down') => selectedId && change((d) => moveInLayer(d, selectedId, dir));

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
  const bg = doc.layers.background;
  const elements = allElements(doc);
  const swappables = elements.filter((e): e is ImageElement => e.type === 'image' && e.locks.content);
  const textFields = elements.filter((e): e is TextElement => e.type === 'text' && (e.locks.content || e.locks.style));
  const bgChoice = bg.locks.content || bg.locks.style;
  const textEl = selected?.type === 'text' ? selected : null;
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
    const onSelect = full ? () => setSelectedId(el.id) : undefined;
    // customers may drag what its transform lock allows; the server checks it again on save
    const draggable = full || el.locks.transform;
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
      return <ImageNode key={el.id} el={el} asset={assetById.get(el.asset_id)} draggable={draggable} onSelect={onSelect} onChange={onChange} />;
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
          fill={el.fill.color}
          draggable={draggable}
          onMouseDown={onSelect}
          onTap={onSelect}
          onDragEnd={(e) => onChange({ x_mm: e.target.x() / PX, y_mm: e.target.y() / PX })}
          onTransformEnd={(e) => transformEnd(e, true)}
        />
      );
    }
    const focusField = () => {
      if (!el.locks.content && !el.locks.style) return;
      setActiveField(el.id);
      fieldRefs.current[el.id]?.focus({ preventScroll: false });
    };
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
        fontFamily={el.font.family}
        fontStyle={fontStyle(el.font.weight)}
        fontSize={el.font.size_pt * PT_TO_MM * PX}
        fill={el.font.color}
        lineHeight={el.font.line_height ?? 1.25}
        letterSpacing={(el.font.letter_spacing ?? 0) * PT_TO_MM * PX}
        wrap="word"
        draggable={draggable}
        dragBoundFunc={function (this: Konva.Node, pos) {
          // keep the text box inside the page while dragging (pos is in screen pixels)
          const w = this.width() * zoom;
          const h = this.height() * zoom;
          return {
            x: clamp(pos.x, 0, Math.max(0, pageW * zoom - w)),
            y: clamp(pos.y, 0, Math.max(0, pageH * zoom - h)),
          };
        }}
        onMouseDown={onSelect ?? focusField}
        onTap={onSelect ?? focusField}
        onMouseEnter={(e) => {
          if (draggable) e.target.getStage()!.container().style.cursor = 'move';
        }}
        onMouseLeave={(e) => {
          e.target.getStage()!.container().style.cursor = '';
        }}
        onDragEnd={(e) => onChange({ x_mm: e.target.x() / PX, y_mm: e.target.y() / PX })}
        onTransformEnd={(e) => transformEnd(e, false)}
      />
    );
  };

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
              {/* one Konva layer per card layer: the background never takes clicks and is always below */}
              <Layer listening={false}>
                <BackgroundNode bg={bg} asset={bg.image ? assetById.get(bg.image.asset_id) : undefined} w={pageW} h={pageH} />
              </Layer>
              <Layer>{doc.layers.content.map(renderElement)}</Layer>
              <Layer>{doc.layers.overlay.map(renderElement)}</Layer>
              <Layer>
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
            ) : (
              <>
                <h2 className="panel-title">
                  {selected.type === 'text' ? 'טקסט' : selected.type === 'image' ? 'תמונה' : 'מלבן'} · {LAYER_LABEL[found!.layer]}
                </h2>

                {textEl && (
                  <>
                    <label className="field">
                      תוכן
                      <textarea rows={3} dir="auto" value={textEl.text} onChange={(e) => updateText({ text: e.target.value }, 'text:' + textEl.id)} />
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
                        <button
                          aria-pressed={textEl.font.weight >= 700}
                          onClick={() => updateText({ font: { ...textEl.font, weight: textEl.font.weight >= 700 ? 400 : 700 } })}
                        >
                          מודגש
                        </button>
                      </div>
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
