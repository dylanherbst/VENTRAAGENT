// Every page and API route needs the owner session, except the login page and provider webhooks (they verify their own signatures).
import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from '../web/lib/aimp/studio/auth';

/** Mac launcher only: `next dev` bound to 127.0.0.1 with STUDIO_LOCAL_OPEN=1 skips the login. Never in a production build. */
export const localOpen = () => process.env.NODE_ENV === 'development' && process.env.STUDIO_LOCAL_OPEN === '1';

export async function proxy(req: NextRequest) {
  const p = req.nextUrl.pathname;
  if (p === '/login' || p.startsWith('/api/webhooks/')) return NextResponse.next();
  if (localOpen()) return NextResponse.next();
  if (await verifySession(req.cookies.get(SESSION_COOKIE)?.value, process.env.STUDIO_SESSION_SECRET)) return NextResponse.next();
  if (p.startsWith('/api/')) return new NextResponse('Not found', { status: 404 });
  const url = req.nextUrl.clone(); url.pathname = '/login'; url.search = '';
  return NextResponse.redirect(url);
}

export const config = { matcher: ['/((?!_next/|favicon.ico).*)'] };
