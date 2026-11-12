import { audienceOf, type Audience } from './categories';
import { getRow } from './db';
import type { Project } from './types';

/** Which category and door a project belongs to: a template's or wording's own, or the one of the template a design was copied from. */
export async function projectContext(p: Project): Promise<{ topic: string | null; audience: Audience }> {
  const source = p.kind !== 'design' ? p : p.templateId ? await getRow('projects', p.templateId) : null;
  const topic = source?.topic ?? null;
  if (!topic) return { topic, audience: 'private' };
  // the admin can move a category between doors on the carousel page; see the slide id in /api/carousel
  const slide = await getRow('carousel', 's_' + encodeURIComponent(topic));
  return { topic, audience: slide?.audience ?? audienceOf(topic) };
}
