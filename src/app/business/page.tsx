import type { Metadata } from 'next';
import { Landing } from '@/components/Landing';

export const metadata: Metadata = { title: 'סטודיו עיצוב לעסקים', description: 'מודעות, לוגואים, כרטיסי ביקור ופוסטים לעסק שלך' };

/** the business door of the home page; `/` is the private-celebrations door */
export default function BusinessHome() {
  return <Landing audience="business" />;
}
