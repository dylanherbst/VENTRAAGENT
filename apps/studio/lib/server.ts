import 'server-only';
// Server wiring for the studio: where state lives, which AI providers are live, and the owner check every action and page runs.
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { claudeJson, creatomate, flagsFromEnv, mockImages, mockPublisher, mockRenderer, openaiImages, openaiJson, zernio, type JsonModel } from '../../web/lib/aimp/agents/index';
import { claudeWriter, demoWriter, openaiWriter } from '../../web/lib/aimp/marketing-engine/index';
import { claudeAgent, costMicroUsd, ruleAgent, type SetterStore } from '../../web/lib/aimp/setter/index';
import { SESSION_COOKIE, verifySession } from '../../web/lib/aimp/studio/auth';
import { fileVault, supabaseVault, type Vault } from '../../web/lib/aimp/studio/vault';
import { openBrand, type OpenBrand, type StudioProviders } from '../../web/lib/aimp/studio/workspace';

const env = process.env;
const TIMEOUT = 90_000;
const f = (u: string, i: { method: string; headers: Record<string, string>; body?: string }) =>
  fetch(u, { method: i.method, headers: i.headers, body: i.method === 'GET' || i.method === 'DELETE' ? undefined : i.body, signal: AbortSignal.timeout(TIMEOUT) });

export async function requireOwner(): Promise<void> {
  if (process.env.NODE_ENV === 'development' && env.STUDIO_LOCAL_OPEN === '1') return; // Mac launcher, 127.0.0.1 only
  const ok = await verifySession((await cookies()).get(SESSION_COOKIE)?.value, env.STUDIO_SESSION_SECRET);
  if (!ok) redirect('/login');
}

let vaultP: Promise<Vault> | null = null;
/** Supabase when its URL and service key are set (hosted), otherwise a private folder on this computer. */
export function vault(): Promise<Vault> {
  if (vaultP) return vaultP;
  const url = env.SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY;
  vaultP = url && key && env.STUDIO_STORAGE !== 'file'
    ? Promise.resolve(supabaseVault({ url, serviceKey: key, fetch: (u, i) => f(u, i) as never }))
    : fileVault(env.STUDIO_DATA_DIR || `${process.cwd()}/.studio-data`);
  return vaultP;
}

function textModel(): JsonModel | null {
  const claude = env.ANTHROPIC_API_KEY ? claudeJson({ apiKey: env.ANTHROPIC_API_KEY, fetch: f, model: env.MARKETING_TEXT_MODEL }) : null;
  const openai = env.OPENAI_API_KEY && env.OPENAI_TEXT_MODEL ? openaiJson({ apiKey: env.OPENAI_API_KEY, fetch: f, model: env.OPENAI_TEXT_MODEL }) : null;
  return env.MARKETING_TEXT_PROVIDER === 'openai' ? openai : env.MARKETING_TEXT_PROVIDER === 'demo' ? null : claude ?? openai;
}

export function providers(): StudioProviders {
  const secret = env.STUDIO_SESSION_SECRET || (env.NODE_ENV === 'development' && env.STUDIO_LOCAL_OPEN === '1' ? 'local-open-mode-secret-for-this-mac-only-000' : '');
  return {
    secret,
    writer: env.ANTHROPIC_API_KEY && env.MARKETING_TEXT_PROVIDER !== 'demo' ? claudeWriter({ apiKey: env.ANTHROPIC_API_KEY, fetch: f, model: env.MARKETING_TEXT_MODEL })
      : env.OPENAI_API_KEY && env.OPENAI_TEXT_MODEL ? openaiWriter({ apiKey: env.OPENAI_API_KEY, fetch: f, model: env.OPENAI_TEXT_MODEL }) : demoWriter,
    setterAgent: (store: SetterStore) => env.ANTHROPIC_API_KEY
      ? claudeAgent({ apiKey: env.ANTHROPIC_API_KEY, fetch: f, model: env.SETTER_MODEL, onUsage: (u) => store.addUsage({ ...u, costMicroUsd: costMicroUsd(u.model, u), at: new Date().toISOString() }) })
      : ruleAgent,
    team: {
      text: textModel(),
      images: env.OPENAI_API_KEY && env.OPENAI_IMAGE_MODEL ? openaiImages({ apiKey: env.OPENAI_API_KEY, model: env.OPENAI_IMAGE_MODEL, fetch: f }) : mockImages,
      renderer: env.CREATOMATE_API_KEY ? creatomate({ apiKey: env.CREATOMATE_API_KEY, fetch: f }) : mockRenderer(),
      publisher: env.ZERNIO_API_KEY ? zernio({ apiKey: env.ZERNIO_API_KEY, fetch: f }) : mockPublisher(),
      flags: flagsFromEnv(env), templates: { reel: env.CREATOMATE_REEL_TEMPLATE_ID ?? null, static: env.CREATOMATE_STATIC_TEMPLATE_ID ?? null },
      publicUrl: null, zernioWebhookSecret: env.ZERNIO_WEBHOOK_SECRET ?? null,
    },
  };
}

/** Owner check, open the brand, run the action, save. Returns null when the brand does not exist. */
export async function withBrand<T>(brandId: string, fn: (b: OpenBrand) => Promise<T> | T): Promise<T | null> {
  await requireOwner();
  const b = await openBrand(await vault(), String(brandId), providers());
  if (!b) return null;
  // The owner's own replies are not sold per chat: keep a standing allowance so the AI Setter never stops for credits.
  if (b.setterStore.creditBalance(b.ws) < 1000) b.setterStore.addCredit({ workspaceId: b.ws, delta: 100_000, reason: 'adjustment', ref: `owner:${Date.now()}`, at: new Date().toISOString() });
  await b.setter.flushDue(b.ws);
  const out = await fn(b);
  await b.save();
  return out;
}
