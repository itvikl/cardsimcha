import type { BackgroundLayer, CanvasDoc, CanvasElement, Field, Fill, LayerName, Locks } from './types';

export const PAGE_PRESETS = [
  { id: 'a4', label: 'A4 לאורך', width_mm: 210, height_mm: 297 },
  { id: 'a4l', label: 'A4 לרוחב', width_mm: 297, height_mm: 210 },
  { id: 'a5', label: 'A5 לאורך', width_mm: 148, height_mm: 210 },
  { id: 'square', label: 'ריבוע (לשיתוף)', width_mm: 200, height_mm: 200 },
  { id: 'story', label: 'סטורי 9:16', width_mm: 108, height_mm: 192 },
] as const;

export const FONTS = ['Heebo', 'Frank Ruhl Libre', 'Assistant', 'Secular One', 'Arial'] as const;

export const LAYERS: LayerName[] = ['content', 'overlay'];

/** customers may do nothing with it */
export const LOCKED: Locks = { content: false, transform: false, delete: false, style: false };
/** a customer form field: change the text and its colour (design doc §4.3 defaults) */
export const FIELD_LOCKS: Locks = { content: true, transform: false, delete: false, style: true };

export const emptyDoc = (width_mm = 210, height_mm = 297): CanvasDoc => ({
  schema_version: 2,
  page: { width_mm, height_mm },
  layers: { background: { fill: { type: 'solid', color: '#FAF8F3' }, locks: LOCKED }, content: [], overlay: [] },
});

// ---- reading and changing a doc (pure; the editor and the agent share these) ------------

export const allElements = (d: CanvasDoc): CanvasElement[] => [...d.layers.content, ...d.layers.overlay];

export function findElement(d: CanvasDoc, id: string): { el: CanvasElement; layer: LayerName } | null {
  for (const layer of LAYERS) {
    const el = d.layers[layer].find((e) => e.id === id);
    if (el) return { el, layer };
  }
  return null;
}

export function updateElement(d: CanvasDoc, id: string, patch: Partial<CanvasElement>): CanvasDoc {
  const map = (els: CanvasElement[]) => els.map((e) => (e.id === id ? ({ ...e, ...patch } as CanvasElement) : e));
  return { ...d, layers: { ...d.layers, content: map(d.layers.content), overlay: map(d.layers.overlay) } };
}

/** puts `el` in place of element `id`, keeping its layer and position */
export function replaceElement(d: CanvasDoc, id: string, el: CanvasElement): CanvasDoc {
  const map = (els: CanvasElement[]) => els.map((e) => (e.id === id ? el : e));
  return { ...d, layers: { ...d.layers, content: map(d.layers.content), overlay: map(d.layers.overlay) } };
}

export function removeElement(d: CanvasDoc, id: string): CanvasDoc {
  const keep = (els: CanvasElement[]) => els.filter((e) => e.id !== id);
  return { ...d, layers: { ...d.layers, content: keep(d.layers.content), overlay: keep(d.layers.overlay) } };
}

export function addElement(d: CanvasDoc, el: CanvasElement, layer: LayerName = 'content'): CanvasDoc {
  return { ...d, layers: { ...d.layers, [layer]: [...d.layers[layer], el] } };
}

export function setBackground(d: CanvasDoc, patch: Partial<BackgroundLayer>): CanvasDoc {
  return { ...d, layers: { ...d.layers, background: { ...d.layers.background, ...patch } } };
}

/** reorders an element inside its own layer: a content element never goes under the background */
export function moveInLayer(d: CanvasDoc, id: string, dir: 'front' | 'back' | 'up' | 'down'): CanvasDoc {
  const at = findElement(d, id);
  if (!at) return d;
  const els = [...d.layers[at.layer]];
  const i = els.findIndex((e) => e.id === id);
  const [it] = els.splice(i, 1);
  const to = dir === 'front' ? els.length : dir === 'back' ? 0 : dir === 'up' ? Math.min(els.length, i + 1) : Math.max(0, i - 1);
  els.splice(to, 0, it);
  return { ...d, layers: { ...d.layers, [at.layer]: els } };
}

/** moves an element to the top of the other layer */
export function moveToLayer(d: CanvasDoc, id: string, layer: LayerName): CanvasDoc {
  const at = findElement(d, id);
  if (!at || at.layer === layer) return d;
  return addElement(removeElement(d, id), at.el, layer);
}

/** what the customer sees as a form: elements whose content or colour they may change */
export const customerFields = (d: CanvasDoc) => allElements(d).filter((e) => e.locks.content || e.locks.style);

// ---- validation ----------------------------------------------------------------------------

const MAX_ELEMENTS = 300;
const isNum = (v: unknown, min = -5000, max = 5000): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
export const isColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 64;
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';

function locks(v: unknown): Locks | null {
  const l = v as Locks | null;
  if (!l || !isBool(l.content) || !isBool(l.transform) || !isBool(l.delete) || !isBool(l.style)) return null;
  return { content: l.content, transform: l.transform, delete: l.delete, style: l.style };
}

/** undefined: absent; null: invalid */
function field(v: unknown): Field | undefined | null {
  if (v === undefined) return undefined;
  const f = v as Field | null;
  if (!f || typeof f.label !== 'string' || f.label.length > 60) return null;
  if (f.variable !== undefined && (typeof f.variable !== 'string' || !/^[a-z_][a-z0-9_]{0,40}$/.test(f.variable))) return null;
  return f.variable ? { label: f.label, variable: f.variable } : { label: f.label };
}

function fill(v: unknown): Fill | null {
  const f = v as Fill | null;
  return f && f.type === 'solid' && isColor(f.color) ? { type: 'solid', color: f.color } : null;
}

const opt = <T,>(v: T | undefined) => (v === undefined ? {} : v);

function element(e: Record<string, unknown> | null): CanvasElement | null {
  if (!e || !isId(e.id) || !isNum(e.x_mm) || !isNum(e.y_mm) || !isNum(e.rotation, -360, 360)) return null;
  const l = locks(e.locks);
  const f = field(e.field);
  if (!l || f === null) return null;
  const base = { id: e.id, x_mm: e.x_mm, y_mm: e.y_mm, rotation: e.rotation, locks: l, ...(f && { field: f }) };

  if (e.type === 'text') {
    const font = e.font as Record<string, unknown> | null;
    if (typeof e.text !== 'string' || e.text.length > 2000 || !isNum(e.w_mm, 1, 2000)) return null;
    if (e.align !== 'right' && e.align !== 'center' && e.align !== 'left') return null;
    if (!font || typeof font.family !== 'string' || font.family.length > 60 || !isColor(font.color)) return null;
    if (!isNum(font.weight, 100, 900) || font.weight % 100 !== 0 || !isNum(font.size_pt, 4, 400)) return null;
    if (font.line_height !== undefined && !isNum(font.line_height, 0.5, 3)) return null;
    if (font.letter_spacing !== undefined && !isNum(font.letter_spacing, -20, 100)) return null;
    return {
      ...base,
      type: 'text',
      w_mm: e.w_mm,
      text: e.text,
      align: e.align,
      font: {
        family: font.family,
        weight: font.weight,
        size_pt: font.size_pt,
        color: font.color,
        ...opt(font.line_height !== undefined ? { line_height: font.line_height as number } : undefined),
        ...opt(font.letter_spacing !== undefined ? { letter_spacing: font.letter_spacing as number } : undefined),
      },
    };
  }
  if (e.type === 'image') {
    if (!isNum(e.w_mm, 1, 5000) || !isNum(e.h_mm, 1, 5000) || !isId(e.asset_id)) return null;
    if (e.swap_collection_id !== undefined && !isId(e.swap_collection_id)) return null;
    if (e.colorOverride !== undefined && !isColor(e.colorOverride)) return null;
    return {
      ...base,
      type: 'image',
      w_mm: e.w_mm,
      h_mm: e.h_mm,
      asset_id: e.asset_id,
      ...(e.swap_collection_id !== undefined && { swap_collection_id: e.swap_collection_id as string }),
      ...(e.colorOverride !== undefined && { colorOverride: e.colorOverride as string }),
    };
  }
  if (e.type === 'shape') {
    const fl = fill(e.fill);
    if (e.shape !== 'rect' || !isNum(e.w_mm, 1, 5000) || !isNum(e.h_mm, 1, 5000) || !fl) return null;
    return { ...base, type: 'shape', shape: 'rect', w_mm: e.w_mm, h_mm: e.h_mm, fill: fl };
  }
  return null;
}

function background(v: unknown): BackgroundLayer | null {
  const b = v as Record<string, unknown> | null;
  if (!b) return null;
  const fl = fill(b.fill);
  const l = locks(b.locks);
  const f = field(b.field);
  if (!fl || !l || f === null) return null;
  if (b.swap_collection_id !== undefined && !isId(b.swap_collection_id)) return null;
  let image: BackgroundLayer['image'];
  if (b.image !== undefined) {
    const i = b.image as Record<string, unknown> | null;
    if (!i || !isId(i.asset_id) || (i.fit !== 'cover' && i.fit !== 'contain')) return null;
    if (i.colorOverride !== undefined && !isColor(i.colorOverride)) return null;
    image = { asset_id: i.asset_id, fit: i.fit, ...(i.colorOverride !== undefined && { colorOverride: i.colorOverride as string }) };
  }
  return {
    fill: fl,
    locks: l,
    ...(image && { image }),
    ...(f && { field: f }),
    ...(b.swap_collection_id !== undefined && { swap_collection_id: b.swap_collection_id as string }),
  };
}

/** Returns a sanitized v2 doc (unknown properties dropped), or null when the input is not valid. */
export function validateDoc(input: unknown): CanvasDoc | null {
  const d = input as { schema_version?: unknown; page?: Record<string, unknown>; layers?: Record<string, unknown> } | null;
  if (!d || d.schema_version !== 2 || !d.page || !d.layers) return null;
  const { width_mm, height_mm } = d.page;
  if (!isNum(width_mm, 20, 2000) || !isNum(height_mm, 20, 2000)) return null;
  const bg = background(d.layers.background);
  if (!bg) return null;
  const { content, overlay } = d.layers;
  if (!Array.isArray(content) || !Array.isArray(overlay) || content.length + overlay.length > MAX_ELEMENTS) return null;

  const ids = new Set<string>();
  const layer = (raw: unknown[]): CanvasElement[] | null => {
    const out: CanvasElement[] = [];
    for (const r of raw) {
      const el = element(r as Record<string, unknown> | null);
      if (!el || ids.has(el.id)) return null;
      ids.add(el.id);
      out.push(el);
    }
    return out;
  };
  const c = layer(content);
  const o = c && layer(overlay);
  if (!c || !o) return null;
  return { schema_version: 2, page: { width_mm, height_mm }, layers: { background: bg, content: c, overlay: o } };
}

// ---- edits by actor (design doc §4.3) ---------------------------------------------------------

export type Actor = 'author' | 'customer';

/**
 * The doc to store when `actor` sends `incoming` over `stored`. An author may change
 * anything (the doc is only validated). For a customer, every stored element takes from
 * the incoming doc only what its locks allow; new elements and reordering are ignored,
 * and a missing element is removed only when its `delete` lock allows it. The server
 * never trusts the client, and the AI assistant goes through the same function.
 */
export function applyEdits(
  stored: CanvasDoc,
  incoming: unknown,
  actor: Actor,
  assets: { id: string; categoryId: string }[] = [],
): CanvasDoc | null {
  if (actor === 'author') return validateDoc(incoming);
  const inc = incoming as { layers?: Record<string, unknown> } | null;
  if (!inc?.layers) return null;

  const sent = new Map<string, Record<string, unknown>>();
  for (const name of LAYERS) {
    const els = inc.layers[name];
    if (!Array.isArray(els)) continue;
    for (const e of els) if (e && typeof e === 'object' && typeof e.id === 'string') sent.set(e.id, e);
  }
  const { width_mm: W, height_mm: H } = stored.page;
  const swapOk = (asset: unknown, collection?: string) =>
    typeof asset === 'string' && assets.some((a) => a.id === asset && (!collection || a.categoryId === collection));

  const edit = (e: CanvasElement): CanvasElement | null => {
    const s = sent.get(e.id);
    if (!s) return e.locks.delete ? null : e;
    let out: CanvasElement = e;
    if (e.locks.transform) {
      // position stays inside the page; anything that is not a finite number is ignored
      const num = (v: unknown, a: number, b: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, a, b) : d);
      out = { ...out, x_mm: num(s.x_mm, 0, W - 5, e.x_mm), y_mm: num(s.y_mm, 0, H - 5, e.y_mm), rotation: num(s.rotation, -360, 360, e.rotation) };
      if ('w_mm' in out) out = { ...out, w_mm: num(s.w_mm, 1, 2000, out.w_mm) };
      if (out.type !== 'text') out = { ...out, h_mm: num(s.h_mm, 1, 2000, out.h_mm) };
    }
    if (e.locks.content) {
      if (out.type === 'text' && typeof s.text === 'string') out = { ...out, text: s.text.slice(0, 500) };
      if (out.type === 'image') out = swap(out, s, swapOk(s.asset_id, out.swap_collection_id));
    }
    if (e.locks.style) {
      // only the colour; size, font and family stay as designed
      const color = out.type === 'text' ? (s.font as { color?: unknown } | undefined)?.color : (s.fill as { color?: unknown } | undefined)?.color;
      if (isColor(color) && out.type === 'text') out = { ...out, font: { ...out.font, color } };
      if (isColor(color) && out.type === 'shape') out = { ...out, fill: { type: 'solid', color } };
    }
    return out;
  };

  let bg = stored.layers.background;
  const sb = inc.layers.background as { fill?: { color?: unknown }; image?: Record<string, unknown> } | undefined;
  if (sb && bg.locks.content && sb.image) {
    const img = sb.image;
    const ok = swapOk(img.asset_id, bg.swap_collection_id);
    const asset_id = ok ? (img.asset_id as string) : bg.image?.asset_id;
    if (asset_id) {
      bg = {
        ...bg,
        image: { asset_id, fit: bg.image?.fit ?? 'cover', ...(isColor(img.colorOverride) && { colorOverride: img.colorOverride }) },
      };
    }
  }
  if (sb && bg.locks.style && isColor(sb.fill?.color)) bg = { ...bg, fill: { type: 'solid', color: sb.fill.color } };

  const keep = (els: CanvasElement[]) => els.map(edit).filter((e): e is CanvasElement => e !== null);
  return validateDoc({
    ...stored,
    layers: { background: bg, content: keep(stored.layers.content), overlay: keep(stored.layers.overlay) },
  });
}

/** a flat colour replaces the image; picking an image again (no colour sent) clears it */
function swap<T extends { asset_id: string; colorOverride?: string }>(el: T, s: Record<string, unknown>, assetOk: boolean): T {
  const { colorOverride: _old, ...rest } = el;
  void _old;
  return {
    ...(rest as T),
    asset_id: assetOk ? (s.asset_id as string) : el.asset_id,
    ...(isColor(s.colorOverride) && { colorOverride: s.colorOverride }),
  };
}

const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));
