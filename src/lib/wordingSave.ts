import { getRow } from './db';
import { projectContext } from './projectContext';
import { applyWording, fitsCard, wordingTexts } from './wording';
import type { CanvasDoc, Project, User } from './types';

/**
 * The saved design, moved to the wording the client sent when it may take that one. Its texts always come from the stored
 * wording, never from the client; applyCustomerEdits then lays the customer's own changes over them.
 */
export async function withSentWording(p: Project, incoming: unknown, user: User): Promise<CanvasDoc> {
  const sent = (incoming as CanvasDoc | null)?.wordingId;
  if (typeof sent !== 'string' || !p.canvas.wordingId || sent === p.canvas.wordingId) return p.canvas;
  const [w, { topic }] = await Promise.all([getRow('projects', sent), projectContext(p)]);
  if (!fitsCard(w, p.canvas, topic, user.role === 'admin')) return p.canvas;
  return applyWording(p.canvas, { id: w.id, elements: wordingTexts(w.canvas) });
}
