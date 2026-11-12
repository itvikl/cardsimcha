import type { Metadata } from 'next';
import { MarketingCalendar } from '@/components/MarketingCalendar';

export const metadata: Metadata = {
  title: 'לוח שיווק · סטודיו עיצוב לעסקים',
  description: 'מה כדאי לפרסם בכל חודש — לוח שנתי עם המלצות שיווקיות לעסק',
};

export default function CalendarPage() {
  return (
    <main style={{ maxWidth: 900, margin: '0 auto', padding: '2rem 1rem' }}>
      <MarketingCalendar />
    </main>
  );
}
