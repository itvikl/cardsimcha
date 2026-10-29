/** Hebrew numerals (gematria) for 1-999, the way dates are written: 15 and 16 as ט״ו and ט״ז, a geresh or gershayim mark. */
export function gematria(n: number): string {
  const ones = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
  const tens = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
  const hundreds = ['', 'ק', 'ר', 'ש', 'ת', 'תק', 'תר', 'תש', 'תת', 'תתק'];
  let s = hundreds[Math.floor(n / 100) % 10];
  const rest = n % 100;
  s += rest === 15 ? 'טו' : rest === 16 ? 'טז' : tens[Math.floor(rest / 10)] + ones[rest % 10];
  return s.length === 1 ? `${s}׳` : `${s.slice(0, -1)}״${s.slice(-1)}`;
}

export type HebrewDate = { day: string; month: string; year: string; weekday: string; full: string };

/** A civil date (YYYY-MM-DD) in the Hebrew calendar, as an invitation writes it: י״א באדר א׳ תשפ״ז, יום חמישי. */
export function hebrewDate(iso: string): HebrewDate | null {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('he-u-ca-hebrew', { day: 'numeric', month: 'long', year: 'numeric' }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const day = gematria(Number(get('day')));
  const month = get('month');
  // the thousands are left out, as in תשפ״ז
  const year = gematria(Number(get('year')) % 1000);
  const weekday = new Intl.DateTimeFormat('he', { weekday: 'long' }).format(d);
  return { day, month, year, weekday, full: `${day} ב${month} ${year}` };
}
