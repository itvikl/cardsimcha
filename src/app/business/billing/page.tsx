import type { Metadata } from 'next';
import { BillingPlan } from '@/components/BillingPlan';

export const metadata: Metadata = { title: 'התוכנית שלי · סטודיו עיצוב לעסקים' };

/** under /business so the page keeps that door's theme; signing in is required (see isPublic in Auth.tsx) */
export default function BillingPage() {
  return <BillingPlan />;
}
