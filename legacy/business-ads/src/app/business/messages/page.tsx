import type { Metadata } from 'next';
import { AdMessages } from '@/components/AdMessages';

export const metadata: Metadata = { title: 'הודעות פרסום · סטודיו עיצוב לעסקים', description: 'נוסחים מוכנים לכל מקצוע, עם הפרטים של העסק, להעתקה ולשליחה' };

type Props = { searchParams: Promise<{ topic?: string }> };

/** under /business so the page keeps that door's theme; signing in is required (see isPublic in Auth.tsx) */
export default async function MessagesPage({ searchParams }: Props) {
  return <AdMessages initialTopic={(await searchParams).topic} />;
}
