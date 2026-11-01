import type { BrandColorRole, BrandKit, BrandTextRole, CanvasDoc, CanvasElement, ImageAsset } from './types';

/**
 * A business's brand kit, and how it reaches a design: an admin tags a template's elements with a role
 * (this text is the phone, this image is the logo), and a business's copy takes those from its kit.
 */

export const BRAND_TEXT_ROLES: { id: BrandTextRole; label: string }[] = [
  { id: 'businessName', label: 'שם העסק' },
  { id: 'phone', label: 'טלפון' },
  { id: 'slogan', label: 'סלוגן' },
  { id: 'address', label: 'כתובת' },
  { id: 'website', label: 'אתר' },
];

export const BRAND_COLOR_ROLES: { id: BrandColorRole; label: string }[] = [
  { id: 'primaryColor', label: 'צבע ראשי' },
  { id: 'secondaryColor', label: 'צבע משני' },
];

export const isBrandTextRole = (v: unknown): v is BrandTextRole => BRAND_TEXT_ROLES.some((r) => r.id === v);
export const isBrandColorRole = (v: unknown): v is BrandColorRole => BRAND_COLOR_ROLES.some((r) => r.id === v);

const isColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);

export const emptyBrand = (id: string): BrandKit => ({
  id,
  businessName: '',
  phone: '',
  slogan: '',
  address: '',
  website: '',
  primaryColor: '#14336B',
  secondaryColor: '#E8A33D',
  updatedAt: new Date().toISOString(),
});

export type BrandFields = Pick<BrandKit, BrandTextRole | BrandColorRole>;

const LIMITS: Record<BrandTextRole, number> = { businessName: 80, phone: 30, slogan: 120, address: 120, website: 120 };

/** The kit's fields from a request, or the reason they can't be saved. */
export function parseBrand(body: unknown): BrandFields | string {
  const b = (body ?? {}) as Record<string, unknown>;
  const text = (k: BrandTextRole) => (typeof b[k] === 'string' ? b[k].trim().slice(0, LIMITS[k]) : '');
  if (!text('businessName')) return 'שם העסק חובה';
  if (!/^[0-9+\-() ]*$/.test(text('phone'))) return 'מספר הטלפון לא תקין';
  if (!isColor(b.primaryColor) || !isColor(b.secondaryColor)) return 'צבע לא תקין';
  return {
    businessName: text('businessName'),
    phone: text('phone'),
    slogan: text('slogan'),
    address: text('address'),
    website: text('website'),
    primaryColor: b.primaryColor,
    secondaryColor: b.secondaryColor,
  };
}

/* ------------------------------------------------------------------ logos */

/** Logos are stored as library images of the owner's private "category", so the editor draws them like any picture. */
export const brandCategory = (userId: string) => `brand:${userId}`;

/** The library as one user may see it: everything except other businesses' logos. */
export const visibleImages = (images: ImageAsset[], userId: string) =>
  images.filter((i) => !i.categoryId.startsWith('brand:') || i.categoryId === brandCategory(userId));

/* ------------------------------------------------------------------ the kit -> a design */

/** whether a brand kit would change anything on this design */
export const hasBrandRoles = (doc: CanvasDoc) =>
  doc.elements.some((e) => (e.type === 'text' ? e.role || e.colorRole : e.type === 'image' ? e.role : e.colorRole));

/** the logo inside the element's box, whole and centred (a box's rotation turns around its top-left corner) */
function fitLogo(e: Extract<CanvasElement, { type: 'image' }>, logo: NonNullable<BrandKit['logo']>) {
  const scale = Math.min(e.w_mm / logo.width, e.h_mm / logo.height);
  const w = logo.width * scale;
  const h = logo.height * scale;
  const dx = (e.w_mm - w) / 2;
  const dy = (e.h_mm - h) / 2;
  const a = (e.rotation * Math.PI) / 180;
  return { x_mm: e.x_mm + dx * Math.cos(a) - dy * Math.sin(a), y_mm: e.y_mm + dx * Math.sin(a) + dy * Math.cos(a), w_mm: w, h_mm: h };
}

/**
 * The design with the kit written in. A detail the kit doesn't have empties its text, and no logo removes the
 * logo's place: a sample phone number or logo left on a business's ad would be wrong.
 */
export function applyBrand<D extends CanvasDoc>(doc: D, brand: BrandKit): D {
  return {
    ...doc,
    elements: doc.elements.flatMap((e): CanvasElement[] => {
      if (e.type === 'text') {
        return [
          {
            ...e,
            text: e.role ? brand[e.role] : e.text,
            font: e.colorRole ? { ...e.font, color: brand[e.colorRole] } : e.font,
          },
        ];
      }
      if (e.type === 'rect') return [e.colorRole ? { ...e, fill: brand[e.colorRole] } : e];
      if (e.role !== 'logo') return [e];
      if (!brand.logo) return [];
      const { colorOverride: _old, ...rest } = e;
      void _old;
      return [{ ...rest, ...fitLogo(e, brand.logo), asset_id: brand.logo.assetId, swappable: false }];
    }),
  };
}

/** the same, ready for renderCard: the logo also carries the URL of its picture (never saved on a design) */
export function brandPreview<D extends CanvasDoc>(doc: D, brand: BrandKit): D {
  const applied = applyBrand(doc, brand);
  const logo = brand.logo;
  if (!logo) return applied;
  return { ...applied, elements: applied.elements.map((e) => (e.type === 'image' && e.role === 'logo' ? { ...e, src: `/api/uploads/${logo.file}` } : e)) };
}
