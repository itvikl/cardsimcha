import { NextResponse } from 'next/server';
import { comingShabbat } from '@/lib/shabbat';
import { cityById } from '@/lib/shabbatDoc';

export const dynamic = 'force-dynamic';

/** The coming Shabbat's times for a city. Public like the gallery: the category page shows them before sign-in. */
export async function GET(req: Request) {
  const city = new URL(req.url).searchParams.get('city');
  if (!cityById(city)) return NextResponse.json({ error: 'עיר לא מוכרת' }, { status: 400 });
  const times = comingShabbat(city!);
  if (!times) return NextResponse.json({ error: 'לא הצלחנו לחשב את הזמנים' }, { status: 502 });
  return NextResponse.json(times);
}
