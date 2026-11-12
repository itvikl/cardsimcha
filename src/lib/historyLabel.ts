import type { CanvasDoc, CanvasElement } from './types';

/** An element as a person would name it in the history: its field name, a few of its words, or what it is. */
export function nameOf(e: CanvasElement): string {
  if (e.type === 'text') {
    const words = e.text.replace(/\s+/g, ' ').trim();
    return e.label || (words.length > 18 ? words.slice(0, 18) + '…' : words) || 'טקסט';
  }
  if (e.type === 'image') return e.label || (e.role === 'sticker' ? 'מדבקה' : e.role === 'logo' ? 'לוגו' : 'תמונה');
  return 'צורה';
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** what changed in one element, in the words of the history list */
function whatChanged(a: CanvasElement, b: CanvasElement): string {
  const changed = (Object.keys({ ...a, ...b }) as (keyof CanvasElement)[]).filter((k) => k !== 'z' && !same(a[k], b[k]));
  const has = (...keys: string[]) => changed.some((k) => keys.includes(k));
  if (a.type === 'text' && b.type === 'text') {
    if (has('text')) return 'שינוי טקסט';
    if (has('font')) {
      if (a.font.color !== b.font.color) return 'צבע';
      if (a.font.family !== b.font.family) return 'פונט';
      if (a.font.size_pt !== b.font.size_pt) return 'גודל טקסט';
      return 'משקל';
    }
    if (has('arc')) return 'קשת';
    if (has('letterSpacing', 'lineHeight')) return 'ריווח';
    if (has('shadow', 'stroke', 'foil')) return 'אפקט';
    if (has('align')) return 'יישור';
  }
  if (has('hidden')) return b.hidden ? 'הסתרה' : 'הצגה';
  if (has('locked')) return b.locked ? 'נעילה' : 'שחרור נעילה';
  if (has('group')) return b.group ? 'קיבוץ' : 'פירוק קבוצה';
  if (has('w_mm', 'h_mm')) return 'שינוי גודל';
  if (has('rotation')) return 'סיבוב';
  if (has('x_mm', 'y_mm')) return 'הזזה';
  if (has('fill', 'fill2', 'angle', 'colorOverride')) return 'צבע';
  if (has('asset_id')) return 'החלפת תמונה';
  if (has('crop')) return 'חיתוך';
  if (has('mask')) return 'מסכה';
  return 'עריכה';
}

/** How `next` came from `prev`, in a few Hebrew words for the history list. */
export function describeChange(prev: CanvasDoc, next: CanvasDoc): string {
  if (prev.wordingId !== next.wordingId) return 'החלפת נוסח';
  if (prev.backdropId !== next.backdropId) return 'החלפת רקע';
  if (!same(prev.page, next.page)) return 'הגדרות עמוד';
  const before = new Map(prev.elements.map((e) => [e.id, e]));
  const after = new Map(next.elements.map((e) => [e.id, e]));
  const added = next.elements.filter((e) => !before.has(e.id));
  const removed = prev.elements.filter((e) => !after.has(e.id));
  if (added.length) return added.length === 1 ? `הוספה: ${nameOf(added[0])}` : `הוספה של ${added.length}`;
  if (removed.length) return removed.length === 1 ? `מחיקה: ${nameOf(removed[0])}` : `מחיקה של ${removed.length}`;
  const changed = next.elements.filter((e) => !same(before.get(e.id), e) && !same({ ...before.get(e.id), z: 0 }, { ...e, z: 0 }));
  if (!changed.length) return prev.elements.some((e, i) => next.elements[i]?.id !== e.id) ? 'סדר שכבות' : 'עריכה';
  if (changed.length > 1) return `${whatChanged(before.get(changed[0].id)!, changed[0])} · ${changed.length} אלמנטים`;
  return `${whatChanged(before.get(changed[0].id)!, changed[0])}: ${nameOf(changed[0])}`;
}
