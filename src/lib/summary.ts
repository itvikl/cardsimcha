import type { Project } from './types';

export const summarize = (p: Project) => ({
  id: p.id,
  kind: p.kind,
  status: p.status,
  name: p.name,
  updatedAt: p.updatedAt,
  width_mm: p.canvas.page.width_mm,
  height_mm: p.canvas.page.height_mm,
  elements: p.canvas.elements.length,
  editableFields: p.canvas.elements.filter((e) => e.type === 'text' && e.editable).length,
  thumbnail: p.thumbnail ?? null,
});
