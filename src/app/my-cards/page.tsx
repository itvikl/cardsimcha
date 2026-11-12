import type { Metadata } from 'next';
import { Basket } from '@/components/Basket';

export const metadata: Metadata = { title: 'הסלסלה שלי · סטודיו עיצוב' };

/** the customer's cards, reached only from the basket in the top bar */
export default function MyCards() {
  return <Basket />;
}
