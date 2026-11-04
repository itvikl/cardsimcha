/** The sizes an ad comes in: for sending on a phone, and for printing. */
export type AdMedium = 'digital' | 'print';
export type AdFormat = { id: string; label: string; medium: AdMedium; width_mm: number; height_mm: number };

export const AD_FORMATS: AdFormat[] = [
  { id: 'status', label: 'סטטוס', medium: 'digital', width_mm: 108, height_mm: 192 },
  { id: 'post', label: 'פוסט', medium: 'digital', width_mm: 200, height_mm: 200 },
  { id: 'a4', label: 'A4', medium: 'print', width_mm: 210, height_mm: 297 },
  { id: 'a5', label: 'A5', medium: 'print', width_mm: 148, height_mm: 210 },
  { id: 'a6', label: 'רבע עמוד', medium: 'print', width_mm: 105, height_mm: 148 },
];

export const MEDIUM_LABEL: Record<AdMedium, string> = { digital: 'לשליחה בטלפון', print: 'לדפוס' };

export const formatById = (id: unknown) => AD_FORMATS.find((f) => f.id === id);
export const formatOfPage = (width_mm: number, height_mm: number) => AD_FORMATS.find((f) => f.width_mm === width_mm && f.height_mm === height_mm);
