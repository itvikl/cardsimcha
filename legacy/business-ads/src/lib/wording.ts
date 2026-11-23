import type { CanvasDoc, CanvasElement, Project, TextElement } from './types';

/**
 * A wording is designed text kept apart from any background. A private card's texts are one wording, and a customer inside
 * the card can move to any other wording of its topic and page size: a wording an admin built, or the texts of another card.
 */

/** what the editor gets for each wording it can offer */
export type Wording = { id: string; name: string; elements: TextElement[] };

/** a text that came from a wording an admin built carries this at the start of its id */
const MARK = 'w_';

/** the texts a wording replaces: all of a card's texts but the site's credit and those a system or a business fills in */
export const isCardText = (e: CanvasElement): e is TextElement =>
  e.type === 'text' && !e.credit && !e.role && !e.shabbatRole && !e.own && !e.product;

/**
 * What a wording lays on a card: its texts, all open to the customer. Their ids are always the same, so an undo that goes
 * back to this wording can bring the customer's changes back with it. A card's own texts keep their ids (`mark` ''), so
 * taking its texts again is the card as it was. Anything else on the canvas only previews it.
 */
export const wordingTexts = (canvas: CanvasDoc, mark = MARK): TextElement[] =>
  canvas.elements.flatMap((e) =>
    isCardText(e) ? [{ ...e, id: mark + e.id, editable: true, label: e.label || 'טקסט', designColor: e.designColor ?? e.font.color }] : [],
  );

/** the texts of a wording row, or of a card taken as a wording */
export const textsOf = (w: Project): TextElement[] => wordingTexts(w.canvas, w.kind === 'wording' ? MARK : '');

/** The card with this wording's texts in place of its own. The customer's details stay, by field label. */
export function applyWording<D extends CanvasDoc>(doc: D, wording: Pick<Wording, 'id' | 'elements'>): D {
  const details = new Map(doc.elements.flatMap((e) => (e.type === 'text' && e.detail && e.label ? [[e.label, e.text] as const] : [])));
  const kept = doc.elements.filter((e) => !isCardText(e));
  return {
    ...doc,
    wordingId: wording.id,
    elements: [
      ...kept,
      ...wording.elements.map((e, i) => ({ ...e, z: kept.length + i, text: e.detail && e.label ? details.get(e.label) ?? e.text : e.text })),
    ],
  };
}

/** a template or wording that belongs with this card: the same topic and page size, and published (an admin may also try a draft) */
export function sameKind(w: Project | null, card: CanvasDoc, topic: string | null, isAdmin: boolean): w is Project {
  return (
    !!w &&
    (w.kind === 'wording' || w.kind === 'template') &&
    (w.status === 'published' || isAdmin) &&
    !!topic &&
    w.topic === topic &&
    w.canvas.page.width_mm === card.page.width_mm &&
    w.canvas.page.height_mm === card.page.height_mm
  );
}

/** whether this card may take the texts of `w`: a wording, or another card that isn't itself made of one */
export const fitsCard = (w: Project | null, card: CanvasDoc, topic: string | null, isAdmin: boolean): w is Project =>
  sameKind(w, card, topic, isAdmin) && (w.kind === 'wording' || !w.canvas.wordingId) && textsOf(w).length > 0;
