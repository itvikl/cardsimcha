/**
 * Checks of the data layer (src/lib/data/) on the local store, in a fresh temporary folder:
 * accounts, the image library, templates and designs, the occasion tree and labels, fonts,
 * text styles and thumbnails.
 *   npm run test:data
 * The Firestore driver runs the same repositories; to check it against the emulator, run this
 * with DATA_DRIVER=firestore FIRESTORE_EMULATOR_HOST=localhost:8080 FILES_DRIVER=local.
 */
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.DATA_DRIVER ??= 'local';
process.env.FILES_DRIVER ??= 'local';
process.env.FIRESTORE_PREFIX ??= `test_${Date.now()}_`;
// the local drivers keep their files under the working folder: a fresh one for every run
process.chdir(await mkdtemp(path.join(tmpdir(), 'cardsimcha-data-')));
delete process.env.ADMIN_EMAIL;

const { emptyDoc } = await import('../src/lib/canvas');
const users = await import('../src/lib/data/users');
const lib = await import('../src/lib/data/library');
const projects = await import('../src/lib/data/projects');
const tree = await import('../src/lib/data/tree');
const topics = await import('../src/lib/data/topics');
const fonts = await import('../src/lib/data/fonts');
const styles = await import('../src/lib/data/textStyles');

let n = 0;
async function test(name: string, fn: () => Promise<void>) {
  await fn();
  n++;
  console.log('ok ', name);
}
const ok = <T,>(r: T): Exclude<T, { error: string }> => {
  if (r && typeof r === 'object' && 'error' in r) assert.fail(`unexpected error: ${(r as { error: string }).error}`);
  return r as Exclude<T, { error: string }>;
};

const cred = { passwordHash: 'h', salt: 's' };
const admin = (await users.createUser({ email: 'admin@example.com', name: 'Admin', ...cred }))!;
const customer = (await users.createUser({ email: 'c@example.com', name: 'Customer', ...cred }))!;

await test('the first account is the admin, the next is not; an email is taken once', async () => {
  assert.equal(admin.role, 'admin');
  assert.equal(customer.role, 'user');
  assert.equal(await users.createUser({ email: 'c@example.com', name: 'again', ...cred }), null);
  assert.equal((await users.findUserByEmail('c@example.com'))?.id, customer.id);
});

await test('sessions find their user until they expire', async () => {
  await users.createSession('tok', customer.id, new Date(Date.now() + 60_000));
  assert.equal((await users.userBySession('tok'))?.id, customer.id);
  await users.createSession('old', customer.id, new Date(Date.now() - 1000));
  assert.equal(await users.userBySession('old'), null);
  await users.deleteSession('tok');
  assert.equal(await users.userBySession('tok'), null);
});

await test('a guest gets a user and a workspace on the first save', async () => {
  const guest = { id: 'guest-1', email: '', name: 'אורח', role: 'user' as const, passwordHash: '', salt: '', createdAt: '' };
  const w = await users.ensurePersonalWorkspace(guest);
  assert.equal(w, users.personalWorkspaceId('guest-1'));
  assert.equal(await users.ensurePersonalWorkspace(guest), w);
});

let catId = '';
await test('image library: categories are unique by name, images belong to one', async () => {
  const cat = (await lib.createCategory('רקעים', ''))!;
  catId = cat.id;
  assert.equal(await lib.createCategory('רקעים', ''), null);
  assert.equal((await lib.updateCategory(cat.id, { description: 'לכל השמחות' }) as { description: string }).description, 'לכל השמחות');
  await lib.createCategory('אחר', '');
  assert.equal(await lib.updateCategory(cat.id, { name: 'אחר' }), 'duplicate');
  const img = await lib.addImage({ id: 'img-1', categoryId: cat.id, name: 'bg', file: 'img-1.png', width: 10, height: 20, metadata: { importReading: [[1, 2]] } });
  assert.equal(img?.file, 'img-1.png');
  assert.equal(await lib.addImage({ id: 'img-x', categoryId: 'nope', name: '', file: 'img-x.png', width: 1, height: 1 }), null);
  assert.equal((await lib.listImages()).length, 1);
  assert.equal(await lib.fileKeyOfImage('img-1.png'), 'assets/platform/img-1.png');
  assert.equal(await lib.fileKeyOfImage('img-1.jpg'), null);
  assert.equal((await lib.renameImage('img-1', 'רקע'))?.name, 'רקע');
});

let cat = '', event = '', type = '';
await test('tree: a category, an event and a type; names are unique among siblings', async () => {
  cat = ok(await tree.createNode({ name: 'שמחות', parentId: null, audience: 'private' })).id;
  event = ok(await tree.createNode({ name: 'הולדת בן', parentId: cat })).id;
  type = ok(await tree.createNode({ name: 'ברית', parentId: event })).id;
  const t = await tree.getTree();
  const levelOf = Object.fromEntries(t.nodes.map((x) => [x.name, [x.level, x.parentId]]));
  assert.deepEqual(levelOf, { שמחות: ['category', null], 'הולדת בן': ['event', cat], ברית: ['type', event] });
  assert.equal((await tree.createNode({ name: 'ברית', parentId: event }) as { status: number }).status, 409);
  assert.equal((await tree.createNode({ name: 'x', parentId: type }) as { error: string }).error, 'אין רמה מתחת לסוג');
  ok(await tree.renameNode(type, 'ברית מילה'));
  assert.equal((await tree.moveNode(event, type) as { error: string }).error, 'אי אפשר להעביר פריט לתוך עצמו');
});

await test('tree: moving a node reorders its siblings', async () => {
  const second = ok(await tree.createNode({ name: 'הולדת בת', parentId: cat })).id;
  ok(await tree.moveNode(second, cat, 0));
  const kids = (await tree.getTree()).nodes.filter((x) => x.parentId === cat).sort((a, b) => a.position - b.position);
  assert.deepEqual(kids.map((k) => k.name), ['הולדת בת', 'הולדת בן']);
  assert.equal((await tree.deleteNode(cat) as { error: string }).error.includes('יש עוד פריטים'), true);
  ok(await tree.deleteNode(second));
});

let tplId = '';
await test('templates: created on a topic, filed on places, with a label', async () => {
  const r = await projects.createTemplate({ name: 'הזמנה', topic: 'ברית מילה', canvas: emptyDoc(), audience: 'private' });
  assert.ok('id' in r);
  tplId = r.id;
  let p = (await projects.getProject(tplId))!;
  assert.equal(p.kind, 'template');
  assert.deepEqual(p.places, [type]);
  assert.equal((await tree.getTree()).unfiled.length, 0);
  ok(await tree.createLabel('הזמנה', 'private'));
  assert.equal((await tree.createLabel('הזמנה', 'private') as { status: number }).status, 409);
  const label = (await tree.listLabels())[0];
  ok(await tree.setTemplatesPlaces([tplId], [event, type], label.id, 'private'));
  p = (await projects.getProject(tplId))!;
  assert.deepEqual(p.places, [event, type]);
  assert.equal(p.labelId, label.id);
  assert.equal((await tree.listLabels())[0].templates, 1);
  const filedOnPlaces = await projects.createTemplate({ name: 'שני', topic: '', canvas: emptyDoc(), places: [type], audience: 'business' });
  assert.ok('conflict' in filedOnPlaces, 'a place behind the other door is refused');
});

await test('backgrounds filed above a template\'s place are offered to it', async () => {
  ok(await tree.setAssetPlaces('img-1', [cat]));
  assert.deepEqual(await tree.backgroundsFor(tplId), ['img-1']);
  assert.deepEqual(await tree.assetPlaces(), { 'img-1': [cat] });
  assert.equal((await tree.deleteNode(cat) as { error: string }).error.length > 0, true);
});

let designId = '';
await test('a customer copies a published template only; edits and saves their own', async () => {
  assert.equal(await projects.createDesignFromTemplate(customer, tplId, () => {}), null);
  const r = await projects.updateProject(admin, tplId, { status: 'published', thumbnail: { data: Buffer.from('png'), ext: 'png' } });
  assert.ok(typeof r === 'object' && 'updatedAt' in r);
  assert.equal((await projects.listPublishedTemplates()).length, 1);
  assert.ok((await projects.templateThumbnail(tplId))?.startsWith(`/api/thumbnails/${tplId}?v=`));
  designId = (await projects.createDesignFromTemplate(customer, tplId, (c) => { c.page.width_mm = 100; }))!;
  const d = (await projects.getProject(designId))!;
  assert.equal(d.ownerId, customer.id);
  assert.equal(d.canvas.page.width_mm, 100);
  assert.equal((await projects.readThumbnail(customer, designId))?.data.toString(), 'png', 'the copy starts with the template\'s picture');
  assert.equal(await projects.updateProject(admin, designId, { name: 'x' }), 'missing', 'an admin does not write a customer\'s design');
  assert.equal(await projects.updateProject(customer, designId, { canvas: () => null }), 'invalid');
  const saved = await projects.updateProject(customer, designId, { name: 'שלי' });
  assert.ok(typeof saved === 'object' && 'updatedAt' in saved);
  assert.deepEqual((await projects.listProjectsFor(customer)).map((p) => p.name), ['שלי']);
  assert.equal((await projects.listProjectsFor(admin)).length, 1);
});

await test('changing the single topic swaps one place and keeps the others', async () => {
  ok(await tree.setTemplatesPlaces([tplId], [event, cat]));
  const r = await projects.updateProject(admin, tplId, { topic: 'ברית מילה', audience: 'private' });
  assert.ok(typeof r === 'object' && 'updatedAt' in r);
  const p = (await projects.getProject(tplId))!;
  assert.equal(p.topic, 'ברית מילה');
  assert.deepEqual(p.places, [cat, type]);
});

await test('carousel slides keep their order and topics not sent go after them', async () => {
  const slides = await topics.replaceSlides([
    { name: 'חתונה', image: null, hidden: false },
    { name: 'הולדת בן', image: '/x.png', hidden: true },
  ]);
  assert.deepEqual(slides.map((s) => s.name), ['חתונה', 'הולדת בן']);
  assert.equal(slides[1].hidden, true);
});

await test('fonts: one weight and style per family, whatever its spelling; usage is counted', async () => {
  const f = await fonts.addFont({ id: 'f1', family: 'Guttman Frank', weight: 400, style: 'normal', fileKey: 'fonts/platform/f1.woff2', unicodeRanges: 'U+0590-05FF' });
  assert.equal(f?.hebrew, true);
  assert.equal(await fonts.addFont({ id: 'f2', family: 'guttman frank', weight: 400, style: 'normal', fileKey: 'fonts/platform/f2.woff2', unicodeRanges: '' }), null);
  const bold = await fonts.addFont({ id: 'f3', family: 'guttman frank', weight: 700, style: 'normal', fileKey: 'fonts/platform/f3.woff2', unicodeRanges: '' });
  assert.equal(bold?.family, 'Guttman Frank');
  assert.deepEqual(await fonts.fontUsage(['Guttman Frank']), { 'Guttman Frank': { templates: 0, designs: 0 } });
  assert.equal((await fonts.fontFile('f1'))?.format, 'woff2');
  assert.equal(await fonts.deleteFont('f3'), 'fonts/platform/f3.woff2');
  assert.equal((await fonts.listFonts()).length, 1);
});

await test('text styles are saved and deleted', async () => {
  const look = styles && { align: 'center', font: { family: 'Heebo', weight: 700, size_pt: 24, color: '#112233' } };
  const s = (await styles.addTextStyle({ name: 'כותרת', look: look as never, createdById: admin.id }))!;
  assert.ok(s, 'the look validates');
  assert.equal((await styles.listTextStyles())[0].look.font.color, '#112233');
  assert.equal(await styles.deleteTextStyle(s.id), true);
  assert.equal((await styles.listTextStyles()).length, 0);
});

await test('deleting: a label leaves its templates, a design takes its thumbnail, a category its images', async () => {
  const label = (await tree.listLabels())[0];
  ok(await tree.deleteLabel(label.id));
  assert.equal((await projects.getProject(tplId))?.labelId, undefined);
  assert.equal(await projects.deleteProject(admin, designId), false);
  assert.equal(await projects.deleteProject(customer, designId), true);
  assert.equal(await projects.getProject(designId), null);
  assert.deepEqual(await lib.deleteCategory(catId), ['assets/platform/img-1.png']);
  assert.equal(await lib.getImage('img-1'), null);
});

console.log(`\n${n} checks passed`);
