import { createSdkMcpServer, tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import {
  addElement,
  findElement,
  LOCKED,
  moveInLayer,
  moveToLayer,
  PAGE_PRESETS,
  removeElement,
  replaceElement,
  setBackground,
  updateElement,
} from '../canvas';
import { newImage, newRect, newText } from '../elements';
import type { FontFamily } from '../fonts';
import type { CanvasDoc, CanvasElement, Category, ImageAsset, LayerName, Locks } from '../types';

export type AgentMode = 'full' | 'customer';

/** Mutable state the tools work on; the route reads `doc` back when the run ends. */
export type AgentState = {
  doc: CanvasDoc;
  mode: AgentMode;
  images: ImageAsset[];
  categories: Category[];
  /** built-in and uploaded font families (fontFamilies) */
  fonts: FontFamily[];
  changed: boolean;
};

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/).describe('hex colour like #1F3A2E');
const layer = z.enum(['content', 'overlay']).describe('content (default) or overlay, which is drawn above content');
const ok = (text: string) => ({ content: [{ type: 'text' as const, text }] });
const fail = (text: string) => ({ content: [{ type: 'text' as const, text }], isError: true });
const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));
const BACKGROUND = 'background';

export const SERVER_NAME = 'card';

export function buildServer(s: AgentState) {
  const full = s.mode === 'full';
  const set = (doc: CanvasDoc) => {
    s.doc = doc;
    s.changed = true;
  };
  const patch = (id: string, p: Partial<CanvasElement>) => set(updateElement(s.doc, id, p));
  const find = (id: string) => findElement(s.doc, id)?.el;
  /** the element, when the user may do `what` with it (an author may do everything) */
  const allowed = (id: string, what: keyof Locks, type?: CanvasElement['type']) => {
    const e = find(id);
    if (!e || (type && e.type !== type)) return { error: `No ${type ?? 'element'} with id ${id}` };
    if (!full && !e.locks[what]) return { error: `The customer may not change the ${what === 'content' ? 'content' : what} of this element.` };
    return { el: e };
  };
  const swapOptions = (collection?: string) => s.images.filter((i) => !collection || i.categoryId === collection);

  const getCard = tool(
    'get_card',
    'Read the current card: page size, the background layer and all elements (with their layer and ids). Call this first.',
    {},
    async () => {
      const bg = s.doc.layers.background;
      const background = {
        id: BACKGROUND,
        fill: bg.fill.color,
        image: bg.image,
        label: bg.field?.label,
        customer_may_swap: bg.locks.content,
        customer_may_recolor: bg.locks.style,
        ...(bg.locks.content && { options: swapOptions(bg.swap_collection_id).map((i) => ({ asset_id: i.id, name: i.name })) }),
      };
      const describe = (e: CanvasElement, layerName: LayerName) => {
        const base = { id: e.id, layer: layerName, type: e.type, x_mm: r(e.x_mm), y_mm: r(e.y_mm), w_mm: r(e.w_mm), rotation: e.rotation, locks: e.locks, label: e.field?.label };
        if (e.type === 'text') return { ...base, text: e.text, editable: e.locks.content, align: e.align, font: e.font };
        if (e.type === 'image') {
          const swap = e.locks.content ? { swappable: true, options: swapOptions(e.swap_collection_id).map((i) => ({ asset_id: i.id, name: i.name })) } : {};
          return { ...base, h_mm: r(e.h_mm), asset_id: e.asset_id, colorOverride: e.colorOverride, ...swap };
        }
        return { ...base, h_mm: r(e.h_mm), fill: e.fill.color };
      };
      const elements = [
        ...s.doc.layers.content.map((e) => describe(e, 'content')),
        ...s.doc.layers.overlay.map((e) => describe(e, 'overlay')),
      ];
      const note = full ? undefined : 'locks say what the customer may do: content = change text / swap image, style = colour, transform = move.';
      return ok(JSON.stringify({ page: s.doc.page, background, elements, note }));
    },
  );

  const setText = tool('set_text', 'Replace the text of a text element.', { id: z.string(), text: z.string().max(500) }, async ({ id, text }) => {
    const t = allowed(id, 'content', 'text');
    if ('error' in t) return fail(t.error!);
    patch(id, { text });
    return ok('done');
  });

  const setTextColor = tool('set_text_color', 'Change the colour of a text element.', { id: z.string(), color }, async ({ id, color }) => {
    const t = allowed(id, 'style', 'text');
    if ('error' in t) return fail(t.error!);
    if (t.el?.type === 'text') patch(id, { font: { ...t.el.font, color } });
    return ok('done');
  });

  const moveText = tool(
    'move_text',
    'Move a text element (top-left corner, in mm from the page top-left).',
    { id: z.string(), x_mm: z.number(), y_mm: z.number() },
    async ({ id, x_mm, y_mm }) => {
      const t = allowed(id, 'transform', 'text');
      if ('error' in t) return fail(t.error!);
      patch(id, { x_mm: clamp(x_mm, 0, s.doc.page.width_mm - 5), y_mm: clamp(y_mm, 0, s.doc.page.height_mm - 5) });
      return ok('done');
    },
  );

  const swapImage = tool(
    'swap_image',
    `Replace an image (its id, or "${BACKGROUND}" for the background image) with another library image (asset_id), or show a flat colour instead (color).`,
    { id: z.string(), asset_id: z.string().optional(), color: color.optional() },
    async ({ id, asset_id, color }) => {
      if (id === BACKGROUND) {
        const bg = s.doc.layers.background;
        if (!full && !bg.locks.content) return fail('The customer may not replace the background.');
        if (color) {
          if (!bg.image) {
            set(setBackground(s.doc, { fill: { type: 'solid', color } }));
            return ok('done');
          }
          set(setBackground(s.doc, { image: { ...bg.image, colorOverride: color } }));
          return ok('done');
        }
        const options = full ? s.images : swapOptions(bg.swap_collection_id);
        if (!asset_id || !options.some((i) => i.id === asset_id)) return fail('Unknown or disallowed asset_id; see background.options in get_card.');
        set(setBackground(s.doc, { image: { asset_id, fit: bg.image?.fit ?? 'cover' } }));
        return ok('done');
      }
      const t = allowed(id, 'content', 'image');
      if ('error' in t) return fail(t.error!);
      const e = t.el as Extract<CanvasElement, { type: 'image' }>;
      if (color) {
        patch(id, { colorOverride: color });
        return ok('done');
      }
      const options = full ? s.images : swapOptions(e.swap_collection_id);
      if (!asset_id || !options.some((i) => i.id === asset_id)) return fail('Unknown or disallowed asset_id; see options in get_card.');
      patch(id, { asset_id, colorOverride: undefined });
      return ok('done');
    },
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools: SdkMcpToolDefinition<any>[] = [getCard, setText, setTextColor, moveText, swapImage];

  if (full) {
    const add = (el: CanvasElement, to?: LayerName) => {
      set(addElement(s.doc, el, to ?? 'content'));
      return ok(JSON.stringify({ id: el.id }));
    };
    tools.push(
      tool('list_library', 'List image categories and images that can be added to the card.', {}, async () =>
        ok(
          JSON.stringify({
            categories: s.categories.map((c) => ({ id: c.id, name: c.name })),
            images: s.images.map((i) => ({ asset_id: i.id, name: i.name, categoryId: i.categoryId, width: i.width, height: i.height })),
          }),
        ),
      ),
      tool(
        'add_text',
        'Add a text element. Returns its id. Customers can edit its text and colour unless editable=false.',
        { text: z.string().max(2000), label: z.string().max(60).optional(), editable: z.boolean().optional(), layer: layer.optional() },
        async ({ text, label, editable, layer: to }) => {
          const el = newText(s.doc, text);
          if (label !== undefined) el.field = { label };
          if (editable === false) {
            el.locks = LOCKED;
            delete el.field;
          }
          return add(el, to);
        },
      ),
      tool('add_rect', 'Add a rectangle. Returns its id.', { layer: layer.optional() }, async ({ layer: to }) => add(newRect(s.doc), to)),
      tool('add_image', 'Add a library image (see list_library). Returns its id.', { asset_id: z.string(), layer: layer.optional() }, async ({ asset_id, layer: to }) => {
        const asset = s.images.find((i) => i.id === asset_id);
        if (!asset) return fail('Unknown asset_id');
        return add(newImage(s.doc, asset), to);
      }),
      tool(
        'update_element',
        `Change properties of any element. Fonts (family: weights): ${s.fonts.map((f) => `${f.family}: ${f.weights.join('/')}${f.hebrew ? '' : ' (no Hebrew letters)'}`).join('; ')}. Sizes in mm, font size in pt.
editable (texts): customers may change its text and colour. swappable (images): customers may replace it. label: the field name customers see.
customer_may_move / customer_may_delete: further customer permissions.`,
        {
          id: z.string(),
          x_mm: z.number().optional(),
          y_mm: z.number().optional(),
          w_mm: z.number().min(1).max(2000).optional(),
          h_mm: z.number().min(1).max(2000).optional(),
          rotation: z.number().min(-360).max(360).optional(),
          fill: color.optional().describe('the colour of a text, or the fill of a rectangle'),
          align: z.enum(['right', 'center', 'left']).optional(),
          font_family: z.string().optional(),
          font_size_pt: z.number().min(4).max(400).optional(),
          font_weight: z.number().int().min(100).max(900).optional().describe('one of the weights the family has'),
          editable: z.boolean().optional(),
          swappable: z.boolean().optional(),
          customer_may_move: z.boolean().optional(),
          customer_may_delete: z.boolean().optional(),
          label: z.string().max(60).optional(),
          swap_category_id: z.string().optional(),
        },
        async (a) => {
          const e = find(a.id);
          if (!e) return fail(`No element with id ${a.id}`);
          const p: Record<string, unknown> = {};
          for (const k of ['x_mm', 'y_mm', 'w_mm', 'rotation'] as const) if (a[k] !== undefined) p[k] = a[k];
          if (a.h_mm !== undefined && e.type !== 'text') p.h_mm = a.h_mm;
          if (e.type === 'text') {
            const family = a.font_family ?? e.font.family;
            const fam = s.fonts.find((f) => f.family === family);
            if (a.font_family && !fam) return fail(`Unknown font ${a.font_family}`);
            if (a.font_weight && fam && !fam.weights.includes(a.font_weight)) return fail(`${family} has the weights ${fam.weights.join(', ')}`);
            if (a.align) p.align = a.align;
            if (a.font_family || a.font_size_pt || a.font_weight || a.fill) {
              p.font = {
                ...e.font,
                ...(a.font_family && { family: a.font_family }),
                ...(a.font_size_pt && { size_pt: a.font_size_pt }),
                ...(a.font_weight && { weight: a.font_weight }),
                ...(a.fill && { color: a.fill }),
              };
            }
          }
          if (e.type === 'shape' && a.fill) p.fill = { type: 'solid', color: a.fill };
          if (e.type === 'image' && a.swap_category_id) p.swap_collection_id = a.swap_category_id;

          const locks = { ...e.locks };
          const open = e.type === 'text' ? a.editable : e.type === 'image' ? a.swappable : undefined;
          if (open !== undefined) {
            locks.content = open;
            if (e.type === 'text') locks.style = open;
          }
          if (a.customer_may_move !== undefined) locks.transform = a.customer_may_move;
          if (a.customer_may_delete !== undefined) locks.delete = a.customer_may_delete;
          p.locks = locks;
          const customer = locks.content || locks.style;
          const next = { ...e, ...p } as CanvasElement;
          // a field is what the customer sees; an element they cannot change has none
          if (customer) next.field = { ...e.field, label: a.label ?? e.field?.label ?? (e.type === 'image' ? 'תמונה' : 'טקסט') };
          else delete next.field;
          set(replaceElement(s.doc, a.id, next));
          return ok('done');
        },
      ),
      tool('delete_element', 'Delete an element.', { id: z.string() }, async ({ id }) => {
        if (!find(id)) return fail(`No element with id ${id}`);
        set(removeElement(s.doc, id));
        return ok('done');
      }),
      tool(
        'reorder_element',
        'Move an element to the front (top) or back (bottom) of its own layer. Content always stays above the background.',
        { id: z.string(), to: z.enum(['front', 'back']) },
        async ({ id, to }) => {
          if (!find(id)) return fail(`No element with id ${id}`);
          set(moveInLayer(s.doc, id, to));
          return ok('done');
        },
      ),
      tool('move_to_layer', 'Move an element to the top of another layer (content or overlay).', { id: z.string(), layer }, async ({ id, layer: to }) => {
        if (!find(id)) return fail(`No element with id ${id}`);
        set(moveToLayer(s.doc, id, to));
        return ok('done');
      }),
      tool(
        'set_page',
        `Change the background colour and/or the page size preset (${PAGE_PRESETS.map((p) => p.id).join(', ')}).`,
        { background: color.optional(), preset: z.enum(PAGE_PRESETS.map((p) => p.id) as [string, ...string[]]).optional() },
        async ({ background, preset }) => {
          const p = PAGE_PRESETS.find((x) => x.id === preset);
          let doc = s.doc;
          if (background) doc = setBackground(doc, { fill: { type: 'solid', color: background } });
          if (p) doc = { ...doc, page: { width_mm: p.width_mm, height_mm: p.height_mm } };
          set(doc);
          return ok('done');
        },
      ),
      tool(
        'set_background_image',
        'Put a library image (asset_id) on the background layer, filling the page, or remove it (asset_id omitted). swappable: customers may replace it with an image from swap_category_id.',
        { asset_id: z.string().optional(), fit: z.enum(['cover', 'contain']).optional(), swappable: z.boolean().optional(), swap_category_id: z.string().optional(), label: z.string().max(60).optional() },
        async ({ asset_id, fit, swappable, swap_category_id, label }) => {
          const bg = s.doc.layers.background;
          if (asset_id && !s.images.some((i) => i.id === asset_id)) return fail('Unknown asset_id');
          const { image: _i, ...rest } = bg;
          void _i;
          const next = asset_id ? { ...rest, image: { asset_id, fit: fit ?? bg.image?.fit ?? 'cover' } } : rest;
          if (swappable !== undefined) next.locks = { ...bg.locks, content: swappable };
          if (swap_category_id) next.swap_collection_id = swap_category_id;
          if (label !== undefined || (next.locks.content && !next.field)) next.field = { label: label ?? bg.field?.label ?? 'רקע' };
          set({ ...s.doc, layers: { ...s.doc.layers, background: next } });
          return ok('done');
        },
      ),
    );
  }

  return {
    server: createSdkMcpServer({ name: SERVER_NAME, version: '1.0.0', tools, alwaysLoad: true }),
    toolNames: tools.map((t) => `mcp__${SERVER_NAME}__${t.name}`),
  };
}

const r = (n: number) => Math.round(n * 10) / 10;
