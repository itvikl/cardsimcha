import type { Metadata } from 'next';
import { AlbumView } from '@/components/AlbumView';

export const metadata: Metadata = {
  title: 'אלבום העיצובים · סטודיו עיצוב',
  // a prototype: reachable by its address only, until it replaces the ring on the home page
  robots: { index: false, follow: false },
};

export default function AlbumPage() {
  return <AlbumView />;
}
