import { createSdkMcpServer, tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { AD_FORMATS } from '../adFormats';
import { placePhoto } from '../adText';
import { FONTS, MAX_OWN_TEXTS, MAX_STICKERS, PAGE_PRESETS, type FreeEdits } from '../canvas';
import { newImage, newRect, newText } from '../elements';
import { applyProducts, hasProducts, MAX_PRODUCTS } from '../products';
import { placeSticker, stickersFor } from '../sticker';
import type { CanvasDoc, CanvasElement, CatalogItem, Category, ImageAsset } from '../types';

export type AgentMode = 'full' | 'customer';

/** Mutable state the tools work on; the route reads `doc` back when the run ends. */
export type AgentState = {
  doc: CanvasDoc;
  mode: AgentMode;
  images: ImageAsset[];
  categories: Category[];
  changed: boolean;
  /** what the assistant should know about this business, when the design is a business's */
  brief?: string;
  /** a business's ad: it can do more with it than fill in fields, and these are the fonts of its own texts */
  free?: FreeEdits | null;
  topic?: string | null;
  /** the business's catalog */
  items?: CatalogItem[];
  /** the sizes this ad comes in */
  sizes?: string[];
  /** the run asked to open the ad in this size; the editor does it once the answer is shown */
  openSize?: string;
};

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/).describe('hex colour like #1F3A2E');
const ok = (text: string) => ({ content: [{ type: 'text' as const, text }] });
const fail = (text: string) => ({ content: [{ type: 'text' as const, text }], isError: true });
const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));

export const SERVER_NAME = 'card';

export function buildServer(s: AgentState) {
  const full = s.mode === 'full';
  const find = (id: string) => s.doc.elements.find((e) => e.id === id);
  const patch = (id: string, p: Partial<CanvasElement>) => {
    s.doc = { ...s.doc, elements: s.doc.elements.map((e) => (e.id === id ? ({ ...e, ...p } as CanvasElement) : e)) };
    s.changed = true;
  };
  const push = (el: CanvasElement) => {
    s.doc = { ...s.doc, elements: [...s.doc.elements, el].map((e, i) => ({ ...e, z: i })) };
    s.changed = true;
  };
  /** Text the customer may change; admins may change any text. */
  const textFor = (id: string) => {
    const e = find(id);
    if (!e || e.type !== 'text') return { error: `No text element with id ${id}` };
    if (!full && !e.editable) return { error: 'This text is not editable by the customer.' };
    return { el: e };
  };
  const swapOptions = (catId?: string) => s.images.filter((i) => !catId || i.categoryId === catId);

  const getCard = tool('get_card', 'Read the current card: page size and all elements with their ids. Call this first.', {}, async () => {
    const elements = s.doc.elements.map((e) => {
      const base = { id: e.id, type: e.type, x_mm: r(e.x_mm), y_mm: r(e.y_mm), w_mm: r(e.w_mm), rotation: e.rotation };
      if (e.type === 'text') return { ...base, text: e.text, label: e.label, editable: !!e.editable, own: !!e.own, align: e.align, font: e.font, arc: e.arc ?? 0 };
      if (e.type === 'image') {
        const swap = e.swappable
          ? { swappable: true, label: e.label, options: swapOptions(e.swapCategoryId).map((i) => ({ asset_id: i.id, name: i.name })) }
          : {};
        return { ...base, h_mm: r(e.h_mm), asset_id: e.asset_id, role: e.role, colorOverride: e.colorOverride, ...swap };
      }
      return { ...base, h_mm: r(e.h_mm), fill: e.fill };
    });
    return ok(JSON.stringify({ page: s.doc.page, elements }));
  });

  const setText = tool('set_text', 'Replace the text of a text element.', { id: z.string(), text: z.string().max(500) }, async ({ id, text }) => {
    const t = textFor(id);
    if ('error' in t) return fail(t.error!);
    patch(id, { text });
    return ok('done');
  });

  const setTextColor = tool('set_text_color', 'Change the colour of a text element.', { id: z.string(), color }, async ({ id, color }) => {
    const t = textFor(id);
    if ('error' in t) return fail(t.error!);
    patch(id, { font: { ...t.el!.font, color } } as Partial<CanvasElement>);
    return ok('done');
  });

  const moveText = tool('move_text', 'Move a text element (top-left corner, in mm from the page top-left).', { id: z.string(), x_mm: z.number(), y_mm: z.number() }, async ({ id, x_mm, y_mm }) => {
    const t = textFor(id);
    if ('error' in t) return fail(t.error!);
    patch(id, { x_mm: clamp(x_mm, 0, s.doc.page.width_mm - 5), y_mm: clamp(y_mm, 0, s.doc.page.height_mm - 5) });
    return ok('done');
  });

  const swapImage = tool(
    'swap_image',
    'Replace an image element with another library image (asset_id), or with a flat colour (color).',
    { id: z.string(), asset_id: z.string().optional(), color: color.optional() },
    async ({ id, asset_id, color }) => {
      const e = find(id);
      if (!e || e.type !== 'image') return fail(`No image with id ${id}`);
      if (!full && !e.swappable) return fail('This image cannot be replaced by the customer.');
      if (color) {
        patch(id, { colorOverride: color } as Partial<CanvasElement>);
        return ok('done');
      }
      const allowed = full ? s.images : swapOptions(e.swapCategoryId);
      if (!asset_id || !allowed.some((i) => i.id === asset_id)) return fail('Unknown or disallowed asset_id; see options in get_card.');
      patch(id, { asset_id, colorOverride: undefined } as Partial<CanvasElement>);
      return ok('done');
    },
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools: SdkMcpToolDefinition<any>[] = [getCard, setText, setTextColor, moveText, swapImage];

  if (!full) {
    const library = s.images.filter((i) => i.sticker);
    const own = s.images.filter((i) => i.ownSticker && !i.removed);
    const stickerAt = (id: string) => {
      const e = find(id);
      return e?.type === 'image' && e.role === 'sticker' ? e : null;
    };
    tools.push(
      tool('list_stickers', "List stickers to put on the design: the owner's own first, then this category's; search looks through all by name or tag.", { search: z.string().max(40).optional() }, async ({ search }) => {
        const found = [...own.filter((i) => !search || i.name.includes(search)), ...stickersFor(library, s.topic ?? null, search)].slice(0, 40);
        return ok(JSON.stringify(found.map((i) => ({ asset_id: i.id, name: i.name, tags: i.tags, own: !!i.ownSticker }))));
      }),
      tool('add_sticker', 'Put a sticker on the design, in a free place. Returns its id.', { asset_id: z.string() }, async ({ asset_id }) => {
        const asset = [...own, ...library].find((i) => i.id === asset_id);
        if (!asset) return fail('Unknown sticker; see list_stickers.');
        if (s.doc.elements.filter((e) => e.type === 'image' && e.role === 'sticker').length >= MAX_STICKERS) return fail(`At most ${MAX_STICKERS} stickers on a design.`);
        s.doc = placeSticker(s.doc, { assetId: asset.id, width: asset.width, height: asset.height });
        s.changed = true;
        return ok(JSON.stringify({ id: s.doc.elements.at(-1)!.id }));
      }),
      tool(
        'change_sticker',
        'Move, resize (w_mm; it keeps its shape) or turn a sticker already on the design.',
        { id: z.string(), x_mm: z.number().optional(), y_mm: z.number().optional(), w_mm: z.number().min(3).max(2000).optional(), rotation: z.number().min(-360).max(360).optional() },
        async ({ id, x_mm, y_mm, w_mm, rotation }) => {
          const e = stickerAt(id);
          if (!e) return fail(`No sticker with id ${id}`);
          patch(id, {
            ...(x_mm !== undefined && { x_mm }),
            ...(y_mm !== undefined && { y_mm }),
            ...(rotation !== undefined && { rotation }),
            ...(w_mm !== undefined && { w_mm, h_mm: (e.h_mm / e.w_mm) * w_mm }),
          } as Partial<CanvasElement>);
          return ok('done');
        },
      ),
      tool('remove_sticker', 'Take a sticker off the design.', { id: z.string() }, async ({ id }) => {
        if (!stickerAt(id)) return fail(`No sticker with id ${id}`);
        s.doc = { ...s.doc, elements: s.doc.elements.filter((e) => e.id !== id).map((e, i) => ({ ...e, z: i })) };
        s.changed = true;
        return ok('done');
      }),
    );
  }

  if (!full && s.free) {
    const fonts = s.free.fonts;
    const ownText = (id: string) => {
      const e = find(id);
      return e?.type === 'text' && e.own ? e : null;
    };
    const pictures = () => {
      const current = s.doc.elements.find((e) => e.type === 'image' && e.role === 'photo');
      const category = current?.type === 'image' ? s.images.find((i) => i.id === current.asset_id)?.categoryId : undefined;
      return s.images.filter((i) => !i.removed && !i.sticker && !i.ownSticker && (i.categoryId.startsWith('brand:') || i.categoryId === category));
    };
    tools.push(
      tool(
        'add_own_text',
        `Add a text of the owner's own to the ad, for what its fields have no place for. Fonts: ${fonts.join(', ')}. Returns its id.`,
        { text: z.string().max(500), font: z.enum(fonts as [string, ...string[]]).optional(), size_pt: z.number().min(6).max(200).optional(), color: color.optional() },
        async ({ text, font, size_pt, color }) => {
          if (s.doc.elements.filter((e) => e.type === 'text' && e.own).length >= MAX_OWN_TEXTS) return fail(`At most ${MAX_OWN_TEXTS} own texts on an ad.`);
          const base = newText(s.doc, text);
          push({ ...base, own: true, label: 'טקסט שלי', font: { family: font ?? fonts[0], weight: 700, size_pt: size_pt ?? Math.round(s.doc.page.width_mm / 5), color: color ?? '#111111' } });
          return ok(JSON.stringify({ id: base.id }));
        },
      ),
      tool(
        'style_own_text',
        `Change the font, size or weight of the owner's own text. Fonts: ${fonts.join(', ')}.`,
        { id: z.string(), font: z.enum(fonts as [string, ...string[]]).optional(), size_pt: z.number().min(6).max(200).optional(), bold: z.boolean().optional() },
        async ({ id, font, size_pt, bold }) => {
          const e = ownText(id);
          if (!e) return fail("That isn't one of the owner's own texts.");
          patch(id, { font: { ...e.font, ...(font && { family: font }), ...(size_pt && { size_pt }), ...(bold !== undefined && { weight: bold ? 700 : 400 }) } } as Partial<CanvasElement>);
          return ok('done');
        },
      ),
      tool('remove_own_text', "Delete one of the owner's own texts.", { id: z.string() }, async ({ id }) => {
        if (!ownText(id)) return fail("That isn't one of the owner's own texts.");
        s.doc = { ...s.doc, elements: s.doc.elements.filter((e) => e.id !== id).map((e, i) => ({ ...e, z: i })) };
        s.changed = true;
        return ok('done');
      }),
      tool('list_pictures', "List the pictures that can go in the ad's photo place: the owner's own and the library's.", {}, async () =>
        ok(JSON.stringify(pictures().map((i) => ({ asset_id: i.id, name: i.name, own: i.categoryId.startsWith('brand:') })))),
      ),
      tool('set_photo', "Put a picture (asset_id, see list_pictures) or a flat colour (color) in the ad's photo place.", { asset_id: z.string().optional(), color: color.optional() }, async ({ asset_id, color }) => {
        const place = s.doc.elements.find((e) => e.type === 'image' && e.role === 'photo');
        if (!place) return fail('This ad has no photo place.');
        if (color) {
          patch(place.id, { colorOverride: color } as Partial<CanvasElement>);
          return ok('done');
        }
        const asset = pictures().find((i) => i.id === asset_id);
        if (!asset) return fail('Unknown picture; see list_pictures.');
        s.doc = placePhoto(s.doc, { assetId: asset.id, width: asset.width, height: asset.height });
        s.changed = true;
        return ok('done');
      }),
      tool('change_size', `Open this ad in another size, as a new design. Do this last. Sizes: ${(s.sizes ?? []).join(', ') || 'none'} (${AD_FORMATS.map((f) => `${f.id}: ${f.label}`).join('; ')}).`, { format: z.string() }, async ({ format }) => {
        if (!s.sizes?.includes(format)) return fail('This ad does not come in that size.');
        s.openSize = format;
        return ok('done');
      }),
    );
    if (hasProducts(s.doc)) {
      tools.push(
        tool('list_products', "List the owner's catalog, for an ad of several products.", {}, async () =>
          ok(JSON.stringify((s.items ?? []).map((i) => ({ id: i.id, name: i.name, price: i.price, on_ad: !!s.doc.productIds?.includes(i.id) })))),
        ),
        tool('set_products', `Choose which catalog items are on the ad, in order, up to ${MAX_PRODUCTS}. Replaces the current choice.`, { ids: z.array(z.string()).max(MAX_PRODUCTS) }, async ({ ids }) => {
          const list = ids.flatMap((id) => s.items?.find((i) => i.id === id) ?? []);
          s.doc = applyProducts(s.doc, list);
          s.changed = true;
          return ok(JSON.stringify({ placed: list.length }));
        }),
      );
    }
  }

  if (full) {
    tools.push(
      tool('list_library', 'List image categories and images that can be added to the card.', {}, async () =>
        ok(JSON.stringify({ categories: s.categories.map((c) => ({ id: c.id, name: c.name })), images: s.images.map((i) => ({ asset_id: i.id, name: i.name, categoryId: i.categoryId, width: i.width, height: i.height })) })),
      ),
      tool('add_text', 'Add a text element. Returns its id. Customers can edit it unless editable=false.', { text: z.string().max(2000), label: z.string().max(60).optional(), editable: z.boolean().optional() }, async ({ text, label, editable }) => {
        const el = newText(s.doc, text);
        if (label !== undefined) el.label = label;
        if (editable !== undefined) el.editable = editable;
        push(el);
        return ok(JSON.stringify({ id: el.id }));
      }),
      tool('add_rect', 'Add a rectangle. Returns its id.', {}, async () => {
        const el = newRect(s.doc);
        push(el);
        return ok(JSON.stringify({ id: el.id }));
      }),
      tool('add_image', 'Add a library image (see list_library). Returns its id.', { asset_id: z.string() }, async ({ asset_id }) => {
        const asset = s.images.find((i) => i.id === asset_id);
        if (!asset) return fail('Unknown asset_id');
        const el = newImage(s.doc, asset);
        push(el);
        return ok(JSON.stringify({ id: el.id }));
      }),
      tool(
        'update_element',
        `Change properties of any element. Fonts: ${FONTS.join(', ')}. Sizes in mm, font size in pt. A text's arc bends its line onto a circle: 100 is a half circle with its middle at the top (a rainbow), -100 one with its middle at the bottom, 0 a straight line; a gentle arch is about 30.`,
        {
          id: z.string(),
          x_mm: z.number().optional(),
          y_mm: z.number().optional(),
          w_mm: z.number().min(1).max(2000).optional(),
          h_mm: z.number().min(1).max(2000).optional(),
          rotation: z.number().min(-360).max(360).optional(),
          fill: color.optional(),
          align: z.enum(['right', 'center', 'left']).optional(),
          arc: z.number().min(-100).max(100).optional(),
          font_family: z.enum(FONTS).optional(),
          font_size_pt: z.number().min(4).max(400).optional(),
          font_weight: z.union([z.literal(400), z.literal(700)]).optional(),
          editable: z.boolean().optional(),
          label: z.string().max(60).optional(),
          swappable: z.boolean().optional(),
          swap_category_id: z.string().optional(),
        },
        async ({ id, font_family, font_size_pt, font_weight, swap_category_id, ...rest }) => {
          const e = find(id);
          if (!e) return fail(`No element with id ${id}`);
          const p: Record<string, unknown> = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
          if (e.type === 'text') {
            delete p.h_mm;
            delete p.fill;
            delete p.swappable;
            if (font_family || font_size_pt || font_weight) {
              p.font = { ...e.font, ...(font_family && { family: font_family }), ...(font_size_pt && { size_pt: font_size_pt }), ...(font_weight && { weight: font_weight }) };
            }
          } else {
            delete p.align;
            delete p.editable;
            delete p.arc;
          }
          if (e.type === 'rect') {
            delete p.label;
            delete p.swappable;
          }
          if (e.type === 'image' && swap_category_id) p.swapCategoryId = swap_category_id;
          patch(id, p as Partial<CanvasElement>);
          return ok('done');
        },
      ),
      tool('delete_element', 'Delete an element.', { id: z.string() }, async ({ id }) => {
        if (!find(id)) return fail(`No element with id ${id}`);
        s.doc = { ...s.doc, elements: s.doc.elements.filter((e) => e.id !== id).map((e, i) => ({ ...e, z: i })) };
        s.changed = true;
        return ok('done');
      }),
      tool('reorder_element', 'Move an element to the front (top) or back (bottom) of the layer stack.', { id: z.string(), to: z.enum(['front', 'back']) }, async ({ id, to }) => {
        const e = find(id);
        if (!e) return fail(`No element with id ${id}`);
        const rest = s.doc.elements.filter((x) => x.id !== id);
        const els = to === 'front' ? [...rest, e] : [e, ...rest];
        s.doc = { ...s.doc, elements: els.map((x, i) => ({ ...x, z: i })) };
        s.changed = true;
        return ok('done');
      }),
      tool(
        'set_page',
        `Change the page background colour and/or size preset (${PAGE_PRESETS.map((p) => p.id).join(', ')}).`,
        { background: color.optional(), preset: z.enum(PAGE_PRESETS.map((p) => p.id) as [string, ...string[]]).optional() },
        async ({ background, preset }) => {
          const p = PAGE_PRESETS.find((x) => x.id === preset);
          s.doc = { ...s.doc, page: { ...s.doc.page, ...(background && { background }), ...(p && { width_mm: p.width_mm, height_mm: p.height_mm }) } };
          s.changed = true;
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
