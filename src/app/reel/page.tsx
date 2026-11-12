import type { Metadata } from 'next';
import { ReelView } from '@/components/ReelView';

export const metadata: Metadata = {
  title: 'סליל העיצובים · סטודיו עיצוב',
  // a prototype: reachable by its address only, until it's chosen for the home page
  robots: { index: false, follow: false },
};

export default function ReelPage() {
  return <ReelView />;
}
