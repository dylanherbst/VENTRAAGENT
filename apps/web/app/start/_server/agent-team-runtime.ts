// Server wiring for the AI Team (Marketing + Social agents). One orchestrator per server process, in-memory store (lost on restart)
// until supabase/migrations/202611230001_ai_agent_team.sql is applied and a database store is wired.
// Providers are LIVE only when their keys are set; otherwise clearly labelled mocks. Publishing also needs SOCIAL_PUBLISHING_ENABLED=true.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { claudeJson, createAgentTeam, creatomate, flagsFromEnv, mockImages, mockPublisher, mockRenderer, newTeamStore, openaiImages, openaiJson, zernio, type AgentTeam, type Asset, type JsonModel } from '../../../lib/aimp/agents/index';
import { marketingEngine } from './marketing-engine-runtime';

// Every provider call has a hard timeout: a hung connection must fail (and be retried or reported), never leave a run "Working..." forever.
const PROVIDER_TIMEOUT_MS = 90_000;
const f = (u: string, i: { method: string; headers: Record<string, string>; body: string }) => fetch(u, { method: i.method, headers: i.headers, body: i.method === 'GET' ? undefined : i.body, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });

export function agentTextModel(): JsonModel | null {
  const want = process.env.MARKETING_TEXT_PROVIDER;
  if (want === 'demo') return null;
  const claude = process.env.ANTHROPIC_API_KEY ? claudeJson({ apiKey: process.env.ANTHROPIC_API_KEY, fetch: f, model: process.env.MARKETING_TEXT_MODEL }) : null;
  const openai = process.env.OPENAI_API_KEY && process.env.OPENAI_TEXT_MODEL ? openaiJson({ apiKey: process.env.OPENAI_API_KEY, fetch: f, model: process.env.OPENAI_TEXT_MODEL }) : null;
  return want === 'openai' ? openai : want === 'anthropic' ? claude : claude ?? openai;
}

const assetSecret = () => process.env.AGENT_ASSET_SECRET ?? '';
const sign = (ws: string, assetId: string, exp: number) => createHmac('sha256', assetSecret()).update(`${ws}.${assetId}.${exp}`).digest('hex');
/** Signed, expiring asset path. Relative for our own UI; absolute (APP_PUBLIC_URL) for providers. Null when no secret is set. */
export function signedAssetPath(ws: string, assetId: string, ttlSeconds = 3600): string | null {
  if (!assetSecret()) return null;
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  return `/api/aimp/agents/assets/${encodeURIComponent(ws)}/${encodeURIComponent(assetId)}?exp=${exp}&sig=${sign(ws, assetId, exp)}`;
}
export function checkAssetSig(ws: string, assetId: string, exp: string | null, sig: string | null): boolean {
  if (!assetSecret() || !exp || !sig || !/^\d{1,12}$/.test(exp) || !/^[0-9a-f]{64}$/.test(sig) || Number(exp) < Date.now() / 1000) return false;
  return timingSafeEqual(Buffer.from(sign(ws, assetId, Number(exp)), 'hex'), Buffer.from(sig, 'hex'));
}

type G = typeof globalThis & { __aimpAgentTeamV5?: AgentTeam; __aimpAgentTeamStore?: ReturnType<typeof newTeamStore> };
export function agentTeam(): AgentTeam {
  const g = globalThis as G;
  if (g.__aimpAgentTeamV5) return g.__aimpAgentTeamV5;
  const env = process.env;
  const publicUrl = env.APP_PUBLIC_URL && /^https:\/\//.test(env.APP_PUBLIC_URL) ? env.APP_PUBLIC_URL.replace(/\/$/, '') : null;
  g.__aimpAgentTeamV5 = createAgentTeam({
    store: (g.__aimpAgentTeamStore ??= newTeamStore()), marketing: marketingEngine(), text: agentTextModel(), // the store outlives code reloads in dev
    images: env.OPENAI_API_KEY && env.OPENAI_IMAGE_MODEL ? openaiImages({ apiKey: env.OPENAI_API_KEY, model: env.OPENAI_IMAGE_MODEL, fetch: f, sizes: env.OPENAI_IMAGE_SIZE_PORTRAIT ? { portrait: env.OPENAI_IMAGE_SIZE_PORTRAIT, story: env.OPENAI_IMAGE_SIZE_STORY ?? env.OPENAI_IMAGE_SIZE_PORTRAIT, square: env.OPENAI_IMAGE_SIZE_SQUARE } : undefined }) : mockImages,
    renderer: env.CREATOMATE_API_KEY ? creatomate({ apiKey: env.CREATOMATE_API_KEY, fetch: f }) : mockRenderer(),
    publisher: env.ZERNIO_API_KEY ? zernio({ apiKey: env.ZERNIO_API_KEY, fetch: f }) : mockPublisher(),
    flags: flagsFromEnv(env), templates: { reel: env.CREATOMATE_REEL_TEMPLATE_ID ?? null, static: env.CREATOMATE_STATIC_TEMPLATE_ID ?? null },
    publicUrl, zernioWebhookSecret: env.ZERNIO_WEBHOOK_SECRET ?? null,
    assetUrl: (a: Asset) => { const p = signedAssetPath(a.workspaceId, a.id, 7 * 86400); return p && publicUrl ? `${publicUrl}${p}` : null; },
    fetchBytes: async (url) => {
      if (!/^https:\/\//.test(url)) return null;
      const r = await fetch(url, { signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS * 2) }); if (!r.ok) return null;
      const len = Number(r.headers.get('content-length') ?? 0); if (len > 300 * 1024 * 1024) return null;
      return { bytes: new Uint8Array(await r.arrayBuffer()), mime: r.headers.get('content-type') ?? 'video/mp4' };
    },
  });
  return g.__aimpAgentTeamV5;
}
