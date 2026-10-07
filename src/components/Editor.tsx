'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Stage, Layer, Rect, Text, Image as KImage, Transformer } from 'react-konva';
import useImage from 'use-image';
import type Konva from 'konva';
import { FONTS, PAGE_PRESETS } from '@/lib/canvas';
import { useToast } from './Toast';
import type { CanvasDoc, CanvasElement, Category, ImageAsset, Project, TextElement } from '@/lib/types';

const PX = 3; // canvas pixels per mm at zoom 1
const PT_TO_MM = 25.4 / 72;
const HISTORY_LIMIT = 100;
/** Quick colour choices for customers (the site palette plus black and white). */
const BG_SWATCHES = ['#FAF8F3', '#FFFFFF', '#E4ECE3', '#DCE7DA', '#2F5D46', '#1F3A2E', '#C9A24B', '#1B1F1C'];
const SWATCHES = ['#1F3A2E', '#2F5D46', '#C9A24B', '#FAF8F3', '#1B1F1C'];

type SaveState = 'saved' | 'saving' | 'dirty' | 'error';

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
  const [pubStatus, setPubStatus] = useState<'draft' | 'published'>('draft');
  const [pubBusy, setPubBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [activeField, setActiveField] = useState<string | null>(null);
  const [hintOpen, setHintOpen] = useState(false);
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
        const p: Project & { canManage: boolean } = await pRes.json();
        setCanManage(p.canManage);
        setPubStatus(p.status);
        const lib = await lRes.json();
        setProject(p);
        setDoc(p.canvas);
        setName(p.name);
        setLibrary(lib);
        setLibCat(lib.categories[0]?.id ?? '');
        loadedRef.current = true;
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
    if (!doc) return;
    const w = Math.min(120, doc.page.width_mm - 20);
    addElement({
      id: crypto.randomUUID(),
      type: 'text',
      x_mm: (doc.page.width_mm - w) / 2,
      y_mm: doc.page.height_mm / 3,
      w_mm: w,
      rotation: 0,
      z: doc.elements.length,
      text: 'לחצו לעריכת הטקסט',
      align: 'center',
      editable: true,
      label: 'טקסט',
      font: { family: 'Heebo', weight: 700, size_pt: 32, color: '#1F3A2E' },
    });
  };

  const addRect = () => {
    const doc = docRef.current;
    if (!doc) return;
    addElement({
      id: crypto.randomUUID(),
      type: 'rect',
      x_mm: doc.page.width_mm / 4,
      y_mm: doc.page.height_mm / 4,
      w_mm: doc.page.width_mm / 2,
      h_mm: doc.page.height_mm / 6,
      rotation: 0,
      z: doc.elements.length,
      fill: '#E4ECE3',
    });
  };

  const addImage = (asset: ImageAsset) => {
    const doc = docRef.current;
    if (!doc) return;
    let w = Math.min(doc.page.width_mm * 0.6, 200);
    let h = (w * asset.height) / asset.width;
    const maxH = doc.page.height_mm * 0.7;
    if (h > maxH) {
      h = maxH;
      w = (h * asset.width) / asset.height;
    }
    addElement({
      id: crypto.randomUUID(),
      type: 'image',
      x_mm: (doc.page.width_mm - w) / 2,
      y_mm: (doc.page.height_mm - h) / 2,
      w_mm: w,
      h_mm: h,
      rotation: 0,
      z: doc.elements.length,
      asset_id: asset.id,
    });
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
  const swappables = doc.elements.filter((e): e is Extract<CanvasElement, { type: 'image' }> => e.type === 'image' && !!e.swappable);
  const editableFields = doc.elements.filter((e): e is TextElement => e.type === 'text' && !!e.editable);
  const textEl = selected?.type === 'text' ? selected : null;
  const updateText = (patch: Partial<TextElement>, key?: string) => selected && patchElement(selected.id, patch, key);
  const num = (v: string) => (v === '' || Number.isNaN(Number(v)) ? null : Number(v));

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
        <button className="btn small" onClick={undo} disabled={!pastRef.current.length} title="ביטול (Ctrl+Z)">
          ביטול
        </button>
        <button className="btn small" onClick={redo} disabled={!futureRef.current.length} title="חזרה (Ctrl+Y)">
          חזרה
        </button>
        <span className="spacer" />
        <span className="zoom-controls row">
        <button className="btn small" onClick={() => setZoomOverride(clamp(zoom - 0.1, 0.1, 3))} aria-label="הקטנה">
          −
        </button>
        <span className="status" style={{ minWidth: 44, textAlign: 'center' }}>
          {Math.round(zoom * 100)}%
        </span>
        <button className="btn small" onClick={() => setZoomOverride(clamp(zoom + 0.1, 0.1, 3))} aria-label="הגדלה">
          +
        </button>
        <button className="btn small" onClick={() => setZoomOverride(null)}>
          התאמה למסך
        </button>
        </span>
        <span className="status" role="status">{saveLabel}</span>
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
        <button className="btn primary small" onClick={exportPng} disabled={exporting}>
          {exporting ? 'מכין קובץ…' : full ? 'הורדת PNG (300dpi)' : 'הורדת הכרטיס'}
        </button>
      </div>

      <div className={'editor' + (full ? '' : ' customer')}>
        {!full && (
          <aside className="left" aria-label="פרטי הכרטיס">
            <h2 className="panel-title" style={{ order: -3 }}>
              הפרטים בכרטיס
            </h2>
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
            {editableFields.length === 0 && swappables.length === 0 ? (
              <p className="status">בתבנית הזו אין שדות לעריכה.</p>
            ) : (
              editableFields.map((f) => (
                <div key={f.id} className="field">
                  <div className="row" style={{ justifyContent: 'space-between' }}>
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
                <div key={el.id} className="field" style={{ order: -1 }}>
                  {el.label || 'תמונה'}
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
                          style={!el.colorOverride && img.id === el.asset_id ? { borderColor: 'var(--green-700)', borderWidth: 2 } : undefined}
                          onClick={() => patchElement(el.id, { asset_id: img.id, colorOverride: undefined } as Partial<CanvasElement>)}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={`/api/uploads/${img.file}`} alt={img.name} />
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="row" style={{ justifyContent: 'space-between' }}>
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
            {editableFields.length > 0 && <p className="status">אפשר לגרור כל טקסט בכרטיס כדי לשנות את מיקומו.</p>}
            <p className="status">שינויים נשמרים אוטומטית. כשמסיימים אפשר להוריד את הכרטיס כקובץ תמונה.</p>
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
        </aside>
        )}

        <div
          className="stage-wrap"
          ref={wrapRef}
          onMouseDown={(e) => e.target === e.currentTarget && setSelectedId(null)}
        >
          <div style={{ boxShadow: '0 2px 12px rgba(0,0,0,.18)', width: pageW * zoom, height: pageH * zoom, flex: 'none' }}>
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
                <Rect x={0} y={0} width={pageW} height={pageH} fill={doc.page.background} onMouseDown={() => { setSelectedId(null); setActiveField(null); }} onTap={() => { setSelectedId(null); setActiveField(null); }} />
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
                <label className="field">
                  צבע מילוי
                  <input type="color" value={selected.fill} onChange={(e) => patchElement(selected.id, { fill: e.target.value }, 'fill:' + selected.id)} />
                </label>
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
