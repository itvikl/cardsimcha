import { createSdkMcpServer, query, tool, type EffortLevel } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

export type ComposedAd = { direction: string; headline: string; sub: string; points: string[]; cta: string; itemId?: string; stickerId?: string };
export type Composed = { ads: ComposedAd[] } | { question: string };
/** a sticker as the model sees it */
export type StickerChoice = { id: string; name: string; tags: string[] };

const MODEL = process.env.AGENT_MODEL || 'claude-sonnet-5-5';
const EFFORT = (process.env.COMPOSE_EFFORT || 'low') as EffortLevel;
const TIMEOUT_MS = 90_000;

const PROMPT = `You write advertisements in Hebrew for a small Israeli business. The business owner writes one sentence about what they want to advertise.
Call submit_ads once with exactly three ads, each from a clearly different angle (for example: the customer's worry, the offer itself, why this business).
If you truly cannot tell what to advertise, call ask_question once instead, with one short Hebrew question.
Rules:
- Write only what is true. Use only facts from the owner's sentence and the business brief. Never invent prices, discounts, dates, numbers, reviews, customers or guarantees.
- Every number in an ad must appear in the owner's sentence or in the brief.
- One ad, one message. Headline up to 6 words. Sub up to 14 words. Each of the 3 points up to 6 words. Call to action up to 4 words.
- Natural Hebrew for a religious Israeli audience: respectful, direct, no slang and no exaggeration.
- If the owner's sentence is about an item in the catalog, set item_id to its id.
- If stickers are listed below, set sticker_id on each ad to the one sticker that best carries its message, a different one per ad when possible. Only use ids from the list.
- "direction" is a few Hebrew words naming the angle, shown to the owner.`;

const adSchema = z.object({
  direction: z.string().max(40),
  headline: z.string().max(60),
  sub: z.string().max(120),
  points: z.array(z.string().max(50)).length(3),
  cta: z.string().max(30),
  item_id: z.string().optional(),
  sticker_id: z.string().optional(),
});

/** Three ads from one sentence, or one question back. Words and choices only: the caller decides what may reach a design. */
export async function composeAds(request: string, brief: string, stickers: StickerChoice[] = []): Promise<Composed> {
  let answer: Composed | null = null;
  const server = createSdkMcpServer({
    name: 'ads',
    version: '1.0.0',
    alwaysLoad: true,
    tools: [
      tool('submit_ads', 'Hand over the three finished ads.', { ads: z.array(adSchema).length(3) }, async ({ ads }) => {
        answer = { ads: ads.map(({ item_id, sticker_id, ...a }) => ({ ...a, itemId: item_id, stickerId: sticker_id })) };
        return { content: [{ type: 'text' as const, text: 'received' }] };
      }),
      tool('ask_question', 'Ask the owner one short question, when what to advertise is unclear.', { question: z.string().max(200) }, async ({ question }) => {
        answer = { question };
        return { content: [{ type: 'text' as const, text: 'received' }] };
      }),
    ],
  });

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    const q = query({
      prompt: `The owner's sentence:\n${request}`,
      options: {
        model: MODEL,
        effort: EFFORT,
        systemPrompt: `${PROMPT}\n\nToday is ${new Date().toISOString().slice(0, 10)}.\n\nThe business brief:\n${brief}${stickers.length ? `\n\nThe stickers:\n${stickers.map((s) => `${s.id}: ${s.name} (${s.tags.join(', ')})`).join('\n')}` : ''}`,
        tools: [],
        mcpServers: { ads: server },
        allowedTools: ['mcp__ads__submit_ads', 'mcp__ads__ask_question'],
        permissionMode: 'dontAsk',
        settingSources: [],
        strictMcpConfig: true,
        persistSession: false,
        maxTurns: 4,
        abortController: abort,
      },
    });
    for await (const m of q) {
      if (m.type === 'result' && (m.subtype !== 'success' || m.is_error)) throw new Error(m.subtype === 'success' ? m.result : m.errors.join('; ') || m.subtype);
    }
  } finally {
    clearTimeout(timer);
  }
  if (!answer) throw new Error('no ads came back');
  return answer;
}

/** the numbers in a text, without their separators */
const numbers = (t: string) => (t.match(/\d[\d,.]*/g) ?? []).map((n) => n.replace(/\D/g, ''));

/** Whether every number in the ad appears in what the business itself gave: the model is told this, and here it is checked. */
export function backedByFacts(ad: ComposedAd, facts: string) {
  const known = new Set(numbers(facts));
  return numbers([ad.headline, ad.sub, ...ad.points, ad.cta].join(' ')).every((n) => known.has(n));
}
