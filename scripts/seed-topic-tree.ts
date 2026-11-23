// Puts the topics from before the tree into it (npm run seed:tree). Safe to run again: a node
// that is already in place is left alone, and an existing topic is moved, not copied, so its
// templates come with it. The topics that become product labels (לוגו, זמני שבת, מבצע,
// מיתוג שמחה...) are left outside the tree on purpose and their designs get the label.
// Runs against the store DATA_DRIVER picks (Firestore by default).
import { newId } from '../src/lib/data/ids';
import { C, db, now } from '../src/lib/data/store';
import { allTopics, newTopic, type TopicDoc, type TopicLevel } from '../src/lib/data/topics';
import type { LabelDoc } from '../src/lib/data/tree';
import type { TemplateDoc } from '../src/lib/data/projects';

type Audience = 'private' | 'business';
/** a type, or [the topic's old name, its name in the tree] when it is renamed on the way */
type TypeSpec = string | [string, string];
type EventSpec = { name: string; types?: TypeSpec[] };
type CategorySpec = { name: string; audience: Audience; events: EventSpec[] };

const TREE: CategorySpec[] = [
  {
    name: 'שמחות',
    audience: 'private',
    events: [
      { name: 'הולדת בן', types: ['לידת בן', 'שלום זכר', ['וואך נאכט', 'קריאת שמע (וואך נאכט)'], 'ברית', 'פדיון הבן'] },
      { name: 'הולדת בת', types: ['לידת בת', 'קידוש'] },
      { name: 'חתונה', types: ['אירוסין', 'חתונה'] },
      { name: 'בר מצווה', types: ['בר מצווה'] },
      { name: 'ילדים', types: ['חלאקה'] },
      { name: 'הבית', types: ['חנוכת הבית'] },
    ],
  },
  { name: 'ברכות ואיחולים', audience: 'private', events: [{ name: 'ברכות' }, { name: 'איחולים' }, { name: 'תעודות' }] },
  { name: 'קהילה ומועדים', audience: 'private', events: [{ name: 'בית כנסת' }, { name: 'שמחת בית השואבה' }] },
  { name: 'עסקים', audience: 'business', events: [{ name: 'ייעוץ משכנתאות' }, { name: 'מיזוג אוויר' }, { name: 'ייעוץ עסקי' }] },
];

// ---- "what it is" labels, and the topics from before the tree that were really labels ----

const LABELS: Record<Audience, string[]> = {
  private: ['הזמנה', 'מיתוג אירוע'],
  business: ['מודעת מבצע', 'פתיחת עסק', 'פוסט לרשתות', 'זמני שבת', 'לוגו', 'מודעה חופשית', 'כרטיס ביקור', 'תפריט'],
};

/** old topic → its label, and the category its designs are filed on (so they show in every place under it) */
const AS_LABEL: Record<string, { label: string; place: string }> = {
  'מודעות מבצע': { label: 'מודעת מבצע', place: 'עסקים' },
  'פתיחת עסק': { label: 'פתיחת עסק', place: 'עסקים' },
  'פוסטים לרשתות': { label: 'פוסט לרשתות', place: 'עסקים' },
  'זמני שבת': { label: 'זמני שבת', place: 'עסקים' },
  לוגו: { label: 'לוגו', place: 'עסקים' },
  'מודעה חופשית': { label: 'מודעה חופשית', place: 'עסקים' },
  'כרטיסי ביקור': { label: 'כרטיס ביקור', place: 'עסקים' },
  תפריטים: { label: 'תפריט', place: 'עסקים' },
  'מיתוג שמחה': { label: 'מיתוג אירוע', place: 'שמחות' },
};

const log: string[] = [];
const topics = await allTopics();
const loose = (t: TopicDoc) => t.parentId === null && t.level !== 'category';

async function save(t: TopicDoc) {
  await db.set(C.topics, t.id, { ...t, updatedAt: now() });
}

/**
 * The node `name` under `parentId` at `position`: already there, or a topic from before the
 * tree (at the root, not yet a category) moved in, or a new one.
 */
async function place(name: string, oldName: string, parentId: string | null, level: TopicLevel, audience: Audience, position: number, adopt = true) {
  const here = topics.find((t) => t.parentId === parentId && t.name === name && (parentId !== null || t.level === 'category'));
  if (here) {
    if (here.position !== position || here.level !== level || here.audience !== audience) {
      Object.assign(here, { position, level, audience });
      await save(here);
    }
    return here.id;
  }
  const found = adopt ? topics.find((t) => loose(t) && t.name === oldName) : undefined;
  if (found) {
    Object.assign(found, { name, parentId, level, audience, position });
    await save(found);
    log.push(`moved   ${oldName}${oldName !== name ? ` → ${name}` : ''} (${level})`);
    return found.id;
  }
  const made = newTopic({ name, parentId, level, audience, position, sortOrder: -1 });
  topics.push(made);
  await save(made);
  log.push(`created ${name} (${level})`);
  return made.id;
}

for (const [ci, cat] of TREE.entries()) {
  const catId = await place(cat.name, cat.name, null, 'category', cat.audience, ci);
  for (const [ei, ev] of cat.events.entries()) {
    // an event with a type of its own name (חתונה → חתונה) leaves the old topic to that type, where its designs belong
    const ownType = (ev.types ?? []).some((t) => (typeof t === 'string' ? t : t[0]) === ev.name);
    const evId = await place(ev.name, ev.name, catId, 'event', cat.audience, ei, !ownType);
    for (const [ti, t] of (ev.types ?? []).entries()) {
      const [oldName, name] = typeof t === 'string' ? [t, t] : t;
      await place(name, oldName, evId, 'type', cat.audience, ti);
    }
  }
}

const labels = await db.find<LabelDoc>(C.labels);
for (const audience of ['private', 'business'] as const) {
  for (const [position, name] of LABELS[audience].entries()) {
    if (labels.some((l) => l.audience === audience && l.name === name)) continue;
    const l: LabelDoc = { id: newId(), name, audience, position, createdAt: now() };
    labels.push(l);
    await db.set(C.labels, l.id, l);
    log.push(`label   ${name} (${audience})`);
  }
}

// a design keeps its old topic for the pages from before the tree; it gains the label and a place
const templates = await db.pick<Pick<TemplateDoc, 'id' | 'topicId' | 'labelId' | 'places'>>(C.templates, ['topicId', 'labelId', 'places']);
const looseIds = new Set(topics.filter(loose).map((t) => t.id));
for (const [topicName, { label, place: placeName }] of Object.entries(AS_LABEL)) {
  const topic = topics.find((t) => loose(t) && t.name === topicName);
  if (!topic) continue;
  const cat = topics.find((t) => t.parentId === null && t.level === 'category' && t.name === placeName);
  const lab = labels.find((l) => l.name === label && l.audience === topic.audience);
  if (!cat || !lab) continue;
  let n = 0;
  for (const d of templates.filter((x) => x.topicId === topic.id)) {
    // the old topic is not a place in the tree: a design filed only there moves to the category
    const places = (d.places ?? []).filter((p) => p !== topic.id);
    if (d.labelId && places.length) continue;
    d.labelId ??= lab.id;
    d.places = places.length ? places : [cat.id];
    await db.update(C.templates, d.id, { labelId: d.labelId, places: d.places });
    n++;
  }
  if (n) log.push(`labeled ${n} × ${topicName} → ${label}, filed on ${placeName}`);
}

// no design stays "filed" on a topic outside the tree
let removed = 0;
for (const d of templates) {
  const places = (d.places ?? []).filter((p) => !looseIds.has(p));
  if (places.length === (d.places ?? []).length) continue;
  removed += (d.places ?? []).length - places.length;
  await db.update(C.templates, d.id, { places });
}
if (removed) log.push(`removed ${removed} places on old topics outside the tree`);

const left = topics.filter(loose).map((t) => t.name);
console.log(log.length ? log.join('\n') : 'the tree was already in place');
console.log(`\nold topics still outside the tree (read only by the pages from before it): ${left.join(', ') || 'none'}`);
