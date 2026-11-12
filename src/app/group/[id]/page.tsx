import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { GroupView } from '@/components/GroupView';
import { PRIVATE_GROUPS } from '@/lib/categories';

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const group = PRIVATE_GROUPS.find((g) => g.id === id);
  return { title: group ? `${group.name} · סטודיו עיצוב` : 'סטודיו עיצוב' };
}

/** the kinds of cards behind one of the private ring's three cards */
export default async function GroupPage({ params }: Props) {
  const { id } = await params;
  if (!PRIVATE_GROUPS.some((g) => g.id === id)) notFound();
  return <GroupView id={id} />;
}
