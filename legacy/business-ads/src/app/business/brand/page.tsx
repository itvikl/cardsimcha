import type { Metadata } from 'next';
import { BrandKitForm } from '@/components/BrandKitForm';

export const metadata: Metadata = { title: 'המיתוג של העסק · סטודיו עיצוב לעסקים', description: 'לוגו, צבעים ופרטי העסק, פעם אחת, על כל העיצובים' };

/** under /business so the page keeps that door's theme; signing in is required (see isPublic in Auth.tsx) */
export default function BrandPage() {
  return <BrandKitForm />;
}
