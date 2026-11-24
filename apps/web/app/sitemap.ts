import type { MetadataRoute } from 'next';
import { getDefaultRegistry } from '../lib/aimp/hosts/registry';
import { platformSitemapEntries } from '../lib/aimp/hosts/seo';

export const dynamic = 'force-dynamic';

// Platform sitemap (AMP-032): platform URLs only. In subdomain mode (AIMP_STORE_ROOT_DOMAIN set) every store serves its
// own /sitemap.xml on its own host and none are listed here. In path mode the live, indexable stores are listed at
// their canonical /s/<slug> URLs. Paused, unpublished and demo stores are never listed.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return platformSitemapEntries(await getDefaultRegistry(), process.env);
}
