'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { isBusinessPath } from '../../../../lib/aimp/home/path';
import { PATH_COOKIE } from './path-store';

/** Saves the first-screen choice, then goes to Home. `path` is checked; anything else is ignored. */
export async function choosePath(business: string, formData: FormData): Promise<void> {
  const path = formData.get('path');
  if (!isBusinessPath(path) || !/^[\w-]{1,80}$/.test(business)) return;
  (await cookies()).set(PATH_COOKIE, path, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax', httpOnly: true });
  redirect(`/app/${business}`);
}
