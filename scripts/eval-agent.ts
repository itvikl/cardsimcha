/**
 * Compares models/effort levels for the editor agent on fixed scenarios with automatic checks.
 * Usage: npm run eval:agent [-- --runs 2 --concurrency 4 --only sonnet]
 * Uses the same credentials as the app (Claude Code login in dev, or ANTHROPIC_API_KEY).
 */
import type { EffortLevel } from '@anthropic-ai/claude-agent-sdk';
import { runAgent } from '../src/lib/agent/run';
import type { AgentMode, AgentState } from '../src/lib/agent/tools';
import { applyCustomerEdits, validateDoc } from '../src/lib/canvas';
import type { CanvasDoc, Category, ImageAsset, TextElement } from '../src/lib/types';

type Config = { name: string; model: string; effort?: EffortLevel };
const CONFIGS: Config[] = [
  { name: 'haiku-4.5', model: 'claude-haiku-4-5' },
  { name: 'sonnet-5.5 low', model: 'claude-sonnet-5-5', effort: 'low' },
  { name: 'sonnet-5.5 medium', model: 'claude-sonnet-5-5', effort: 'medium' },
  { name: 'opus-5.5 low', model: 'claude-opus-5-5', effort: 'low' },
  { name: 'opus-5.5 medium', model: 'claude-opus-5-5', effort: 'medium' },
];

// ---- fixtures ---------------------------------------------------------------------
const categories: Category[] = [{ id: 'cat-bg', name: 'רקעים', description: '', createdAt: '' }];
const images: ImageAsset[] = [
  { id: 'img-flowers', categoryId: 'cat-bg', name: 'פרחים ורודים', file: 'a.png', width: 1480, height: 2100, createdAt: '' },
  { id: 'img-gold', categoryId: 'cat-bg', name: 'מסגרת זהב', file: 'b.png', width: 1480, height: 2100, createdAt: '' },
  { id: 'img-olive', categoryId: 'cat-bg', name: 'ענפי זית ירוקים', file: 'c.png', width: 1480, height: 2100, createdAt: '' },
];

const field = (id: string, label: string, text: string, y: number, editable = true): TextElement => ({
  id, type: 'text', x_mm: 14, y_mm: y, w_mm: 120, rotation: 0, z: 0, text, align: 'center', editable, label,
  font: { family: 'Heebo', weight: 700, size_pt: 20, color: '#1F3A2E' },
});

const weddingTemplate = (): CanvasDoc => ({
  schema_version: 1,
  page: { width_mm: 148, height_mm: 210, background: '#FAF8F3' },
  elements: [
    { id: 'bg', type: 'image' as const, x_mm: 0, y_mm: 0, w_mm: 148, h_mm: 210, rotation: 0, z: 0, asset_id: 'img-flowers', swappable: true, swapCategoryId: 'cat-bg', label: 'רקע' },
    field('title', 'כותרת', 'חתונה', 20, false),
    field('groom', 'שם החתן', 'שם החתן', 60),
    field('bride', 'שם הכלה', 'שם הכלה', 80),
    field('date', 'תאריך', 'תאריך', 110),
    field('venue', 'מקום האירוע', 'מקום', 130),
    field('time', 'שעה', 'שעה', 150),
  ].map((e, i) => ({ ...e, z: i })),
});

const emptyA5 = (): CanvasDoc => ({ schema_version: 1, page: { width_mm: 148, height_mm: 210, background: '#FAF8F3' }, elements: [] });

// ---- scenarios -----------------------------------------------------------------------
type Check = [string, (d: CanvasDoc, reply: string) => boolean];
type Scenario = { name: string; mode: AgentMode; doc: () => CanvasDoc; message: string; checks: Check[] };

const text = (d: CanvasDoc, id: string) => (d.elements.find((e) => e.id === id) as TextElement | undefined)?.text ?? '';
const texts = (d: CanvasDoc) => d.elements.filter((e): e is TextElement => e.type === 'text');
const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const isHebrewReply = (r: string) => /[֐-׿]/.test(r) && !/\b(User|the user|Reply|I should|Let me)\b/i.test(r);
const inPage = (d: CanvasDoc) =>
  d.elements.every((e) => e.x_mm >= -1 && e.y_mm >= -1 && e.x_mm + e.w_mm <= d.page.width_mm + 1 && e.y_mm <= d.page.height_mm - 3);

const SCENARIOS: Scenario[] = [
  {
    name: 'customer: fill all fields',
    mode: 'customer',
    doc: weddingTemplate,
    message: 'החתונה של דן כהן ונועה לוי, ביום שלישי 12 במאי 2026, באולם הגן בירושלים. קבלת פנים ב-19:30',
    checks: [
      ['groom', (d) => text(d, 'groom').includes('דן')],
      ['bride', (d) => text(d, 'bride').includes('נועה')],
      ['date', (d) => /12/.test(text(d, 'date')) && /מאי|5/.test(text(d, 'date'))],
      ['venue', (d) => text(d, 'venue').includes('הגן')],
      ['time', (d) => text(d, 'time').includes('19:30')],
      ['names not mixed', (d) => !text(d, 'groom').includes('נועה') && !text(d, 'bride').includes('דן')],
      ['title kept', (d) => text(d, 'title') === 'חתונה'],
      ['reply clean', (_, r) => isHebrewReply(r)],
    ],
  },
  {
    name: 'customer: partial update',
    mode: 'customer',
    doc: () => {
      const d = weddingTemplate();
      (d.elements.find((e) => e.id === 'bride') as TextElement).text = 'נועה לוי';
      return d;
    },
    message: 'השם של החתן הוא אבי',
    checks: [
      ['groom', (d) => text(d, 'groom').includes('אבי')],
      ['bride untouched', (d) => text(d, 'bride') === 'נועה לוי'],
      ['others untouched', (d) => text(d, 'date') === 'תאריך' && text(d, 'venue') === 'מקום' && text(d, 'time') === 'שעה'],
      ['reply clean', (_, r) => isHebrewReply(r)],
    ],
  },
  {
    name: 'customer: background + forbidden ask',
    mode: 'customer',
    doc: weddingTemplate,
    message: "תחליף את הכותרת ל'מזל טוב', ותשים רקע עם ענפי זית",
    checks: [
      ['olive bg', (d) => d.elements.some((e) => e.type === 'image' && e.asset_id === 'img-olive' && !e.colorOverride)],
      ['title kept', (d) => text(d, 'title') === 'חתונה'],
      ['explains limit', (_, r) => /לא (ניתן|אפשר|יכול|הצלחתי)|נעול|אין אפשרות|אינה ניתנת|לא ניתנת/.test(r)],
      ['reply clean', (_, r) => isHebrewReply(r)],
    ],
  },
  {
    name: 'admin: build bar mitzvah',
    mode: 'full',
    doc: emptyA5,
    message:
      "בנה הזמנה לבר מצווה: כותרת 'בר מצווה' בגופן Frank Ruhl Libre בגודל 40, ומתחתיה שדות לעריכה: שם הילד, תאריך, מקום. רקע תכלת בהיר.",
    checks: [
      ['title', (d) => texts(d).some((t) => t.text.includes('בר מצווה') && t.font.family === 'Frank Ruhl Libre' && t.font.size_pt === 40)],
      ['title not editable', (d) => texts(d).filter((t) => t.text.includes('בר מצווה')).every((t) => !t.editable)],
      ['3 labelled fields', (d) => texts(d).filter((t) => t.editable && t.label && t.label !== 'טקסט').length >= 3],
      ['light blue bg', (d) => { const [r, g, b] = hex(d.page.background); return b > r && b >= g && r + g + b > 450; }],
      ['inside page', (d) => inPage(d)],
      ['no overlaps', (d) => { const ys = texts(d).map((t) => t.y_mm).sort((a, b) => a - b); return ys.every((y, i) => i === 0 || y - ys[i - 1] >= 8); }],
      ['reply clean', (_, r) => isHebrewReply(r)],
    ],
  },
  {
    name: 'admin: restyle existing',
    mode: 'full',
    doc: weddingTemplate,
    message: 'תגדיל את הכותרת ל-48, תצבע אותה בזהב, ותמחק את שדה השעה',
    checks: [
      ['title 48', (d) => texts(d).find((t) => t.id === 'title')?.font.size_pt === 48],
      ['title gold', (d) => { const c = texts(d).find((t) => t.id === 'title')?.font.color ?? '#000000'; const [r, g, b] = hex(c); return r > 150 && g > 100 && b < 120 && r > b; }],
      ['time deleted', (d) => !d.elements.some((e) => e.id === 'time')],
      ['rest kept', (d) => ['groom', 'bride', 'date', 'venue', 'bg'].every((id) => d.elements.some((e) => e.id === id))],
      ['reply clean', (_, r) => isHebrewReply(r)],
    ],
  },
];

// ---- runner ----------------------------------------------------------------------------
const args = process.argv.slice(2);
const arg = (k: string, def: string) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : def; };
const RUNS = Number(arg('runs', '2'));
const CONC = Number(arg('concurrency', '4'));
const only = arg('only', '');
const configs = CONFIGS.filter((c) => !only || c.name.includes(only));

type Row = { config: string; scenario: string; passed: number; total: number; failed: string[]; cost: number; ms: number; turns: number; error?: string };

async function one(c: Config, s: Scenario): Promise<Row> {
  const original = s.doc();
  const state: AgentState = { doc: structuredClone(original), mode: s.mode, images, categories, changed: false };
  const base = { config: c.name, scenario: s.name, total: s.checks.length };
  try {
    const run = await runAgent(state, s.message, [], { model: c.model, effort: c.effort });
    const doc = s.mode === 'full' ? validateDoc(state.doc) : applyCustomerEdits(original, state.doc, images);
    if (!doc) return { ...base, passed: 0, failed: ['invalid doc'], cost: run.costUsd, ms: run.ms, turns: run.turns };
    const failed = s.checks.filter(([, f]) => !f(doc, run.reply)).map(([n]) => n);
    return { ...base, passed: s.checks.length - failed.length, failed, cost: run.costUsd, ms: run.ms, turns: run.turns };
  } catch (e) {
    return { ...base, passed: 0, failed: ['error'], cost: 0, ms: 0, turns: 0, error: (e as Error).message };
  }
}

async function main() {
  const jobs = configs.flatMap((c) => SCENARIOS.flatMap((s) => Array.from({ length: RUNS }, () => () => one(c, s))));
  const rows: Row[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: CONC }, async () => {
      while (next < jobs.length) {
        const r = await jobs[next++]();
        rows.push(r);
        console.log(`${r.config.padEnd(18)} ${r.scenario.padEnd(36)} ${r.passed}/${r.total}  $${r.cost.toFixed(4)}  ${(r.ms / 1000).toFixed(1)}s  ${r.failed.join(', ')}${r.error ? ' ' + r.error.slice(0, 120) : ''}`);
      }
    }),
  );

  console.log('\n=== summary (per config, averaged over all runs) ===');
  console.log('config              score    avg $/request   avg time   errors');
  for (const c of configs) {
    const rs = rows.filter((r) => r.config === c.name);
    const score = rs.reduce((a, r) => a + r.passed, 0) / rs.reduce((a, r) => a + r.total, 0);
    const ok = rs.filter((r) => !r.error);
    const cost = ok.reduce((a, r) => a + r.cost, 0) / Math.max(1, ok.length);
    const ms = ok.reduce((a, r) => a + r.ms, 0) / Math.max(1, ok.length);
    console.log(`${c.name.padEnd(18)}  ${(score * 100).toFixed(0).padStart(4)}%   $${cost.toFixed(4).padStart(8)}       ${(ms / 1000).toFixed(1).padStart(5)}s   ${rs.length - ok.length}`);
  }
}

main();
