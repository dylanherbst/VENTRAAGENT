import type { MetadataRoute } from 'next';

function originOf(raw: string | undefined): string | null {
  try { return raw ? new URL(raw).origin : null; } catch { return null; }
}

// Platform robots (AMP-032): stores are crawlable, internal API and tool pages are not. The sitemap line appears only
// when an origin is configured (LAUNCHPAD_APP_ORIGIN); stores publish their own sitemap on their own host.
export default function robots(): MetadataRoute.Robots {
  const origin = originOf(process.env.LAUNCHPAD_APP_ORIGIN);
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/api/', '/tools/'] },
    ...(origin ? { sitemap: `${origin}/sitemap.xml` } : {}),
  };
}
