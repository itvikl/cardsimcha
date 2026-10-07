import { NextResponse } from 'next/server';
import { getUser, publicUser } from '@/lib/auth';
import { AUTH_DISABLED } from '@/lib/config';

export const dynamic = 'force-dynamic';

export async function GET() {
  const u = await getUser();
  return NextResponse.json(u ? { ...publicUser(u), authDisabled: AUTH_DISABLED } : null);
}
