import type { CanvasDoc, ShabbatTextRole } from './types';

/** The category of weekly Shabbat times on the business door. */
export const SHABBAT_TOPIC = 'זמני שבת';

export type ShabbatTimes = {
  cityId: string;
  city: string;
  /** YYYY-MM-DD */
  friday: string;
  parsha: string;
  /** "16:21" */
  candles: string;
  havdalah: string;
  hebrewDate: string;
  /** the moment of candle-lighting, ISO */
  candlesAt: string;
};

/**
 * Cities and their customs: minutes of candle-lighting before sunset, and of havdalah after it.
 * A first draft from common practice, to be approved by the client's halachic authority before launch.
 */
export const SHABBAT_CITIES: { id: string; name: string; lat: number; lon: number; candleMins: number; havdalahMins: number }[] = [
  { id: 'jerusalem', name: 'ירושלים', lat: 31.7683, lon: 35.2137, candleMins: 40, havdalahMins: 40 },
  { id: 'bnei-brak', name: 'בני ברק', lat: 32.0807, lon: 34.8338, candleMins: 30, havdalahMins: 42 },
  { id: 'tel-aviv', name: 'תל אביב', lat: 32.0853, lon: 34.7818, candleMins: 20, havdalahMins: 42 },
  { id: 'haifa', name: 'חיפה', lat: 32.794, lon: 34.9896, candleMins: 30, havdalahMins: 42 },
  { id: 'petah-tikva', name: 'פתח תקווה', lat: 32.0871, lon: 34.8875, candleMins: 40, havdalahMins: 42 },
  { id: 'ashdod', name: 'אשדוד', lat: 31.8014, lon: 34.6435, candleMins: 30, havdalahMins: 42 },
  { id: 'netanya', name: 'נתניה', lat: 32.3215, lon: 34.8532, candleMins: 30, havdalahMins: 42 },
  { id: 'beer-sheva', name: 'באר שבע', lat: 31.253, lon: 34.7915, candleMins: 30, havdalahMins: 42 },
  { id: 'rishon', name: 'ראשון לציון', lat: 31.973, lon: 34.7925, candleMins: 30, havdalahMins: 42 },
  { id: 'modiin-illit', name: 'מודיעין עילית', lat: 31.9333, lon: 35.0417, candleMins: 40, havdalahMins: 42 },
  { id: 'beitar-illit', name: 'ביתר עילית', lat: 31.6969, lon: 35.1158, candleMins: 40, havdalahMins: 42 },
  { id: 'beit-shemesh', name: 'בית שמש', lat: 31.7497, lon: 34.9886, candleMins: 40, havdalahMins: 42 },
  { id: 'elad', name: 'אלעד', lat: 32.0522, lon: 34.9511, candleMins: 30, havdalahMins: 42 },
  { id: 'safed', name: 'צפת', lat: 32.9646, lon: 35.496, candleMins: 30, havdalahMins: 42 },
  { id: 'tiberias', name: 'טבריה', lat: 32.7922, lon: 35.5312, candleMins: 30, havdalahMins: 42 },
];

export const cityById = (id: unknown) => SHABBAT_CITIES.find((c) => c.id === id);

const SHABBAT_ROLES: ShabbatTextRole[] = ['parsha', 'candles', 'havdalah', 'city', 'hebrewDate'];
export const isShabbatRole = (v: unknown): v is ShabbatTextRole => SHABBAT_ROLES.includes(v as ShabbatTextRole);

export const hasShabbatRoles = (doc: CanvasDoc) => doc.elements.some((e) => e.type === 'text' && e.shabbatRole);

const VALUE: Record<ShabbatTextRole, (t: ShabbatTimes) => string> = {
  parsha: (t) => t.parsha,
  candles: (t) => t.candles,
  havdalah: (t) => t.havdalah,
  city: (t) => t.city,
  hebrewDate: (t) => t.hebrewDate,
};

/** The design with the week's times written in. */
export const applyShabbat = <D extends CanvasDoc>(doc: D, times: ShabbatTimes): D => ({
  ...doc,
  elements: doc.elements.map((e) => (e.type === 'text' && e.shabbatRole ? { ...e, text: VALUE[e.shabbatRole](times) } : e)),
});
