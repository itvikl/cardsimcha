import * as fontkit from 'fontkit';

export type FontFormat = 'ttf' | 'otf' | 'woff' | 'woff2';

export const FONT_MIME: Record<FontFormat, string> = {
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2',
};

export type ParsedFont = {
  format: FontFormat;
  family: string;
  weight: number;
  style: 'normal' | 'italic';
  /** CSS unicode-range of the characters the font has, e.g. "U+20-7E,U+5D0-5EA" */
  unicodeRanges: string;
  hebrew: boolean;
};

/** The first four bytes say what the file is; anything else is not accepted as a font. */
function sniff(buf: Buffer): FontFormat | null {
  if (buf.length < 12) return null;
  const tag = buf.toString('latin1', 0, 4);
  if (tag === 'wOFF') return 'woff';
  if (tag === 'wOF2') return 'woff2';
  if (tag === 'OTTO') return 'otf';
  if (tag === 'true' || buf.readUInt32BE(0) === 0x00010000) return 'ttf';
  return null;
}

function ranges(codePoints: number[]) {
  const cps = [...new Set(codePoints)].filter((c) => c > 0).sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < cps.length; ) {
    let j = i;
    while (j + 1 < cps.length && cps[j + 1] === cps[j] + 1) j++;
    const hex = (n: number) => n.toString(16).toUpperCase();
    out.push(i === j ? `U+${hex(cps[i])}` : `U+${hex(cps[i])}-${hex(cps[j])}`);
    i = j + 1;
  }
  return out.join(',');
}

/**
 * Reads a TTF, OTF, WOFF or WOFF2 file: its family name, weight, style and character set.
 * Throws an Error with a Hebrew message when the file is not a usable single font.
 */
export function parseFont(buf: Buffer): ParsedFont {
  const format = sniff(buf);
  if (!format) throw new Error('הקובץ אינו פונט (TTF, OTF, WOFF או WOFF2)');
  let font: fontkit.Font;
  try {
    const f = fontkit.create(buf) as fontkit.Font | fontkit.FontCollection;
    if ('fonts' in f) throw new Error('collection');
    font = f;
    // touch the tables we rely on, so a corrupt file fails here and not later in a browser
    void font.characterSet.length;
  } catch {
    throw new Error('לא ניתן לקרוא את קובץ הפונט');
  }
  const os2 = (font as unknown as { 'OS/2'?: { usWeightClass?: number; fsSelection?: { italic?: boolean } } })['OS/2'];
  const named = (font as unknown as { getName?: (k: string) => string | null }).getName?.('preferredFamily');
  const family = (named || font.familyName || '').trim();
  const rawWeight = os2?.usWeightClass ?? 400;
  const weight = Math.min(900, Math.max(100, Math.round(rawWeight / 100) * 100));
  const italic = !!os2?.fsSelection?.italic || font.italicAngle !== 0 || /italic|oblique/i.test(font.subfamilyName ?? '');
  const hebrew = [0x5d0, 0x5d1, 0x5e9, 0x5ea].every((c) => font.hasGlyphForCodePoint(c));
  return { format, family, weight, style: italic ? 'italic' : 'normal', unicodeRanges: ranges(font.characterSet), hebrew };
}
