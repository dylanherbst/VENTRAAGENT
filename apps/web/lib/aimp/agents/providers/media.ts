// Shared media adapters used by BOTH agents. Live adapters need keys; mocks are labelled live:false everywhere their output shows.
// OpenAI Images: POST https://api.openai.com/v1/images/generations, result data[0].b64_json (guide read 22 Nov 2026).
//   Model names, size and quality options were NOT confirmed: model comes only from OPENAI_IMAGE_MODEL; size is sent only if configured.
// Creatomate: POST https://api.creatomate.com/v2/renders, Bearer key, { template_id, modifications, webhook_url, metadata } -> 202, ONE
//   object { id, status, url, ... }; status starts 'planned', done 'succeeded'. The failure status name and webhook signing are NOT
//   documented on the pages read, so webhooks are treated as untrusted hints: we re-fetch GET /v2/renders/{id} before trusting a result.
import type { FetchLike } from '../llm.ts';
import { ProviderError } from '../llm.ts';

export interface ImageResult { bytes: Uint8Array; mime: string; live: boolean; model: string; estimatedCostUsd: number }
export interface ImageProvider { live: boolean; generate(req: { prompt: string; aspect: 'square' | 'portrait' | 'story' }): Promise<ImageResult> }

export function openaiImages(deps: { apiKey: string; model: string; fetch: FetchLike; sizes?: Partial<Record<'square' | 'portrait' | 'story', string>>; costPerImageUsd?: number }): ImageProvider {
  return { live: true, async generate(req) {
    const body: Record<string, unknown> = { model: deps.model, prompt: req.prompt.slice(0, 3800), n: 1 };
    const size = deps.sizes?.[req.aspect]; if (size) body.size = size;
    const res = await deps.fetch('https://api.openai.com/v1/images/generations', { method: 'POST', headers: { authorization: `Bearer ${deps.apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = (await res.json().catch(() => ({}))) as { data?: { b64_json?: string }[] };
    if (res.status < 200 || res.status >= 300) throw new ProviderError(`image_http_${res.status}`, res.status, null, res.status === 429 || res.status >= 500);
    const b64 = j.data?.[0]?.b64_json;
    if (!b64) throw new ProviderError('image_empty', res.status, null, false);
    return { bytes: Uint8Array.from(Buffer.from(b64, 'base64')), mime: 'image/png', live: true, model: deps.model, estimatedCostUsd: deps.costPerImageUsd ?? 0 };
  } };
}

// 1x1 PNG placeholder in brand purple. Clearly a mock: the UI shows "Mock image".
const MOCK_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mOMNmr6DwAEnQJCJjNQZQAAAABJRU5ErkJggg==';
export const mockImages: ImageProvider = { live: false, async generate() { return { bytes: Uint8Array.from(Buffer.from(MOCK_PNG, 'base64')), mime: 'image/png', live: false, model: 'mock', estimatedCostUsd: 0 }; } };

export type RenderStatus = 'requested' | 'queued' | 'rendering' | 'completed' | 'failed';
export interface RenderHandle { providerId: string; status: RenderStatus; url: string | null; live: boolean; error: string | null }
export interface RenderProvider {
  live: boolean;
  start(req: { templateId: string; modifications: Record<string, string>; webhookUrl: string | null; metadata: string }): Promise<RenderHandle>;
  status(providerId: string): Promise<RenderHandle>;
}

export function mapCreatomateStatus(s: unknown): RenderStatus {
  if (s === 'succeeded') return 'completed';
  if (s === 'failed') return 'failed';
  if (s === 'planned') return 'queued';
  return typeof s === 'string' && s ? 'rendering' : 'queued';
}

export function creatomate(deps: { apiKey: string; fetch: FetchLike }): RenderProvider {
  const h = { authorization: `Bearer ${deps.apiKey}`, 'content-type': 'application/json' };
  const read = (j: Record<string, unknown>, live = true): RenderHandle => ({ providerId: String(j.id ?? ''), status: mapCreatomateStatus(j.status), url: typeof j.url === 'string' && j.status === 'succeeded' ? j.url : null, live,
    error: Array.isArray(j.errors) && j.errors.length ? String(j.errors[0]).slice(0, 200) : typeof j.error_message === 'string' ? j.error_message.slice(0, 200) : null });
  return {
    live: true,
    async start(req) {
      const body: Record<string, unknown> = { template_id: req.templateId, modifications: req.modifications, metadata: req.metadata };
      if (req.webhookUrl) body.webhook_url = req.webhookUrl;
      const res = await deps.fetch('https://api.creatomate.com/v2/renders', { method: 'POST', headers: h, body: JSON.stringify(body) });
      const j = (await res.json().catch(() => ({}))) as Record<string, unknown> | Record<string, unknown>[];
      if (res.status < 200 || res.status >= 300) throw new ProviderError(`render_http_${res.status}`, res.status, null, res.status === 429 || res.status >= 500);
      const one = Array.isArray(j) ? j[0] ?? {} : j; // docs say one object; tolerate an array
      if (!one.id) throw new ProviderError('render_no_id', res.status, null, false);
      return read(one);
    },
    async status(id) {
      const res = await deps.fetch(`https://api.creatomate.com/v2/renders/${encodeURIComponent(id)}`, { method: 'GET', headers: h, body: '' });
      const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.status < 200 || res.status >= 300) throw new ProviderError(`render_http_${res.status}`, res.status, null, res.status === 429 || res.status >= 500);
      return read(j);
    },
  };
}

/** Mock renderer: completes on the first status check with no file. The UI says "Mock render: no video file". */
export function mockRenderer(): RenderProvider {
  let n = 0;
  return { live: false, async start() { return { providerId: `mock_render_${++n}`, status: 'queued', url: null, live: false, error: null }; },
    async status(id) { return { providerId: id, status: 'completed', url: null, live: false, error: null }; } };
}
