import { headers } from 'next/headers';
import { STORE_HOST_HEADER } from '../../../../lib/aimp/hosts/resolve';

/**
 * Link prefix: '' when the visitor is on the store's own host, `/s/<slug>` when previewed on the app host.
 * Reads ONLY the header proxy.ts sets after it resolved the host (it strips any client-sent copy), so the answer
 * always agrees with the proxy and can not be spoofed. It only changes link paths, never data access.
 */
export async function storeBase(slug: string): Promise<string> {
  const h = await headers();
  return h.get(STORE_HOST_HEADER) === slug ? '' : `/s/${slug}`;
}
