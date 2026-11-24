// Serves one generated image or video of one brand. Owner session required (checked by the proxy and again here).
import { cookies } from 'next/headers';
import { vault } from '../../../../../lib/server';
import { isBrandId, mediaKey } from '../../../../../../web/lib/aimp/studio/brands';
import { SESSION_COOKIE, verifySession } from '../../../../../../web/lib/aimp/studio/auth';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ brand: string; asset: string }> }): Promise<Response> {
  const localOpen = process.env.NODE_ENV === 'development' && process.env.STUDIO_LOCAL_OPEN === '1';
  if (!localOpen && !(await verifySession((await cookies()).get(SESSION_COOKIE)?.value, process.env.STUDIO_SESSION_SECRET))) return new Response('Not found', { status: 404 });
  const { brand, asset } = await ctx.params;
  if (!isBrandId(brand) || !/^ast_[a-z0-9]{6,40}$/i.test(asset)) return new Response('Not found', { status: 404 });
  const m = (await (await vault()).get(mediaKey(brand, asset))) as { mime: string; b64: string } | null;
  if (!m || !/^(image|video)\/[a-z0-9.+-]+$/.test(m.mime)) return new Response('Not found', { status: 404 });
  return new Response(Buffer.from(m.b64, 'base64'), { headers: { 'content-type': m.mime, 'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff' } });
}
