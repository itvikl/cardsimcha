import type { ReadText } from './agent/importDesign';
import { FIELD_LOCKS, LOCKED } from './canvas';
import type { CutObject } from './cutObjects';
import type { Refined } from './importClean';
import type { CanvasDoc, CanvasElement, TextElement } from './types';

const PT_TO_MM = 25.4 / 72;

const inside = (t: Refined, o: CutObject['object']) => {
  const cx = t.x + t.w / 2;
  const cy = t.y + t.h / 2;
  return cx > o.x && cx < o.x + o.w && cy > o.y && cy < o.y + o.h;
};

/**
 * The content layer of a template made from a finished design: each object a picture of its own (locked for
 * customers, the author moves it), and each text a live customer field on top. A text whose middle lies on an object
 * (the smallest, when objects sit inside one another) shares its group, so moving the object moves its texts. Places
 * are in percent of the picture: `refined` is each text's box fitted to its ink (importClean); `imgW`, `imgH` are the
 * cleaned picture's pixels, to size the cut-outs.
 */
export function importedContent(opts: {
  page: CanvasDoc['page'];
  texts: ReadText[];
  refined: Refined[];
  pieces: CutObject[];
  imgW: number;
  imgH: number;
  /** the uploaded picture of each piece, in order */
  pieceIds: string[];
  fonts: string[];
  newId: () => string;
}): CanvasElement[] {
  const { page, texts, refined, pieces, imgW, imgH, fonts, newId } = opts;
  const groups = pieces.map((p) => (refined.some((r) => inside(r, p.object)) ? newId() : undefined));
  const groupOf = (r: Refined) => {
    const at = pieces
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => inside(r, p.object))
      .sort((a, b) => a.p.object.w * a.p.object.h - b.p.object.w * b.p.object.h)[0];
    return at ? groups[at.i] : undefined;
  };

  const objects = pieces.map(
    (p, i): CanvasElement => ({
      id: newId(),
      type: 'image',
      x_mm: (p.object.x / 100) * page.width_mm,
      y_mm: (p.object.y / 100) * page.height_mm,
      w_mm: (p.width / imgW) * page.width_mm,
      h_mm: (p.height / imgH) * page.height_mm,
      rotation: 0,
      locks: LOCKED,
      asset_id: opts.pieceIds[i],
      ...(groups[i] && { group: groups[i] }),
    }),
  );

  const seen = new Set<string>();
  const words = texts.map((t, i): TextElement => {
    let label = t.label.trim() || 'טקסט';
    if (seen.has(label)) label = `${label} ${i + 1}`;
    seen.add(label);
    const fit = refined[i];
    const lines = Math.max(1, t.text.split('\n').length);
    const turned = t.rotation !== 0;
    // a turned line runs down the page: its thickness is measured across the width, its length down the height
    const across = turned ? page.width_mm : page.height_mm;
    const along = turned ? page.height_mm : page.width_mm;
    const inkThick = ((turned ? fit.w : fit.h) / 100) * across;
    const inkLong = ((turned ? fit.h : fit.w) / 100) * along;
    // the model's line height, checked against the ink: Hebrew letters stand about 0.78 of the font size tall
    const fromModel = ((t.lineHeight / 100) * across) / 1.25;
    const fromInk = inkThick / lines / 0.78;
    const size_mm = Math.abs(fromModel / fromInk - 1) <= 0.25 ? fromModel : fromInk;
    // the text box: a little longer than the ink so the line never wraps; the drawn block is `lines` lines of 1.25 × the size
    const w_mm = Math.max(5, inkLong * 1.08 + size_mm * 0.3);
    const block = lines * size_mm * 1.25;
    const inkX = (fit.x / 100) * page.width_mm;
    const inkY = (fit.y / 100) * page.height_mm;
    const inkW = (fit.w / 100) * page.width_mm;
    const inkH = (fit.h / 100) * page.height_mm;
    let x_mm: number;
    let y_mm: number;
    if (t.rotation === -90) {
      // reading up: the box turns about its first corner, which stands at the bottom, its lines stacking rightwards
      x_mm = inkX + inkW / 2 - block / 2;
      y_mm = inkY + inkH / 2 + w_mm / 2;
    } else if (t.rotation === 90) {
      // reading down: the first corner stands at the top, its lines stacking leftwards
      x_mm = inkX + inkW / 2 + block / 2;
      y_mm = inkY + inkH / 2 - w_mm / 2;
    } else {
      // anchored where its alignment holds it, centred on the ink
      x_mm = t.align === 'right' ? inkX + inkW - w_mm : t.align === 'left' ? inkX : inkX + inkW / 2 - w_mm / 2;
      y_mm = inkY + inkH / 2 - block / 2;
    }
    const color = (fit.color ?? t.color).toUpperCase();
    const group = groupOf(fit);
    return {
      id: newId(),
      type: 'text',
      x_mm: Math.max(0, x_mm),
      y_mm: Math.max(0, y_mm),
      w_mm: Math.min(w_mm, turned ? page.height_mm : page.width_mm),
      rotation: t.rotation,
      text: t.text,
      align: t.align,
      locks: FIELD_LOCKS,
      field: { label: label.slice(0, 60) },
      ...(group && { group }),
      // the line height is what was measured; a text's size is that over the 1.25 it is drawn at
      font: {
        family: fonts.includes(t.font) ? t.font : 'Heebo',
        weight: t.bold ? 700 : 400,
        size_pt: Math.min(400, Math.max(4, size_mm / PT_TO_MM)),
        color,
      },
      design_color: color,
    };
  });

  return [...objects, ...words];
}
