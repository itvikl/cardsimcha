import type { CanvasDoc, CanvasElement } from './types';

export const PAGE_PRESETS = [
  { id: 'a4', label: 'A4 לאורך', width_mm: 210, height_mm: 297 },
  { id: 'a4l', label: 'A4 לרוחב', width_mm: 297, height_mm: 210 },
  { id: 'a5', label: 'A5 לאורך', width_mm: 148, height_mm: 210 },
  { id: 'square', label: 'ריבוע (לשיתוף)', width_mm: 200, height_mm: 200 },
  { id: 'story', label: 'סטורי 9:16', width_mm: 108, height_mm: 192 },
] as const;

export const FONTS = ['Heebo', 'Frank Ruhl Libre', 'Assistant', 'Secular One', 'Arial'] as const;

export const emptyDoc = (width_mm = 210, height_mm = 297): CanvasDoc => ({
  schema_version: 1,
  page: { width_mm, height_mm, background: '#FAF8F3' },
  elements: [],
});

const MAX_ELEMENTS = 300;
const isNum = (v: unknown, min = -5000, max = 5000): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const isColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);

/** Returns a sanitized doc, or null when the input is not a valid canvas document. */
export function validateDoc(input: unknown): CanvasDoc | null {
  const d = input as CanvasDoc | null;
  if (!d || d.schema_version !== 1 || !d.page || !Array.isArray(d.elements)) return null;
  const { width_mm, height_mm, background } = d.page;
  if (!isNum(width_mm, 20, 2000) || !isNum(height_mm, 20, 2000) || !isColor(background)) return null;
  if (d.elements.length > MAX_ELEMENTS) return null;

  const ids = new Set<string>();
  const elements: CanvasElement[] = [];
  for (const e of d.elements) {
    if (!e || typeof e.id !== 'string' || e.id.length > 64 || ids.has(e.id)) return null;
    ids.add(e.id);
    if (!isNum(e.x_mm) || !isNum(e.y_mm) || !isNum(e.rotation, -360, 360) || !isNum(e.z, -1e6, 1e6)) return null;
    if (e.type === 'text') {
      if (typeof e.text !== 'string' || e.text.length > 2000) return null;
      if (!isNum(e.w_mm, 1, 2000)) return null;
      if (!['right', 'center', 'left'].includes(e.align)) return null;
      if (e.editable !== undefined && typeof e.editable !== 'boolean') return null;
      if (e.label !== undefined && (typeof e.label !== 'string' || e.label.length > 60)) return null;
      const f = e.font;
      if (!f || typeof f.family !== 'string' || f.family.length > 60) return null;
      if (!(f.weight === 400 || f.weight === 700) || !isNum(f.size_pt, 4, 400) || !isColor(f.color)) return null;
      elements.push({ ...e });
    } else if (e.type === 'image') {
      if (!isNum(e.w_mm, 1, 2000) || !isNum(e.h_mm, 1, 2000) || typeof e.asset_id !== 'string') return null;
      if (e.swappable !== undefined && typeof e.swappable !== 'boolean') return null;
      if (e.colorOverride !== undefined && !isColor(e.colorOverride)) return null;
      if (e.swapCategoryId !== undefined && (typeof e.swapCategoryId !== 'string' || e.swapCategoryId.length > 64)) return null;
      if (e.label !== undefined && (typeof e.label !== 'string' || e.label.length > 60)) return null;
      elements.push({ ...e });
    } else if (e.type === 'rect') {
      if (!isNum(e.w_mm, 1, 2000) || !isNum(e.h_mm, 1, 2000) || !isColor(e.fill)) return null;
      elements.push({ ...e });
    } else {
      return null;
    }
  }
  return { schema_version: 1, page: { width_mm, height_mm, background }, elements };
}

/**
 * What a customer may change in their copy: only the text of elements the admin
 * marked editable. Everything else is taken from the stored doc, never from the client.
 */
export function applyCustomerEdits(
  stored: CanvasDoc,
  incoming: unknown,
  assets: { id: string; categoryId: string }[] = [],
): CanvasDoc | null {
  const inc = incoming as CanvasDoc | null;
  if (!inc || !Array.isArray(inc.elements)) return null;
  const texts = new Map<string, string>();
  const pos = new Map<string, { x: number; y: number }>();
  const colors = new Map<string, string>();
  const swaps = new Map<string, { asset: string; color?: string }>();
  for (const e of inc.elements) {
    if (e && e.type === 'image' && typeof e.id === 'string' && typeof e.asset_id === 'string') {
      swaps.set(e.id, { asset: e.asset_id, color: isColor(e.colorOverride) ? e.colorOverride : undefined });
    }
    if (e && e.type === 'text' && typeof e.id === 'string' && typeof e.text === 'string') {
      texts.set(e.id, e.text);
      if (isColor(e.font?.color)) colors.set(e.id, e.font.color);
      if (typeof e.x_mm === 'number' && typeof e.y_mm === 'number') pos.set(e.id, { x: e.x_mm, y: e.y_mm });
    }
  }
  return {
    ...stored,
    elements: stored.elements.map((e) => {
      if (e.type === 'image' && e.swappable) {
        // only an image from the category the admin chose (or any category when none was chosen)
        const sent = swaps.get(e.id);
        if (!sent) return e;
        const ok = assets.some((a) => a.id === sent.asset && (!e.swapCategoryId || a.categoryId === e.swapCategoryId));
        // a flat colour replaces the image; picking an image again (no colour sent) clears it
        const { colorOverride: _old, ...rest } = e;
        void _old;
        return { ...rest, asset_id: ok ? sent.asset : e.asset_id, ...(sent.color ? { colorOverride: sent.color } : {}) };
      }
      if (e.type !== 'text' || !e.editable) return e;
      const sent = pos.get(e.id);
      const text = texts.get(e.id);
      const color = colors.get(e.id);
      // position stays inside the page; anything that is not a finite number is ignored
      const x = sent && Number.isFinite(sent.x) ? clampTo(sent.x, 0, stored.page.width_mm - 5) : e.x_mm;
      const y = sent && Number.isFinite(sent.y) ? clampTo(sent.y, 0, stored.page.height_mm - 5) : e.y_mm;
      return {
        ...e,
        x_mm: x,
        y_mm: y,
        text: text === undefined ? e.text : text.slice(0, 500),
        font: color ? { ...e.font, color } : e.font, // only the colour of the font; size/family stay as designed
      };
    }),
  };
}

const clampTo = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));
