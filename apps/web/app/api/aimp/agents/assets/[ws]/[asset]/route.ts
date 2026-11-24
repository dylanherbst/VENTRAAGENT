// Serves one generated asset by a signed, expiring link (our UI and providers such as Zernio fetch media this way).
import { agentTeam, checkAssetSig } from '../../../../../../start/_server/agent-team-runtime';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ ws: string; asset: string }> }) {
  const { ws, asset } = await params;
  const u = new URL(req.url);
  if (!checkAssetSig(ws, asset, u.searchParams.get('exp'), u.searchParams.get('sig'))) return new Response('Not found', { status: 404 });
  const a = agentTeam().asset(ws, asset);
  if (!a?.bytes) return new Response('Not found', { status: 404 });
  return new Response(Buffer.from(a.bytes), { headers: { 'content-type': a.mime, 'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff' } });
}
