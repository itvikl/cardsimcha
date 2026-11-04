import type { BrandColorRole, BrandDetail, BrandKit, BrandTextRole, BusinessProfile, CanvasDoc, CanvasElement, ImageAsset } from './types';

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
  { id: 'initial', label: 'האות הראשונה של שם העסק' },
];

export const BRAND_COLOR_ROLES: { id: BrandColorRole; label: string }[] = [
  { id: 'primaryColor', label: 'צבע ראשי' },
  { id: 'secondaryColor', label: 'צבע משני' },
  { id: 'onPrimary', label: 'שחור או לבן, מה שקריא על הצבע הראשי' },
  { id: 'onSecondary', label: 'שחור או לבן, מה שקריא על הצבע המשני' },
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

export type BrandFields = Pick<BrandKit, BrandDetail | 'primaryColor' | 'secondaryColor' | 'profile'>;

/** what a business tells about itself; the system writes ads from these and invents nothing beyond them */
export const PROFILE_FIELDS: { key: keyof BusinessProfile; label: string; placeholder: string }[] = [
  { key: 'services', label: 'מה העסק עושה', placeholder: 'למשל: התקנה, ניקוי ותיקון מזגנים לבתים ולמשרדים' },
  { key: 'area', label: 'אזורי שירות', placeholder: 'למשל: ירושלים והסביבה, בני ברק' },
  { key: 'experience', label: 'ותק וניסיון', placeholder: 'למשל: 12 שנה בתחום' },
  { key: 'promise', label: 'למה לבחור בכם', placeholder: 'למשל: מגיעים באותו יום, עובדים נקי' },
  { key: 'reviews', label: 'המלצות אמיתיות של לקוחות', placeholder: 'כותבים רק המלצות שקיבלתם בפועל' },
];

const parseProfile = (v: unknown): BusinessProfile => {
  const p = (v ?? {}) as Record<string, unknown>;
  const text = (k: keyof BusinessProfile) => (typeof p[k] === 'string' ? p[k].trim().slice(0, 400) : '');
  return { services: text('services'), area: text('area'), experience: text('experience'), promise: text('promise'), reviews: text('reviews') };
};

const LIMITS: Record<BrandDetail, number> = { businessName: 80, phone: 30, slogan: 120, address: 120, website: 120 };

/** The kit's fields from a request, or the reason they can't be saved. */
export function parseBrand(body: unknown): BrandFields | string {
  const b = (body ?? {}) as Record<string, unknown>;
  const text = (k: BrandDetail) => (typeof b[k] === 'string' ? b[k].trim().slice(0, LIMITS[k]) : '');
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
    profile: parseProfile(b.profile),
  };
}

/* ------------------------------------------------------------------ logos */

/** Logos are stored as library images of the owner's private "category", so the editor draws them like any picture. */
export const brandCategory = (userId: string) => `brand:${userId}`;

/** The library as one user may see it: everything except other businesses' logos. */
export const visibleImages = (images: ImageAsset[], userId: string) =>
  images.filter((i) => !i.categoryId.startsWith('brand:') || i.categoryId === brandCategory(userId));

/* ------------------------------------------------------------------ the kit -> a design */

/** black or white, whichever has the stronger contrast on `hex` (WCAG relative luminance) */
export function readableOn(hex: string): string {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return l > 0.179 ? '#111111' : '#FFFFFF';
}

export const brandText = (brand: BrandKit, role: BrandTextRole) => (role === 'initial' ? Array.from(brand.businessName.trim())[0] ?? '' : brand[role]);

export type BrandColors = Pick<BrandKit, 'primaryColor' | 'secondaryColor'>;

/** two colours from a request, or null */
export const parseColors = (v: unknown): BrandColors | null => {
  const c = (v ?? {}) as Record<string, unknown>;
  return isColor(c.primaryColor) && isColor(c.secondaryColor) ? { primaryColor: c.primaryColor, secondaryColor: c.secondaryColor } : null;
};

export function brandColor(brand: BrandColors, role: BrandColorRole): string {
  if (role === 'onPrimary') return readableOn(brand.primaryColor);
  if (role === 'onSecondary') return readableOn(brand.secondaryColor);
  return brand[role];
}

/** whether a brand kit would change anything on this design */
export const hasBrandRoles = (doc: CanvasDoc) =>
  doc.elements.some((e) => (e.type === 'text' ? e.role || e.colorRole : e.type === 'image' ? e.role === 'logo' : e.colorRole || e.role));

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
            text: e.role ? brandText(brand, e.role) : e.text,
            font: e.colorRole ? { ...e.font, color: brandColor(brand, e.colorRole) } : e.font,
          },
        ];
      }
      if (e.type === 'rect') {
        if (e.role === 'logoPlate' && !brand.logo) return [];
        return [e.colorRole ? { ...e, fill: brandColor(brand, e.colorRole) } : e];
      }
      if (e.role !== 'logo') return [e];
      if (!brand.logo) return [];
      const { colorOverride: _old, ...rest } = e;
      void _old;
      return [{ ...rest, ...fitLogo(e, brand.logo), asset_id: brand.logo.assetId, swappable: false }];
    }),
  };
}

/** only the colours: an event's own colours on a simcha's set, with no business behind it */
export const applyColors = <D extends CanvasDoc>(doc: D, colors: BrandColors): D => ({
  ...doc,
  elements: doc.elements.map((e) => {
    if (e.type === 'text' && e.colorRole) return { ...e, font: { ...e.font, color: brandColor(colors, e.colorRole) } };
    if (e.type === 'rect' && e.colorRole) return { ...e, fill: brandColor(colors, e.colorRole) };
    return e;
  }),
});

/** the same, ready for renderCard: the logo also carries the URL of its picture (never saved on a design) */
export function brandPreview<D extends CanvasDoc>(doc: D, brand: BrandKit): D {
  const applied = applyBrand(doc, brand);
  const logo = brand.logo;
  if (!logo) return applied;
  return { ...applied, elements: applied.elements.map((e) => (e.type === 'image' && e.role === 'logo' ? { ...e, src: `/api/uploads/${logo.file}` } : e)) };
}
