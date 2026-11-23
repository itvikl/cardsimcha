import { allElements, findElement } from './canvas';
import type { CanvasDoc, CanvasElement } from './types';

// The history list's words for a change. Ported from feature/business-ads (Vitol) onto card format v2.

/** An element as a person would name it in the history: its field name, a few of its words, or what it is. */
export function nameOf(e: CanvasElement): string {
  if (e.type === 'text') {
    const words = e.text.replace(/\s+/g, ' ').trim();
    return e.field?.label || (words.length > 18 ? words.slice(0, 18) + '…' : words) || 'טקסט';
  }
  if (e.type === 'image') return e.field?.label || 'תמונה';
  return 'צורה';
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** what changed in one element, in the words of the history list */
function whatChanged(a: CanvasElement, b: CanvasElement): string {
  const changed = (Object.keys({ ...a, ...b }) as (keyof CanvasElement)[]).filter((k) => !same(a[k], b[k]));
  const has = (...keys: string[]) => changed.some((k) => keys.includes(k));
  if (a.type === 'text' && b.type === 'text') {
    if (has('text')) return 'שינוי טקסט';
    if (has('font')) {
      if (a.font.color !== b.font.color) return 'צבע';
      if (a.font.family !== b.font.family) return 'פונט';
      if (a.font.size_pt !== b.font.size_pt) return 'גודל טקסט';
      if (a.font.weight !== b.font.weight) return 'משקל';
      return 'ריווח';
    }
    if (has('arc')) return 'קשת';
    if (has('fit')) return 'התאמה לרוחב';
    if (has('shadow', 'stroke', 'foil')) return 'אפקט';
    if (has('align')) return 'יישור';
  }
  if (has('locks', 'field')) return 'הרשאות לקוח';
  if (has('hidden')) return b.hidden ? 'הסתרה' : 'הצגה';
  if (has('pinned')) return b.pinned ? 'נעילה' : 'שחרור נעילה';
  if (has('group')) return b.group ? 'קיבוץ' : 'פירוק קבוצה';
  if (has('part')) return 'חלק בנוסח';
  if (has('w_mm', 'h_mm')) return 'שינוי גודל';
  if (has('rotation')) return 'סיבוב';
  if (has('x_mm', 'y_mm')) return 'הזזה';
  if (has('fill', 'colorOverride', 'opacity', 'corner_radius_mm')) return 'צבע';
  if (has('asset_id')) return 'החלפת תמונה';
  if (has('crop')) return 'חיתוך';
  if (has('mask')) return 'מסכה';
  return 'עריכה';
}

/** How `next` came from `prev`, in a few Hebrew words for the history list. */
export function describeChange(prev: CanvasDoc, next: CanvasDoc): string {
  if (!same(prev.page, next.page)) return 'הגדרות עמוד';
  if (!same(prev.layers.background, next.layers.background)) return 'רקע';
  if (!same(prev.guides, next.guides)) return 'קווי עזר';
  const was = allElements(prev);
  const now = allElements(next);
  const before = new Map(was.map((e) => [e.id, e]));
  const after = new Map(now.map((e) => [e.id, e]));
  const added = now.filter((e) => !before.has(e.id));
  const removed = was.filter((e) => !after.has(e.id));
  if (added.length) return added.length === 1 ? `הוספה: ${nameOf(added[0])}` : `הוספה של ${added.length}`;
  if (removed.length) return removed.length === 1 ? `מחיקה: ${nameOf(removed[0])}` : `מחיקה של ${removed.length}`;
  const changed = now.filter((e) => !same(before.get(e.id), e));
  if (!changed.length) {
    const moved = now.find((e) => findElement(prev, e.id)?.layer !== findElement(next, e.id)?.layer);
    return moved ? `העברת שכבה: ${nameOf(moved)}` : 'סדר שכבות';
  }
  if (changed.length > 1) return `${whatChanged(before.get(changed[0].id)!, changed[0])} · ${changed.length} אלמנטים`;
  return `${whatChanged(before.get(changed[0].id)!, changed[0])}: ${nameOf(changed[0])}`;
}
