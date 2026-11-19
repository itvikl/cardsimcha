// Puts the topics from before the tree into it (npm run seed:tree). Safe to run again: a node
// that is already in place is left alone, and an existing topic is moved, not copied, so its
// templates come with it. The topics that become product labels (לוגו, זמני שבת, מבצע,
// מיתוג שמחה...) are left outside the tree on purpose; the next stage turns them into labels.
import type { TopicLevel } from '../src/generated/prisma/client';
import { prisma } from '../src/lib/data/prisma';

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

const log: string[] = [];

/**
 * The node `name` under `parentId` at `position`: already there, or a topic from before the
 * tree (at the root, not yet a category) moved in, or a new one.
 */
async function place(name: string, oldName: string, parentId: string | null, level: TopicLevel, audience: Audience, position: number, adopt = true) {
  const here = await prisma.topic.findFirst({ where: { parentId, name, ...(parentId === null && { level: 'category' }) } });
  if (here) {
    if (here.position !== position || here.level !== level || here.audience !== audience) {
      await prisma.topic.update({ where: { id: here.id }, data: { position, level, audience } });
    }
    return here.id;
  }
  const loose = adopt ? await prisma.topic.findFirst({ where: { parentId: null, name: oldName, level: { not: 'category' } } }) : null;
  if (loose) {
    await prisma.topic.update({ where: { id: loose.id }, data: { name, parentId, level, audience, position } });
    log.push(`moved   ${oldName}${oldName !== name ? ` → ${name}` : ''} (${level})`);
    return loose.id;
  }
  const made = await prisma.topic.create({ data: { name, parentId, level, audience, position, sortOrder: -1 } });
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

for (const audience of ['private', 'business'] as const) {
  for (const [position, name] of LABELS[audience].entries()) {
    const found = await prisma.productLabel.findUnique({ where: { audience_name: { audience, name } } });
    if (!found) {
      await prisma.productLabel.create({ data: { name, audience, position } });
      log.push(`label   ${name} (${audience})`);
    }
  }
}

// a design keeps its old topic for the pages from before the tree; it gains the label and a place
for (const [topicName, { label, place }] of Object.entries(AS_LABEL)) {
  const topic = await prisma.topic.findFirst({ where: { name: topicName, parentId: null, level: { not: 'category' } } });
  if (!topic) continue;
  const cat = await prisma.topic.findFirst({ where: { name: place, parentId: null, level: 'category' } });
  const lab = await prisma.productLabel.findFirst({ where: { name: label, audience: topic.audience } });
  if (!cat || !lab) continue;
  const designs = await prisma.template.findMany({ where: { topicId: topic.id }, select: { id: true, labelId: true } });
  let n = 0;
  for (const d of designs) {
    // the old topic is not a place in the tree: a design filed only there moves to the category
    await prisma.templatePlace.deleteMany({ where: { templateId: d.id, topicId: topic.id } });
    const placed = await prisma.templatePlace.count({ where: { templateId: d.id } });
    if (d.labelId && placed) continue;
    await prisma.template.update({
      where: { id: d.id },
      data: { labelId: d.labelId ?? lab.id, ...(!placed && { places: { create: { topicId: cat.id } } }) },
    });
    n++;
  }
  if (n) log.push(`labeled ${n} × ${topicName} → ${label}, filed on ${place}`);
}

// no design stays "filed" on a topic outside the tree (the backfill copied every old topic)
const loosePlaces = await prisma.templatePlace.deleteMany({ where: { topic: { parentId: null, level: { not: 'category' } } } });
if (loosePlaces.count) log.push(`removed ${loosePlaces.count} places on old topics outside the tree`);

const left = await prisma.topic.findMany({ where: { parentId: null, level: { not: 'category' } }, select: { name: true } });
console.log(log.length ? log.join('\n') : 'the tree was already in place');
console.log(`\nold topics still outside the tree (read only by the pages from before it): ${left.map((t) => t.name).join(', ') || 'none'}`);
await prisma.$disconnect();
