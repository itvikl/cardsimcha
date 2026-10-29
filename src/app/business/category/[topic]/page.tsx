import type { Metadata } from 'next';
import { CategoryView } from '@/components/CategoryView';
import { decodeTopic } from '@/lib/categories';

type Props = { params: Promise<{ topic: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `${decodeTopic((await params).topic)} · סטודיו עיצוב לעסקים` };
}

/** a business category's designs: under /business so the page keeps that door's theme */
export default async function BusinessCategoryPage({ params }: Props) {
  return <CategoryView topic={decodeTopic((await params).topic)} audience="business" />;
}
