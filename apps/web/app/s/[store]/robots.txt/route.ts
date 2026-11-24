import { getDefaultRegistry } from '../../../../lib/aimp/hosts/registry';
import { storeRobotsTxt } from '../../../../lib/aimp/hosts/seo';

export const dynamic = 'force-dynamic';

// Per-store robots.txt (crawlers read it on the store's own host). Live indexable stores are allowed and point at their
// sitemap; unpublished, paused and demo stores are disallowed.
export async function GET(_req: Request, { params }: { params: Promise<{ store: string }> }) {
  const { store } = await params;
  const body = await storeRobotsTxt(await getDefaultRegistry(), store, process.env);
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=300' } });
}
