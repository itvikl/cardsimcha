import { formatOfPage } from './adFormats';
import { heightOf } from './adText';
import type { CanvasDoc, CanvasElement, TextElement } from './types';

/** `must`: worth stopping for before the ad goes out. `tip`: worth knowing. Either way the business decides. */
export type AdIssue = { id: string; level: 'must' | 'tip'; text: string };

const PT_TO_MM = 25.4 / 72;
const SAMPLES = ['050-0000000', 'שם העסק', 'סלוגן קצר'];
const RISKY = [/100%/, /מובטח/, /הכי\s+זול/, /בלי\s+סיכון/, /הטוב\s+ביותר/];
const CONTACT = /(?:\d[\s-]?){7,}/;

function luminance(hex: string) {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** the solid colour behind a point, or null when a picture or a see-through shape is there and it can't be told */
function colorBehind(doc: CanvasDoc, upTo: number, x: number, y: number): string | null {
  for (let i = upTo - 1; i >= 0; i--) {
    const e = doc.elements[i];
    if (e.type === 'text' || e.rotation) continue;
    if (x < e.x_mm || x > e.x_mm + e.w_mm || y < e.y_mm || y > e.y_mm + e.h_mm) continue;
    if (e.type === 'image') return e.colorOverride ?? null;
    return e.opacity !== undefined && e.opacity < 1 ? null : e.fill;
  }
  return doc.page.background;
}

/**
 * What to look at before an ad goes out. It reads the design as it stands, so the editor can run it on every change.
 * `measured` gives a text's real drawn height (element id -> mm); without it the height is estimated.
 */
export function checkAd(doc: CanvasDoc, { risky = [], measured = {} }: { risky?: RegExp[]; measured?: Record<string, number> } = {}): AdIssue[] {
  const issues: AdIssue[] = [];
  const add = (id: string, level: AdIssue['level'], text: string) => issues.push({ id, level, text });
  const all = doc.elements.filter((e): e is TextElement => e.type === 'text');
  const texts = all.filter((e) => !e.credit && !!e.text.trim());
  const label = (e: TextElement) => (e.label ? `"${e.label}"` : 'אחד הטקסטים');
  const heightFor = (e: TextElement) => measured[e.id] ?? heightOf(e.text, e.font.size_pt, e.w_mm);

  if (all.some((e) => e.role === 'businessName' && !e.text.trim())) add('name', 'must', 'חסר שם העסק');
  if (!texts.some((e) => CONTACT.test(e.text) || (e.role === 'website' && e.text.trim()))) add('contact', 'must', 'אין טלפון או דרך אחרת ליצור קשר');
  for (const e of all) if (e.label === 'קריאה לפעולה' && !e.text.trim()) add('cta', 'must', 'אין קריאה לפעולה: מה הקורא צריך לעשות?');
  for (const e of texts) if (SAMPLES.includes(e.text.trim())) add(`sample:${e.id}`, 'must', `נשאר טקסט לדוגמה: "${e.text.trim()}"`);

  for (const e of texts) {
    const hit = [...RISKY, ...risky].find((r) => r.test(e.text));
    if (hit) add(`risky:${e.id}`, 'must', `כדאי לבדוק את הניסוח ב${label(e)}: "${e.text.match(hit)?.[0]}" היא הבטחה שאולי לא תוכלו לעמוד בה`);
  }

  for (const e of texts) {
    if (e.y_mm + heightFor(e) > doc.page.height_mm + 0.5 || e.x_mm + e.w_mm > doc.page.width_mm + 0.5 || e.x_mm < -0.5) add(`out:${e.id}`, 'must', `${label(e)} יוצא מגבול העמוד`);
    const i = doc.elements.indexOf(e as CanvasElement);
    const behind = colorBehind(doc, i, e.x_mm + e.w_mm / 2, e.y_mm + heightFor(e) / 2);
    if (behind && contrast(e.font.color, behind) < 3) add(`contrast:${e.id}`, 'must', `${label(e)} קשה לקריאה על הרקע שלו`);
  }

  texts.forEach((a, i) => {
    for (const b of texts.slice(i + 1)) {
      if (a.rotation || b.rotation) continue;
      const wide = Math.min(a.x_mm + a.w_mm, b.x_mm + b.w_mm) - Math.max(a.x_mm, b.x_mm);
      const tall = Math.min(a.y_mm + heightFor(a), b.y_mm + heightFor(b)) - Math.max(a.y_mm, b.y_mm);
      if (wide > 2 && tall > Math.min(heightFor(a), heightFor(b)) * 0.3) add(`overlap:${a.id}:${b.id}`, 'must', `${label(a)} ו${label(b)} עולים זה על זה`);
    }
  });

  if (!doc.elements.some((e) => e.type === 'image' && e.role === 'logo')) add('logo', 'tip', 'אין לוגו על המודעה. אפשר להוסיף אותו בעמוד המיתוג');
  const format = formatOfPage(doc.page.width_mm, doc.page.height_mm);
  const words = texts.filter((e) => e.editable).flatMap((e) => e.text.trim().split(/\s+/)).length;
  if (words > (format?.medium === 'print' ? 90 : 40)) add('long', 'tip', `יש כאן ${words} מילים. מודעה קצרה נקראת יותר`);
  const headline = texts.find((e) => e.label === 'כותרת');
  if (headline && headline.text.trim().split(/\s+/).length > 10) add('headline', 'tip', 'הכותרת ארוכה. עד עשר מילים קל לקלוט במבט אחד');
  if (format?.medium === 'digital') {
    // the size in pixels on a phone about 360 wide
    const small = texts.find((e) => e.editable && (e.font.size_pt * PT_TO_MM * 360) / doc.page.width_mm < 11);
    if (small) add('small', 'tip', `${label(small)} ייראה קטן בטלפון`);
  }
  return issues;
}
