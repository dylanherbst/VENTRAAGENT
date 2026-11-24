import { getDefaultRegistry } from '../../../../lib/aimp/hosts/registry';
import { renderStoreSitemap } from '../../../../lib/aimp/hosts/seo';

export const dynamic = 'force-dynamic';

// Per-store sitemap: home, product pages, policies and contact of a PUBLISHED, live store, using the same check the
// pages use. Anything else is a plain 404. With the demo registry (both stores are noindex demos) this is a 404 today;
// it fills in once a DB-backed registry replaces the demo one.
export async function GET(_req: Request, { params }: { params: Promise<{ store: string }> }) {
  const { store } = await params;
  const xml = await renderStoreSitemap(await getDefaultRegistry(), store, process.env);
  if (xml === null) return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
  return new Response(xml, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=300' } });
}
