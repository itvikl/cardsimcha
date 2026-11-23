import { query, type EffortLevel } from '@anthropic-ai/claude-agent-sdk';
import { buildServer, type AgentState } from './tools';

export type ChatTurn = { role: 'user' | 'assistant'; text: string };

// Sonnet 5.5 at medium effort scored 100% on scripts/eval-agent.ts at about half the cost of Opus 5.5
const MODEL = process.env.AGENT_MODEL || 'claude-sonnet-5-5';
const EFFORT = (process.env.AGENT_EFFORT || 'medium') as EffortLevel;
const TIMEOUT_MS = 120_000;

const BASE_PROMPT = `You are the design assistant inside a Hebrew greeting-card editor.
The user describes what they want; you change the card only through the card tools.
Always call get_card first to see the element ids. Measurements are in millimetres from the page's top-left corner.
Texts are Hebrew (right-to-left) unless the user writes in another language. Keep every element inside the page.
When you are done, answer the user in one or two short sentences in the user's language (usually Hebrew) saying what you changed.
Your final message is shown to the user word for word: write only that answer, with no notes to yourself, no restating of the request and no English preamble.
If the user asks for something the tools cannot do, say so briefly instead of guessing.`;

const CUSTOMER_PROMPT = `The user is a customer filling in a template. They may only change the text, colour and position of
editable text fields, and replace images marked swappable. Match each detail the user gives to the field whose label fits it best.
Do not put text into fields that do not fit it; leave fields the user said nothing about unchanged.`;

const ADMIN_PROMPT = `The user is the template designer and may change anything: add, delete, move and restyle elements,
mark texts as editable for customers (with a short Hebrew label such as "שם החתן"), and change the page.`;

/**
 * Runs one agent turn over `state.doc`. In development this uses the Claude Code login on
 * this machine; with ANTHROPIC_API_KEY set it bills the API instead.
 */
export type AgentRun = { reply: string; costUsd: number; turns: number; ms: number };

export async function runAgent(
  state: AgentState,
  message: string,
  history: ChatTurn[],
  opts: { model?: string; effort?: EffortLevel } = {},
): Promise<AgentRun> {
  const { server, toolNames } = buildServer(state);
  const transcript = history.length
    ? 'Earlier in this conversation:\n' + history.map((t) => `${t.role === 'user' ? 'User' : 'You'}: ${t.text}`).join('\n') + '\n\n'
    : '';

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    const q = query({
      prompt: transcript + 'User: ' + message,
      options: {
        model: opts.model ?? MODEL,
        effort: opts.effort ?? EFFORT,
        systemPrompt: [BASE_PROMPT, state.mode === 'full' ? ADMIN_PROMPT : CUSTOMER_PROMPT].join('\n\n'),
        tools: [], // no built-in Claude Code tools (files, shell, web)
        mcpServers: { card: server },
        allowedTools: toolNames,
        permissionMode: 'dontAsk',
        settingSources: [], // ignore CLAUDE.md and local settings
        strictMcpConfig: true,
        persistSession: false,
        maxTurns: 25,
        abortController: abort,
      },
    });
    const run: AgentRun = { reply: '', costUsd: 0, turns: 0, ms: 0 };
    for await (const m of q) {
      if (m.type !== 'result') continue;
      if (m.subtype !== 'success' || m.is_error) {
        throw new Error(m.subtype === 'success' ? m.result : m.errors.join('; ') || m.subtype);
      }
      Object.assign(run, { reply: m.result, costUsd: m.total_cost_usd, turns: m.num_turns, ms: m.duration_ms });
    }
    return run;
  } finally {
    clearTimeout(timer);
  }
}
