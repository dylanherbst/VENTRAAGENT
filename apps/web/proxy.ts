import { NextResponse, type NextRequest } from 'next/server';
import { legacyRedirect } from './lib/aimp/hosts/legacy';
import { growthRedirect } from './lib/aimp/growth/product';
import { requestHeadersFor, routeForHost } from './lib/aimp/hosts/resolve';

// Multi-tenant storefront routing (plan §D01/§D05, AMP-032). The decision itself is the pure `routeForHost`:
//  - `<slug>.<AIMP_STORE_ROOT_DOMAIN>` (or `<slug>.<AIMP_STORE_TEST_DOMAIN>` locally) is served from /s/<slug>, so a
//    store host can only ever reach its own store pages.
//  - With no store domain configured nothing changes. With one configured, a malformed host that mentions it gets a
//    plain 404 (no store data, not cached, not indexed); any other host passes through to the main app.
//  - The proxy tells pages which store host they are on with the `x-aimp-store-host` request header. A client-sent copy
//    is always stripped first, so the header can not be spoofed.
export function proxy(request: NextRequest) {
  const route = routeForHost(request.headers.get('host'), request.nextUrl.pathname, {
    AIMP_STORE_ROOT_DOMAIN: process.env.AIMP_STORE_ROOT_DOMAIN,
    AIMP_STORE_TEST_DOMAIN: process.env.AIMP_STORE_TEST_DOMAIN,
  });
  const headers = requestHeadersFor(request.headers, route);
  if (route.action === 'pass') {
    // Growth product: startup-only pages are parked and go to onboarding or Home (lib/aimp/growth/product.ts).
    const parked = growthRedirect(request.nextUrl.pathname);
    if (parked) return NextResponse.redirect(new URL(parked, request.url), 307);
    // Old VENTRA pages go to onboarding. See lib/aimp/hosts/legacy.ts.
    const to = legacyRedirect(request.nextUrl.pathname, request.headers.get('host'), { AIMP_SHOW_LEGACY: process.env.AIMP_SHOW_LEGACY });
    if (to) return NextResponse.redirect(new URL(to, request.url), 307);
    return NextResponse.next({ request: { headers } });
  }
  if (route.action === 'not_found') {
    return new NextResponse('Not found', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' },
    });
  }
  const url = request.nextUrl.clone();
  url.pathname = route.pathname;
  return NextResponse.rewrite(url, { request: { headers } });
}

// Skipped entirely: Next internals, /api, and static files by extension. sitemap.xml and robots.txt are NOT skipped,
// because each store host serves its own copy through the rewrite.
// /api is excluded for now, so /api/* is reachable on every host, store hosts included. It is not rewritten and no
// store data is tied to the host there. Revisit before any store-scoped API (checkout, AMP-041) is added.
export const config = {
  matcher: ['/((?!_next/|api/|favicon.ico|icon.png|apple-icon.png|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|css|js|map|woff|woff2|ttf|otf|mp4|webm)$).*)'],
};
