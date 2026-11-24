import type { Metadata } from 'next';
import { parseAuthMode } from '../flow';
import { AccountForm } from './account-form';

export const metadata: Metadata = { title: 'Create your account' };

type Params = { [key: string]: string | string[] | undefined };

// Create account / sign in. The form posts to the existing auth endpoint (/api/workspace).
export default async function StartAccount({ searchParams }: { searchParams: Promise<Params> }) {
  const q = await searchParams;
  const mode = Array.isArray(q.mode) ? q.mode[0] : q.mode;
  return <AccountForm initialMode={parseAuthMode(mode)} />;
}
