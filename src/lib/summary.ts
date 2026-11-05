import { allElements, customerFields } from './canvas';
import type { Project } from './types';

export const summarize = (p: Project) => ({
  id: p.id,
  kind: p.kind,
  status: p.status,
  name: p.name,
  topic: p.topic ?? null,
  updatedAt: p.updatedAt,
  width_mm: p.canvas.page.width_mm,
  height_mm: p.canvas.page.height_mm,
  elements: allElements(p.canvas).length,
  editableFields: customerFields(p.canvas).filter((e) => e.type === 'text').length,
  thumbnail: p.thumbnail ?? null,
});
