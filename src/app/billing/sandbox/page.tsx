import type { Metadata } from 'next';
import { SandboxCheckout } from '@/components/SandboxCheckout';

export const metadata: Metadata = { title: 'תשלום לדוגמה · סטודיו עיצוב' };

type Props = { searchParams: Promise<{ purchase?: string }> };

/** Stands in for a provider's payment page while no real provider is connected; its API answers only in the sandbox. */
export default async function SandboxPage({ searchParams }: Props) {
  return <SandboxCheckout purchaseId={(await searchParams).purchase ?? ''} />;
}
