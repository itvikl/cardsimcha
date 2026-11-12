/**
 * Checks of card format v2: validation, migrateV1 and what applyEdits lets each actor change.
 *   npm run test:canvas
 */
import assert from 'node:assert/strict';
import { applyEdits, emptyDoc, FIELD_LOCKS, findElement, LOCKED, moveInLayer, validateDoc } from '../src/lib/canvas';
import { migrateV1, toV2, type CanvasDocV1 } from '../src/lib/canvas-v1';
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

test('emptyDoc is valid', () => {
  assert.ok(validateDoc(emptyDoc(148, 210)));
});

console.log(`\n${n} passed`);
