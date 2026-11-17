import { createSdkMcpServer, query, tool, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

/** One text the model read off a finished design; places and sizes are in percent of the picture. */
export type ReadText = { text: string; label: string; x: number; y: number; w: number; h: number; lineHeight: number; color: string; align: 'right' | 'center' | 'left'; bold: boolean; font: string; rotation: number; arc: number };

const MODEL = process.env.AGENT_MODEL || 'claude-sonnet-5-5';
const TIMEOUT_MS = 120_000;

const PROMPT = (fonts: string[]) => `You read a finished Hebrew design (an ad or an invitation) so it can be rebuilt as an editable template.
Call submit_texts once with every text you can see in the picture, grouped so each element is one block that belongs together (a headline, a phone number, a paragraph).
Rules:
- Copy the words exactly, keeping their line breaks with \\n. Do not correct or translate them.
- x, y, w, h are the block's tight box, in percent of the picture's width (x, w) and height (y, h). Measure carefully: the text will be erased from exactly there.
- line_height is the height of ONE line of the block, in percent of the picture's height.
- rotation is how far the line is turned, in degrees clockwise: 0 for an ordinary line, -90 for a text turned to read from bottom to top, 90 for one reading from top to bottom, and any angle between for a slanted line (a line rising to the left is about -15). Designs often run a title up the side of the page: its letters then stand one above the other, each lying on its side. That is ONE turned line: write it as ordinary text in reading order, never letter by letter with line breaks, and give its rotation. For a turned or slanted text x, y, w, h are still its box as it stands in the picture, and for a turned one (beyond 45 degrees) line_height is the thickness of one line in percent of the picture's WIDTH.
- arc is how much a line set along a curve bends: 0 for a straight line, up to 100 for a half circle with its middle at the top (a rainbow), down to -100 for one with its middle at the bottom (a smile). A curved line is one line: x, y, w, h are the box around all of it, and rotation is the turn of the curve as a whole (its middle's tilt).
- color is the text's colour as #RRGGBB.
- font is the closest of: ${fonts.join(', ')}. The exact font usually isn't among them; pick by look: serif or sans, heavy or light.
- label is a short Hebrew name for the field, the kind a customer would fill in, such as "כותרת", "טלפון", "שמות". Each label is different.
- Leave out text that is part of a logo or of a picture itself, like a sign in a photograph.
If the picture has no text, call submit_texts with an empty list.`;

const schema = z.object({
  text: z.string().max(1000),
  label: z.string().max(60),
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  w: z.number().min(0.5).max(100),
  h: z.number().min(0.3).max(100),
  line_height: z.number().min(0.2).max(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  align: z.enum(['right', 'center', 'left']),
  bold: z.boolean(),
  font: z.string().max(60),
  rotation: z.number().min(-90).max(90).optional(),
  arc: z.number().min(-100).max(100).optional(),
});

/** The texts of a finished design, as the model reads them. A reading, so an admin goes over the template it becomes. */
export async function readDesign(image: Buffer, mediaType: 'image/jpeg' | 'image/png' | 'image/webp', fonts: string[]): Promise<ReadText[]> {
  let answer: ReadText[] | null = null;
  const server = createSdkMcpServer({
    name: 'design',
    version: '1.0.0',
    alwaysLoad: true,
    tools: [
      tool('submit_texts', 'Hand over the texts read from the picture.', { texts: z.array(schema).max(60) }, async ({ texts }) => {
        // a turn or a bend too small to see is none
        answer = texts.map(({ line_height, rotation, arc, ...t }) => ({
          ...t,
          lineHeight: line_height,
          rotation: Math.abs(rotation ?? 0) < 2 ? 0 : Math.round(rotation ?? 0),
          arc: Math.abs(arc ?? 0) < 3 ? 0 : Math.round(arc ?? 0),
        }));
        return { content: [{ type: 'text' as const, text: 'received' }] };
      }),
    ],
  });
  async function* message(): AsyncIterable<SDKUserMessage> {
    yield {
      type: 'user',
      parent_tool_use_id: null,
      message: {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: image.toString('base64') } },
          { type: 'text', text: 'Read this design.' },
        ],
      },
    } as SDKUserMessage;
  }

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    const q = query({
      prompt: message(),
      options: {
        model: MODEL,
        effort: 'medium',
        systemPrompt: PROMPT(fonts),
        tools: [],
        mcpServers: { design: server },
        allowedTools: ['mcp__design__submit_texts'],
        permissionMode: 'dontAsk',
        settingSources: [],
        strictMcpConfig: true,
        persistSession: false,
        maxTurns: 3,
        abortController: abort,
      },
    });
    for await (const m of q) {
      if (m.type === 'result' && (m.subtype !== 'success' || m.is_error)) throw new Error(m.subtype === 'success' ? m.result : m.errors.join('; ') || m.subtype);
    }
  } finally {
    clearTimeout(timer);
  }
  if (!answer) throw new Error('nothing came back');
  return answer;
}
