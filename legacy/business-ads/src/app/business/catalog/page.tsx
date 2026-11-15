import type { Metadata } from 'next';
import { CatalogForm } from '@/components/CatalogForm';

export const metadata: Metadata = { title: 'הקטלוג של העסק · סטודיו עיצוב לעסקים', description: 'מוצרים ושירותים של העסק, מוכנים למודעה' };

/** under /business so the page keeps that door's theme; signing in is required (see isPublic in Auth.tsx) */
export default function CatalogPage() {
  return <CatalogForm />;
}
