/** the light the whole site takes on for a simcha (see .site-backdrop in globals.css) */
export type Mood = 'candle' | 'dawn' | 'gold' | 'evening';

/** the simchas with a light of their own; any other category is gold */
const MOODS: Record<string, Mood> = {
  'חתונה': 'candle',
  'אירוסין': 'candle',
  'שלום זכר': 'evening',
  'וואך נאכט': 'evening',
  'חנוכת הבית': 'evening',
  'בית כנסת': 'evening',
  'שמחת בית השואבה': 'evening',
  'ברית': 'dawn',
  'פדיון הבן': 'dawn',
  'לידת בן': 'dawn',
  'לידת בת': 'dawn',
  'איחולים': 'dawn',
};

export const moodOf = (category: string): Mood => MOODS[category] ?? 'gold';
