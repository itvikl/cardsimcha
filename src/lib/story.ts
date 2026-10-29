import { GENERAL_TOPIC } from './categories';
import { hebrewDate } from './hebrewDate';
import type { CanvasDoc } from './types';

/**
 * The "story" of each simcha: the atmosphere the site takes on for it, the blessing it greets with,
 * and the few questions whose answers are written onto the card, then into every design of the category.
 *
 * Designs do not yet say which field is which (an admin labels fields freely: "שם החתן", "שמות החתן והכלה",
 * "אולם"...), so answers reach a design by matching those labels (FILL_RULES). The lasting fix is to tag
 * each field with a role when building the template.
 */

/** the light the whole site takes on for a simcha (see .site-backdrop in globals.css) */
export type Mood = 'candle' | 'dawn' | 'gold' | 'evening';

export type Answers = Partial<Record<AnswerKey, string>>;
export type AnswerKey = 'groom' | 'bride' | 'groomParents' | 'brideParents' | 'family' | 'parents' | 'honoree' | 'date' | 'time' | 'venue';

export type Question = {
  key: AnswerKey;
  ask: string;
  kind?: 'text' | 'date' | 'time';
  placeholder?: string;
  optional?: boolean;
};

/** one line of the card being written; `from` is the answer it shows, so that line comes alive while typing */
export type CardLine = { text: string; size: 'eyebrow' | 'title' | 'line' | 'small'; from?: AnswerKey };

export type Story = {
  mood: Mood;
  /** the first words on the page once the simcha is chosen */
  blessing: string;
  questions: Question[];
  /** the card being written, from what has been answered so far */
  card: (a: Answers) => CardLine[];
};

const DATE: Question = { key: 'date', ask: 'מתי השמחה?', kind: 'date' };
const TIME: Question = { key: 'time', ask: 'ובאיזו שעה?', kind: 'time', optional: true };
const VENUE: Question = { key: 'venue', ask: 'איפה חוגגים?', placeholder: 'למשל: אולמי הגן, ירושלים' };

/** the date and time lines every card ends with */
function when(a: Answers): CardLine[] {
  const h = a.date ? hebrewDate(a.date) : null;
  return [
    { text: h ? `${h.weekday}, ${h.full}` : '', size: 'line', from: 'date' },
    { text: a.time ? `בשעה ${a.time}` : '', size: 'small', from: 'time' },
    { text: a.venue ?? '', size: 'line', from: 'venue' },
  ];
}

const couple = (title: string): Story['card'] => (a) => [
  { text: title, size: 'eyebrow' },
  { text: [a.groom, a.bride].filter(Boolean).join(' ו'), size: 'title', from: a.bride ? 'bride' : 'groom' },
  { text: a.groomParents ? `הורי החתן: ${a.groomParents}` : '', size: 'small', from: 'groomParents' },
  { text: a.brideParents ? `הורי הכלה: ${a.brideParents}` : '', size: 'small', from: 'brideParents' },
  ...when(a),
];

const named = (title: string, key: AnswerKey, prefix = ''): Story['card'] => (a) => [
  { text: title, size: 'eyebrow' },
  { text: a[key] ? `${prefix}${a[key]}` : '', size: 'title', from: key },
  ...when(a),
];

const STORIES: Record<string, Story> = {
  'חתונה': {
    mood: 'candle',
    blessing: 'מזל טוב! בשעה טובה ומוצלחת',
    questions: [
      { key: 'groom', ask: 'איך קוראים לחתן?', placeholder: 'שם החתן' },
      { key: 'bride', ask: 'ואיך קוראים לכלה?', placeholder: 'שם הכלה' },
      DATE,
      VENUE,
      TIME,
      { key: 'groomParents', ask: 'מי הם הורי החתן?', placeholder: 'למשל: אהרן ורבקה כהן', optional: true },
      { key: 'brideParents', ask: 'ומי הם הורי הכלה?', placeholder: 'למשל: מאיר ושרה לוי', optional: true },
    ],
    card: couple('בשעה טובה ומוצלחת'),
  },
  'אירוסין': {
    mood: 'candle',
    blessing: 'מזל טוב! שיהיה בשעה טובה',
    questions: [
      { key: 'groom', ask: 'איך קוראים לחתן?', placeholder: 'שם החתן' },
      { key: 'bride', ask: 'ואיך קוראים לכלה?', placeholder: 'שם הכלה' },
      DATE,
      VENUE,
      TIME,
    ],
    card: couple('לרגל אירוסיהם'),
  },
  'שלום זכר': {
    mood: 'evening',
    blessing: 'מזל טוב! שתזכו לגדלו לתורה, לחופה ולמעשים טובים',
    questions: [
      { key: 'family', ask: 'מה שם המשפחה?', placeholder: 'למשל: כהן' },
      { ...DATE, ask: 'באיזה ליל שבת?' },
      { ...VENUE, ask: 'איפה מתכנסים?', placeholder: 'למשל: בבית המשפחה, רחוב הנביאים 12' },
      TIME,
    ],
    card: named('שלום זכר', 'family', 'משפחת '),
  },
  'ברית': {
    mood: 'dawn',
    blessing: 'מזל טוב! שתזכו לגדלו לתורה, לחופה ולמעשים טובים',
    questions: [
      { key: 'parents', ask: 'מי ההורים המאושרים?', placeholder: 'למשל: יוסף ומרים כהן' },
      DATE,
      { ...VENUE, ask: 'באיזה בית כנסת או אולם?' },
      TIME,
    ],
    card: named('לברית המילה של בננו', 'parents'),
  },
  'וואך נאכט': {
    mood: 'evening',
    blessing: 'מזל טוב! ליל שמירה של שמחה',
    questions: [
      { key: 'family', ask: 'מה שם המשפחה?', placeholder: 'למשל: כהן' },
      DATE,
      { ...VENUE, ask: 'איפה מתכנסים?', placeholder: 'למשל: בבית המשפחה' },
      TIME,
    ],
    card: named('וואך נאכט', 'family', 'משפחת '),
  },
  'פדיון הבן': {
    mood: 'dawn',
    blessing: 'מזל טוב! שתזכו לרוב נחת',
    questions: [{ key: 'parents', ask: 'מי ההורים המאושרים?', placeholder: 'למשל: יוסף ומרים כהן' }, DATE, VENUE, TIME],
    card: named('לשמחת פדיון הבן', 'parents'),
  },
  'חלאקה': {
    mood: 'gold',
    blessing: 'מזל טוב! שיזכה לגדול בתורה וביראת שמיים',
    questions: [{ key: 'honoree', ask: 'איך קוראים לבן?', placeholder: 'שם הילד' }, DATE, VENUE, TIME],
    card: named('לתספורת הראשונה של בננו', 'honoree'),
  },
  'בר מצווה': {
    mood: 'gold',
    blessing: 'מזל טוב! שתרוו ממנו רוב נחת',
    questions: [{ key: 'honoree', ask: 'איך קוראים לחתן בר המצווה?', placeholder: 'שם החוגג' }, DATE, VENUE, TIME],
    card: named('בר מצווה', 'honoree'),
  },
  'חנוכת הבית': {
    mood: 'evening',
    blessing: 'מזל טוב! שיהיה בית מלא ברכה',
    questions: [
      { key: 'family', ask: 'מה שם המשפחה?', placeholder: 'למשל: כהן' },
      DATE,
      { ...VENUE, ask: 'מה הכתובת של הבית החדש?', placeholder: 'למשל: רחוב הנביאים 12, ירושלים' },
      TIME,
    ],
    card: named('חנוכת הבית', 'family', 'משפחת '),
  },
  'קידוש': {
    mood: 'gold',
    blessing: 'מזל טוב! לחיים',
    questions: [{ key: 'family', ask: 'מה שם המשפחה?', placeholder: 'למשל: כהן' }, DATE, { ...VENUE, ask: 'באיזה בית כנסת?' }, TIME],
    card: named('קידוש', 'family', 'משפחת '),
  },
};

/** any other private simcha: whose it is, when and where */
const GENERIC: Story = {
  mood: 'gold',
  blessing: 'מזל טוב! בשעה טובה',
  questions: [{ key: 'honoree', ask: 'על שם מי השמחה?', placeholder: 'שם או שמות' }, DATE, VENUE, TIME],
  card: named('', 'honoree'),
};

/** the categories whose light is set on its own, without a story (no questions to ask) */
const MOODS: Record<string, Mood> = { 'בית כנסת': 'evening', 'תעודות': 'gold', 'שמחת בית השואבה': 'evening', [GENERAL_TOPIC]: 'gold' };

export const storyOf = (category: string): Story | null => STORIES[category] ?? (MOODS[category] ? null : GENERIC);
export const moodOf = (category: string): Mood => STORIES[category]?.mood ?? MOODS[category] ?? 'gold';

/* ------------------------------------------------------------------ answers -> a design's fields */

type Rule = { label: RegExp; value: (a: Answers, sample: string) => string | undefined };

const h = (a: Answers) => (a.date ? hebrewDate(a.date) : null);
const names = (a: Answers) => [a.groom, a.bride].filter(Boolean).join(' ו') || a.honoree || a.parents || (a.family ? `משפחת ${a.family}` : '');
/** keeps a design's leading "של" / "ב" so the line still reads like the sample did */
const like = (sample: string, value: string, lead: string) => (sample.trim().startsWith(lead) && !value.startsWith(lead) ? lead + value : value);

/**
 * First match wins. A rule returns undefined to leave the field as designed (nothing to say about it) and '' to
 * empty it: a sample name or address left on a personal card would be wrong.
 */
const FILL_RULES: Rule[] = [
  { label: /שמות? החתן והכלה|שם החתן והכלה/, value: (a, s) => (a.groom || a.bride ? like(s, names(a), 'של ') : undefined) },
  { label: /^שם החתן/, value: (a) => a.groom },
  { label: /^שם הכלה/, value: (a) => a.bride },
  { label: /^חתימה/, value: (a, s) => (a.groom && s.trim().startsWith('החתן') ? `החתן ${a.groom}` : undefined) },
  { label: /^הורי החתן/, value: (a) => (a.groom ? a.groomParents ?? '' : undefined) },
  { label: /^הורי הכלה/, value: (a) => (a.bride ? a.brideParents ?? '' : undefined) },
  { label: /^וב״ב \(חתן\)/, value: (a) => (a.groom && !a.groomParents ? '' : undefined) },
  { label: /^וב״ב \(כלה\)/, value: (a) => (a.bride && !a.brideParents ? '' : undefined) },
  { label: /שם החוגג|שם הילד|שם התינוק|^שמות?$/, value: (a) => names(a) || undefined },
  { label: /משפחת|שם המשפחה/, value: (a) => (a.family ? `משפחת ${a.family}` : undefined) },
  { label: /תאריך ושעה/, value: (a) => (h(a) ? `ב${h(a)!.weekday} ${h(a)!.full}${a.time ? ` בשעה ${a.time}` : ''}` : undefined) },
  { label: /^תאריך/, value: (a, s) => (h(a) ? (s.trim().startsWith('יום') ? `${h(a)!.weekday}, ${h(a)!.full}` : h(a)!.full) : undefined) },
  { label: /יום ופרשה/, value: (a) => (h(a) ? `ב${h(a)!.weekday}` : undefined) },
  { label: /^יום/, value: (a) => h(a)?.weekday },
  { label: /^שעות|^שעה/, value: (a) => (a.date ? (a.time ? `בשעה ${a.time}` : '') : undefined) },
  { label: /^(מקום|אולם|מקום האירוע)/, value: (a, s) => (a.venue ? like(s, a.venue, 'ב') : undefined) },
  { label: /^כתובת/, value: (a) => (a.venue ? '' : undefined) },
];

/** The design's editable text fields, filled from the answers: element id -> text. Fields nothing matches keep their design. */
export function fillFor(doc: CanvasDoc, a: Answers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of doc.elements) {
    if (e.type !== 'text' || !e.editable) continue;
    const rule = FILL_RULES.find((r) => r.label.test((e.label ?? '').trim()));
    const v = rule?.value(a, e.text);
    if (v !== undefined) out[e.id] = v;
  }
  return out;
}

/** the design with the answers written in (for its preview on the ring) */
export const applyFill = <D extends CanvasDoc>(doc: D, fill: Record<string, string>): D => ({
  ...doc,
  elements: doc.elements.map((e) => (e.type === 'text' && fill[e.id] !== undefined ? { ...e, text: fill[e.id] } : e)),
});
