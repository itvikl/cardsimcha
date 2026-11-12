import type { CanvasDoc, CanvasElement, Project, TextElement } from './types';

/**
 * A wording is designed text kept apart from any background. A card's texts come from one wording, and a customer
 * inside the card can move to any other wording of the same topic and page size.
 */

/** what the editor gets for each wording it can offer */
export type Wording = { id: string; name: string; elements: TextElement[] };

/** a text that came from a wording carries this at the start of its id; a change of wording replaces only those */
const MARK = 'w_';

export const isWordingText = (e: CanvasElement): e is TextElement => e.type === 'text' && e.id.startsWith(MARK);

/**
 * What a wording lays on a card: its texts, all open to the customer. Its ids are always the same, so an undo that goes
 * back to this wording can bring the customer's changes back with it. Anything else on its canvas only previews it.
 */
export const wordingTexts = (canvas: CanvasDoc): TextElement[] =>
  canvas.elements.flatMap((e) =>
    e.type === 'text' && !e.credit ? [{ ...e, id: MARK + e.id, editable: true, label: e.label || 'טקסט', designColor: e.font.color }] : [],
  );

/** The card with this wording's texts. The customer's details stay, by field label; other texts of the card aren't touched. */
export function applyWording<D extends CanvasDoc>(doc: D, wording: Pick<Wording, 'id' | 'elements'>): D {
  const details = new Map(doc.elements.flatMap((e) => (e.type === 'text' && e.detail && e.label ? [[e.label, e.text] as const] : [])));
  const kept = doc.elements.filter((e) => !isWordingText(e));
  return {
    ...doc,
    wordingId: wording.id,
    elements: [
      ...kept,
      ...wording.elements.map((e, i) => ({ ...e, z: kept.length + i, text: e.detail && e.label ? details.get(e.label) ?? e.text : e.text })),
    ],
  };
}

/** whether this card may take this wording: the same topic and page size, and published (an admin may also try a draft) */
export function fitsCard(w: Project | null, card: CanvasDoc, topic: string | null, isAdmin: boolean): w is Project {
  return (
    !!w &&
    w.kind === 'wording' &&
    (w.status === 'published' || isAdmin) &&
    !!topic &&
    w.topic === topic &&
    w.canvas.page.width_mm === card.page.width_mm &&
    w.canvas.page.height_mm === card.page.height_mm
  );
}
