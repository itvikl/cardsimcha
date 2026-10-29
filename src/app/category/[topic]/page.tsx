import type { Metadata } from 'next';
import { CategoryView } from '@/components/CategoryView';
import { decodeTopic } from '@/lib/categories';

type Props = { params: Promise<{ topic: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `${decodeTopic((await params).topic)} · סטודיו עיצוב` };
}

/** a category's designs, on the private side; business categories are under /business/category */
export default async function CategoryPage({ params }: Props) {
  return <CategoryView topic={decodeTopic((await params).topic)} audience="private" />;
}
