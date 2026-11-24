// The ONE text-model integration both agents use. Claude (Anthropic Messages API) or OpenAI (Responses API, strict json_schema).
// Server-only: keys come from the caller (env), never from the browser. Fetch is injected so tests never touch the network.
export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ status: number; json(): Promise<unknown> }>;
export interface LlmUsage { provider: string; model: string; inputTokens: number; outputTokens: number; estimatedCostUsd: number }
export interface JsonModel { name: string; demo: boolean; complete(req: { system: string; user: string; schema: object; schemaName: string; maxTokens?: number }): Promise<{ text: string; usage: LlmUsage | null }> }

// USD per million tokens (input, output). Unknown models are estimated at 0 and shown as "not priced".
const PRICES: Record<string, [number, number]> = { 'claude-haiku-5-5': [0.1, 0.5], 'claude-sonnet-5-5': [2, 10] };
export const estimateCost = (model: string, inTok: number, outTok: number): number => {
  const p = PRICES[model]; return p ? Math.round(((inTok * p[0] + outTok * p[1]) / 1e6) * 1e6) / 1e6 : 0;
};
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);

export class ProviderError extends Error {
  code: string; status: number; usage: LlmUsage | null; retryable: boolean;
  constructor(code: string, status: number, usage: LlmUsage | null, retryable: boolean) { super(code); this.code = code; this.status = status; this.usage = usage; this.retryable = retryable; }
}

/** Runs a provider fetch; a thrown network error or timeout becomes a retryable ProviderError. */
export async function call(fetchFn: FetchLike, url: string, init: { method: string; headers: Record<string, string>; body: string }) {
  try { return await fetchFn(url, init); } catch (e) {
    const timeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    throw new ProviderError(timeout ? 'provider_timeout' : 'network_error', 0, null, true);
  }
}

export function claudeJson(deps: { apiKey: string; fetch: FetchLike; model?: string }): JsonModel {
  const model = deps.model && /^[a-z0-9.-]{3,80}$/.test(deps.model) ? deps.model : 'claude-haiku-5-5';
  return { name: model, demo: false, async complete(req) {
    const res = await call(deps.fetch, 'https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'x-api-key': deps.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: req.maxTokens ?? 4000, system: `${req.system}\nReturn only JSON matching this schema (${req.schemaName}): ${JSON.stringify(req.schema)}`, messages: [{ role: 'user', content: req.user }] }),
    });
    const j = (await res.json().catch(() => ({}))) as { content?: { type?: string; text?: string }[]; usage?: Record<string, unknown>; stop_reason?: string };
    const i = num(j.usage?.input_tokens) + num(j.usage?.cache_creation_input_tokens) + num(j.usage?.cache_read_input_tokens), o = num(j.usage?.output_tokens);
    const usage = j.usage ? { provider: 'anthropic', model, inputTokens: i, outputTokens: o, estimatedCostUsd: estimateCost(model, i, o) } : null;
    if (res.status < 200 || res.status >= 300) throw new ProviderError(`writer_http_${res.status}`, res.status, usage, res.status === 429 || res.status >= 500);
    // Cut off at max_tokens = half a JSON object. Say so plainly instead of failing later as "not JSON".
    if (j.stop_reason === 'max_tokens') throw new ProviderError('output_truncated', res.status, usage, false);
    return { text: (j.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n'), usage };
  } };
}

export function openaiJson(deps: { apiKey: string; fetch: FetchLike; model: string }): JsonModel {
  return { name: deps.model, demo: false, async complete(req) {
    const res = await call(deps.fetch, 'https://api.openai.com/v1/responses', {
      method: 'POST', headers: { authorization: `Bearer ${deps.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: deps.model, instructions: req.system, input: req.user, text: { format: { type: 'json_schema', name: req.schemaName, strict: true, schema: req.schema } } }),
    });
    const j = (await res.json().catch(() => ({}))) as { output_text?: string; output?: { content?: { type?: string; text?: string }[] }[]; usage?: Record<string, unknown> };
    const usage = j.usage ? { provider: 'openai', model: deps.model, inputTokens: num(j.usage.input_tokens), outputTokens: num(j.usage.output_tokens), estimatedCostUsd: 0 } : null;
    if (res.status < 200 || res.status >= 300) throw new ProviderError(`writer_http_${res.status}`, res.status, usage, res.status === 429 || res.status >= 500);
    return { text: j.output_text ?? (j.output ?? []).flatMap((x) => x.content ?? []).filter((c) => c.type === 'output_text').map((c) => c.text ?? '').join(''), usage };
  } };
}

/** Parse model text into JSON, tolerating a ```json fence. */
export function parseJson(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  const t = raw.replace(/^```(json)?|```$/g, '').trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  try { return JSON.parse(a >= 0 && b > a ? t.slice(a, b + 1) : t); } catch { return null; }
}
