// Which entry path this owner chose ("Start from zero" or "I already have a business"). Kept in a cookie until the backend stores it on the business.
import { cookies } from 'next/headers';
import { isBusinessPath, type BusinessPath } from '../../../../lib/aimp/home/path';

export const PATH_COOKIE = 'aimp_path';

/** The saved choice, or null when the owner has not picked yet. Server only. */
export async function readPath(): Promise<BusinessPath | null> {
  const v = (await cookies()).get(PATH_COOKIE)?.value;
  return isBusinessPath(v) ? v : null;
}
