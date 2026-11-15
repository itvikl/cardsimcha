/**
 * Checks of card format v2: validation, migrateV1 and what applyEdits lets each actor change.
 *   npm run test:canvas
 */
import assert from 'node:assert/strict';
import { applyEdits, emptyDoc, FIELD_LOCKS, findElement, LOCKED, moveInLayer, moveTo, validateDoc } from '../src/lib/canvas';
import { migrateV1, toV2, type CanvasDocV1 } from '../src/lib/canvas-v1';
import { DIVIDERS, newDivider } from '../src/lib/elements';
import type { CanvasDoc, ImageElement, TextElement } from '../src/lib/types';

let n = 0;
function test(name: string, fn: () => void) {
  fn();
  n++;
  console.log('ok ', name);
}
const clone = <T,>(v: T): T => structuredClone(v);
const text = (d: CanvasDoc, id: string) => findElement(d, id)?.el as TextElement;

const assets = [
  { id: 'a-bg1', categoryId: 'c-bg' },
  { id: 'a-bg2', categoryId: 'c-bg' },
  { id: 'a-other', categoryId: 'c-other' },
];

// a v1 card like the imported wedding card: the signature was saved under the background
const v1: CanvasDocV1 = {
  schema_version: 1,
  page: { width_mm: 148, height_mm: 210, background: '#FAF8F3' },
  elements: [
    { id: 'sig', type: 'text', x_mm: 10, y_mm: 190, w_mm: 60, rotation: 0, z: 0, text: 'בברכה', align: 'center', font: { family: 'Heebo', weight: 400, size_pt: 12, color: '#000000' } },
    { id: 'bg', type: 'image', x_mm: 0, y_mm: 0, w_mm: 148, h_mm: 210, rotation: 0, z: 1, asset_id: 'a-bg1', swappable: true, swapCategoryId: 'c-bg', label: 'רקע' },
    { id: 'title', type: 'text', x_mm: 14, y_mm: 20, w_mm: 120, rotation: 0, z: 2, text: 'חתונה', align: 'center', font: { family: 'Heebo', weight: 700, size_pt: 30, color: '#1F3A2E' } },
    { id: 'groom', type: 'text', x_mm: 14, y_mm: 60, w_mm: 120, rotation: 0, z: 3, text: 'שם החתן', align: 'center', editable: true, label: 'שם החתן', font: { family: 'Heebo', weight: 700, size_pt: 20, color: '#1F3A2E' } },
    { id: 'box', type: 'rect', x_mm: 20, y_mm: 100, w_mm: 50, h_mm: 20, rotation: 0, z: 4, fill: '#E4ECE3' },
  ],
};

const doc = migrateV1(v1)!;

test('migrateV1: full-page image becomes the background, with its swap rules', () => {
  const bg = doc.layers.background;
  assert.equal(bg.fill.color, '#FAF8F3');
  assert.deepEqual(bg.image, { asset_id: 'a-bg1', fit: 'cover' });
  assert.equal(bg.locks.content, true);
  assert.equal(bg.swap_collection_id, 'c-bg');
  assert.equal(bg.field?.label, 'רקע');
});

test('migrateV1: the element saved under the background is now content above it', () => {
  assert.deepEqual(doc.layers.content.map((e) => e.id), ['sig', 'title', 'groom', 'box']);
  assert.equal(doc.layers.overlay.length, 0);
});

test('migrateV1: editable text → content/transform/style locks + field; others locked', () => {
  assert.deepEqual(text(doc, 'groom').locks, { content: true, transform: true, delete: false, style: true });
  assert.deepEqual(text(doc, 'groom').field, { label: 'שם החתן' });
  assert.deepEqual(text(doc, 'title').locks, LOCKED);
  assert.equal(text(doc, 'title').field, undefined);
});

test('migrateV1: rect → shape with a solid fill', () => {
  const box = findElement(doc, 'box')!.el;
  assert.equal(box.type, 'shape');
  assert.deepEqual(box.type === 'shape' && box.fill, { type: 'solid', color: '#E4ECE3' });
});

test('toV2: v2 passes through validation, junk is rejected', () => {
  assert.deepEqual(toV2(doc), doc);
  assert.equal(toV2({ schema_version: 3 }), null);
  assert.equal(toV2(null), null);
});

test('validateDoc: drops unknown properties, rejects duplicate ids and bad colours', () => {
  const d = clone(doc) as unknown as { layers: { content: Record<string, unknown>[] } };
  d.layers.content[0].evil = '<script>';
  assert.equal('evil' in validateDoc(d)!.layers.content[0], false);
  const dup = clone(doc);
  dup.layers.overlay.push(clone(dup.layers.content[0]));
  assert.equal(validateDoc(dup), null);
  const bad = clone(doc);
  bad.layers.background.fill.color = 'red';
  assert.equal(validateDoc(bad), null);
});

test('author: may change anything', () => {
  const inc = clone(doc);
  text(inc, 'title').text = 'מזל טוב';
  inc.layers.content.pop();
  const out = applyEdits(doc, inc, 'author')!;
  assert.equal(text(out, 'title').text, 'מזל טוב');
  assert.equal(findElement(out, 'box'), null);
});

test('customer: changes a field text, colour and position', () => {
  const inc = clone(doc);
  Object.assign(text(inc, 'groom'), { text: 'דן', x_mm: 30, y_mm: 70 });
  text(inc, 'groom').font.color = '#C9A24B';
  const out = applyEdits(doc, inc, 'customer', assets)!;
  const g = text(out, 'groom');
  assert.equal(g.text, 'דן');
  assert.equal(g.font.color, '#C9A24B');
  assert.deepEqual([g.x_mm, g.y_mm], [30, 70]);
});

test('customer: cannot change locked elements, size or font of a field', () => {
  const inc = clone(doc);
  text(inc, 'title').text = 'פריצה';
  text(inc, 'title').font.color = '#FF0000';
  text(inc, 'groom').font.size_pt = 200;
  text(inc, 'groom').font.family = 'Arial';
  const out = applyEdits(doc, inc, 'customer', assets)!;
  assert.equal(text(out, 'title').text, 'חתונה');
  assert.equal(text(out, 'title').font.color, '#1F3A2E');
  assert.equal(text(out, 'groom').font.size_pt, 20);
  assert.equal(text(out, 'groom').font.family, 'Heebo');
});

test('customer: cannot delete, add or reorder; can delete only what the lock allows', () => {
  const inc = clone(doc);
  inc.layers.content = inc.layers.content.filter((e) => e.id !== 'groom').reverse();
  inc.layers.overlay.push({ ...clone(text(doc, 'groom')), id: 'new' });
  const out = applyEdits(doc, inc, 'customer', assets)!;
  assert.deepEqual(out.layers.content.map((e) => e.id), ['sig', 'title', 'groom', 'box']);
  assert.equal(out.layers.overlay.length, 0);

  const deletable = clone(doc);
  text(deletable, 'groom').locks = { ...FIELD_LOCKS, delete: true };
  const gone = applyEdits(deletable, { layers: { ...deletable.layers, content: deletable.layers.content.filter((e) => e.id !== 'groom') } }, 'customer', assets)!;
  assert.equal(findElement(gone, 'groom'), null);
});

test('customer: position is kept inside the page; a locked field does not move', () => {
  const inc = clone(doc);
  Object.assign(text(inc, 'groom'), { x_mm: 9999, y_mm: -50 });
  Object.assign(text(inc, 'title'), { x_mm: 0, y_mm: 0 });
  const out = applyEdits(doc, inc, 'customer', assets)!;
  assert.deepEqual([text(out, 'groom').x_mm, text(out, 'groom').y_mm], [148 - 5, 0]);
  assert.deepEqual([text(out, 'title').x_mm, text(out, 'title').y_mm], [14, 20]);
});

test('customer: swaps the background only within its collection, or picks a plain colour', () => {
  const swap = (image: object) => applyEdits(doc, { layers: { ...clone(doc.layers), background: { ...doc.layers.background, image } } }, 'customer', assets)!;
  assert.equal(swap({ asset_id: 'a-bg2' }).layers.background.image?.asset_id, 'a-bg2');
  assert.equal(swap({ asset_id: 'a-other' }).layers.background.image?.asset_id, 'a-bg1');
  assert.equal(swap({ asset_id: 'a-bg1', colorOverride: '#2F5D46' }).layers.background.image?.colorOverride, '#2F5D46');
  // the fill is not theirs to change (style lock off)
  const fill = applyEdits(doc, { layers: { ...clone(doc.layers), background: { ...doc.layers.background, fill: { type: 'solid', color: '#000000' } } } }, 'customer', assets)!;
  assert.equal(fill.layers.background.fill.color, '#FAF8F3');
});

test('customer: a locked background cannot be swapped', () => {
  const locked = clone(doc);
  locked.layers.background.locks = LOCKED;
  const out = applyEdits(locked, { layers: { ...clone(locked.layers), background: { ...locked.layers.background, image: { asset_id: 'a-bg2' } } } }, 'customer', assets)!;
  assert.equal(out.layers.background.image?.asset_id, 'a-bg1');
});

test('customer: an image swap needs the content lock and the right collection', () => {
  const d = clone(doc);
  const photo: ImageElement = { id: 'photo', type: 'image', x_mm: 0, y_mm: 0, w_mm: 40, h_mm: 40, rotation: 0, asset_id: 'a-bg1', locks: { ...LOCKED, content: true }, swap_collection_id: 'c-bg' };
  d.layers.overlay.push(photo);
  const send = (asset_id: string) => applyEdits(d, { layers: { ...clone(d.layers), overlay: [{ ...photo, asset_id }] } }, 'customer', assets)!;
  assert.equal((findElement(send('a-bg2'), 'photo')!.el as ImageElement).asset_id, 'a-bg2');
  assert.equal((findElement(send('a-other'), 'photo')!.el as ImageElement).asset_id, 'a-bg1');
});

test('moveInLayer: reordering never leaves the layer', () => {
  const d = clone(doc);
  d.layers.overlay.push({ ...clone(text(doc, 'groom')), id: 'top' });
  const out = moveInLayer(d, 'top', 'back');
  assert.deepEqual(out.layers.overlay.map((e) => e.id), ['top']);
  assert.deepEqual(moveInLayer(d, 'box', 'back').layers.content.map((e) => e.id), ['box', 'sig', 'title', 'groom']);
});

test('moveTo: puts an element at a place in either layer, and nowhere else', () => {
  const d = clone(doc);
  const into = moveTo(d, 'title', 'overlay', 0);
  assert.deepEqual(into.layers.overlay.map((e) => e.id), ['title']);
  assert.ok(!into.layers.content.some((e) => e.id === 'title'));
  assert.deepEqual(moveTo(d, 'box', 'content', 0).layers.content.map((e) => e.id), ['box', 'sig', 'title', 'groom']);
  assert.deepEqual(moveTo(d, 'sig', 'content', 99).layers.content.map((e) => e.id), ['title', 'groom', 'box', 'sig']);
  assert.equal(moveTo(d, 'nope', 'content', 0), d);
});

test('emptyDoc is valid', () => {
  assert.ok(validateDoc(emptyDoc(148, 210)));
});

// ---- the editor-tool fields (editor port, step 2) ----

const toolDoc = (): CanvasDoc => {
  const d = clone(doc);
  const t = text(d, 'groom');
  Object.assign(t, {
    arc: 40, fit: 'shrink', shadow: true, stroke: { color: '#FFFFFF', width_mm: 0.3 }, foil: 'gold', design_color: '#1F3A2E',
    group: 'g1', part: 'header', field: { label: 'שם החתן', detail: true },
  });
  t.font = { ...t.font, line_height: 1.4, letter_spacing: 2 };
  const box = findElement(d, 'box')!.el;
  Object.assign(box, { fill: { type: 'linear', color: '#14342C', color2: '#2F5D46', angle: 90 }, corner_radius_mm: 4, opacity: 0.6, hidden: true, pinned: true });
  d.layers.overlay.push({ id: 'pic', type: 'image', x_mm: 10, y_mm: 10, w_mm: 30, h_mm: 30, rotation: 0, asset_id: 'a-bg1', locks: LOCKED, mask: 'circle', crop: { zoom: 1.5, x: 0.2, y: -0.4 } });
  d.layers.background.fill = { type: 'linear', color: '#FBF4E4', color2: '#EAD8B6', angle: 135 };
  d.guides = { x: [74], y: [10, 200] };
  return d;
};

test('validateDoc: keeps every editor-tool field as it is', () => {
  const d = toolDoc();
  assert.deepEqual(validateDoc(d), d);
});

test('validateDoc: a bad editor-tool value refuses the whole doc', () => {
  const bad: [string, (d: CanvasDoc) => void][] = [
    ['arc past 100', (d) => Object.assign(text(d, 'groom'), { arc: 140 })],
    ['unknown foil', (d) => Object.assign(text(d, 'groom'), { foil: 'bronze' })],
    ['stroke without colour', (d) => Object.assign(text(d, 'groom'), { stroke: { width_mm: 1 } })],
    ['unknown part', (d) => Object.assign(text(d, 'groom'), { part: 'middle' })],
    ['gradient without a second colour', (d) => Object.assign(findElement(d, 'box')!.el, { fill: { type: 'linear', color: '#000000', angle: 0 } })],
    ['opacity above 1', (d) => Object.assign(findElement(d, 'box')!.el, { opacity: 2 })],
    ['crop off the picture', (d) => Object.assign(findElement(d, 'pic')!.el, { crop: { zoom: 1, x: 3, y: 0 } })],
    ['unknown mask', (d) => Object.assign(findElement(d, 'pic')!.el, { mask: 'star' })],
    ['guide off the page', (d) => (d.guides = { x: [500], y: [] })],
  ];
  for (const [name, spoil] of bad) {
    const d = toolDoc();
    spoil(d);
    assert.equal(validateDoc(d), null, name);
  }
});

test('validateDoc: defaults are dropped (arc 0, opacity 1, false flags, empty guides)', () => {
  const d = toolDoc();
  Object.assign(text(d, 'groom'), { arc: 0, shadow: false });
  Object.assign(findElement(d, 'box')!.el, { opacity: 1, hidden: false });
  d.guides = { x: [], y: [] };
  const out = validateDoc(d)!;
  assert.equal(text(out, 'groom').arc, undefined);
  assert.equal(text(out, 'groom').shadow, undefined);
  assert.equal((findElement(out, 'box')!.el as { opacity?: number }).opacity, undefined);
  assert.equal(findElement(out, 'box')!.el.hidden, undefined);
  assert.equal(out.guides, undefined);
});

test('customer: cannot change the author-only fields, even on a field they may edit', () => {
  const d = toolDoc();
  const sent = clone(d);
  Object.assign(text(sent, 'groom'), { arc: -80, foil: 'silver', part: 'footer', group: 'mine', hidden: true, text: 'נועם' });
  sent.guides = { x: [1], y: [1] };
  const out = applyEdits(d, sent, 'customer', assets)!;
  const g = text(out, 'groom');
  assert.equal(g.text, 'נועם');
  assert.equal(g.arc, 40);
  assert.equal(g.foil, 'gold');
  assert.equal(g.part, 'header');
  assert.equal(g.group, 'g1');
  assert.equal(g.hidden, undefined);
  assert.deepEqual(out.guides, { x: [74], y: [10, 200] });
});

test('validateDoc: every divider kind is valid (their lines are thinner than 1 mm)', () => {
  for (const kind of DIVIDERS) {
    const d = emptyDoc(148, 210);
    d.layers.content.push(...newDivider(d, kind.id));
    assert.ok(validateDoc(d), kind.id);
  }
});

test('migrateV1: the business-ads tool fields map onto v2', () => {
  const src: CanvasDocV1 = {
    schema_version: 1,
    page: { width_mm: 148, height_mm: 210, background: '#FBF4E4', background2: '#EAD8B6', backgroundAngle: 135 },
    elements: [
      {
        id: 't', type: 'text', x_mm: 10, y_mm: 20, w_mm: 120, rotation: 0, z: 1, text: 'בשעה טובה', align: 'center', editable: true, label: 'שמות', detail: true,
        font: { family: 'Heebo', weight: 700, size_pt: 20, color: '#7A5A1E' },
        arc: 50, letterSpacing: 3, lineHeight: 1.3, fit: 'shrink', shadow: true, stroke: { color: '#FFFFFF', width_mm: 0.2 }, foil: 'gold', designColor: '#7A5A1E', group: 'g', locked: true,
      },
      { id: 'r', type: 'rect', x_mm: 20, y_mm: 100, w_mm: 50, h_mm: 20, rotation: 0, z: 2, fill: '#14342C', fill2: '#2F5D46', angle: 90, cornerRadius_mm: 3, opacity: 0.5, hidden: true },
      { id: 'p', type: 'image', x_mm: 30, y_mm: 140, w_mm: 30, h_mm: 30, rotation: 0, z: 3, asset_id: 'a-bg1', mask: 'arch', crop: { zoom: 2, x: 0, y: 0.5 } },
    ],
  };
  const out = migrateV1(src)!;
  assert.deepEqual(out.layers.background.fill, { type: 'linear', color: '#FBF4E4', color2: '#EAD8B6', angle: 135 });
  const t = text(out, 't');
  assert.deepEqual(t.font, { family: 'Heebo', weight: 700, size_pt: 20, color: '#7A5A1E', line_height: 1.3, letter_spacing: 3 });
  assert.deepEqual(t.field, { label: 'שמות', detail: true });
  assert.equal(t.arc, 50);
  assert.equal(t.fit, 'shrink');
  assert.equal(t.shadow, true);
  assert.equal(t.foil, 'gold');
  assert.equal(t.design_color, '#7A5A1E');
  assert.equal(t.group, 'g');
  assert.equal(t.pinned, true);
  const r = findElement(out, 'r')!.el as { fill: unknown; corner_radius_mm?: number; opacity?: number; hidden?: boolean };
  assert.deepEqual(r.fill, { type: 'linear', color: '#14342C', color2: '#2F5D46', angle: 90 });
  assert.equal(r.corner_radius_mm, 3);
  assert.equal(r.opacity, 0.5);
  assert.equal(r.hidden, true);
  const p = findElement(out, 'p')!.el as ImageElement;
  assert.equal(p.mask, 'arch');
  assert.deepEqual(p.crop, { zoom: 2, x: 0, y: 0.5 });
});

console.log(`\n${n} passed`);
