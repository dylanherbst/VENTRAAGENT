// Minimal Anthropic Messages API client with tool use, over fetch. Key and model come from server env only:
// ANTHROPIC_API_KEY and FRONT_OFFICE_MODEL (the exact model id; no default, so nothing runs on a guessed model).
export type TextBlock = { type: 'text'; text: string };
export type ToolUseBlock = { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };
export type ToolResultBlock = { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };
export type Block = TextBlock | ToolUseBlock | ToolResultBlock;
export type LlmMessage = { role: 'user' | 'assistant'; content: string | Block[] };
export type ToolSpec = { name: string; description: string; input_schema: Record<string, unknown> };
export type LlmRequest = { system: string; messages: LlmMessage[]; tools: ToolSpec[]; maxTokens?: number };
/** usage: token counts from the provider when it reports them (optional; fakes and the scripted model leave it out). */
export type LlmUsage = { inputTokens: number; outputTokens: number };
export type LlmResponse = { content: Block[]; stopReason: string; usage?: LlmUsage };
export type Llm = (req: LlmRequest) => Promise<LlmResponse>;

export type AnthropicConfig = { apiKey: string; model: string };
export function anthropicConfigFromEnv(env: Record<string, string | undefined> = process.env): AnthropicConfig | null {
  const apiKey = env.ANTHROPIC_API_KEY?.trim(), model = env.FRONT_OFFICE_MODEL?.trim();
  return apiKey && model ? { apiKey, model } : null;
}

export function anthropicLlm(config: AnthropicConfig, fetchImpl: typeof fetch = fetch, timeoutMs = 12_000): Llm {
  return async (req) => {
    const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(timeoutMs),
      headers: { 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: config.model, max_tokens: req.maxTokens ?? 600, system: req.system, messages: req.messages, tools: req.tools }),
    });
    const body = await res.json().catch(() => ({})) as { content?: Block[]; stop_reason?: string; usage?: { input_tokens?: unknown; output_tokens?: unknown } };
    if (!res.ok || !Array.isArray(body.content)) throw new Error(`AI provider error (${res.status}).`);
    const out: LlmResponse = { content: body.content, stopReason: body.stop_reason ?? 'end_turn' };
    const inT = body.usage?.input_tokens, outT = body.usage?.output_tokens;
    if (typeof inT === 'number' && typeof outT === 'number' && Number.isFinite(inT) && Number.isFinite(outT) && inT >= 0 && outT >= 0) out.usage = { inputTokens: inT, outputTokens: outT };
    return out;
  };
}

// Streaming, for the phone: the caller hears the first words while the rest is still being written.
// Anthropic Messages streaming (server-sent events): content_block_start / content_block_delta (text_delta,
// input_json_delta) / content_block_stop / message_delta (stop_reason) / message_stop.
export type StreamEvent = { type: 'text'; text: string } | { type: 'tool'; block: ToolUseBlock } | { type: 'stop'; reason: string };
export type StreamLlm = (req: LlmRequest) => AsyncIterable<StreamEvent>;

/** A non-streaming Llm as a stream (fakes in tests; the same events in the same order). */
export function streamOf(llm: Llm): StreamLlm {
  return async function* (req) {
    const res = await llm(req);
    for (const b of res.content) {
      if (b.type === 'text' && b.text) yield { type: 'text', text: b.text };
      if (b.type === 'tool_use') yield { type: 'tool', block: b };
    }
    yield { type: 'stop', reason: res.stopReason };
  };
}

export function anthropicStream(config: AnthropicConfig, fetchImpl: typeof fetch = fetch, timeoutMs = 20_000): StreamLlm {
  return async function* (req) {
    const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(timeoutMs),
      headers: { 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: config.model, max_tokens: req.maxTokens ?? 400, system: req.system, messages: req.messages, tools: req.tools, stream: true }),
    });
    if (!res.ok || !res.body) throw new Error(`AI provider error (${res.status}).`);
    const blocks = new Map<number, { kind: 'text' | 'tool'; id: string; name: string; json: string }>();
    let reason = 'end_turn', buf = '';
    const decoder = new TextDecoder();
    const reader = res.body.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (value) buf += decoder.decode(value, { stream: true });
      let cut: number;
      while ((cut = buf.indexOf('\n\n')) >= 0) {
        const raw = buf.slice(0, cut); buf = buf.slice(cut + 2);
        const data = raw.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('');
        if (!data) continue;
        let ev: Record<string, unknown>;
        try { ev = JSON.parse(data); } catch { continue; }
        const index = Number(ev.index);
        if (ev.type === 'content_block_start') {
          const b = ev.content_block as { type: string; id?: string; name?: string };
          blocks.set(index, { kind: b.type === 'tool_use' ? 'tool' : 'text', id: b.id ?? '', name: b.name ?? '', json: '' });
        } else if (ev.type === 'content_block_delta') {
          const d = ev.delta as { type: string; text?: string; partial_json?: string };
          if (d.type === 'text_delta' && d.text) yield { type: 'text', text: d.text };
          else if (d.type === 'input_json_delta') { const b = blocks.get(index); if (b) b.json += d.partial_json ?? ''; }
        } else if (ev.type === 'content_block_stop') {
          const b = blocks.get(index);
          if (b?.kind === 'tool') {
            let input: Record<string, unknown>;
            try { input = b.json ? JSON.parse(b.json) : {}; } catch { input = {}; }
            yield { type: 'tool', block: { type: 'tool_use', id: b.id, name: b.name, input } };
          }
        } else if (ev.type === 'message_delta') {
          const r = (ev.delta as { stop_reason?: string } | undefined)?.stop_reason;
          if (r) reason = r;
        } else if (ev.type === 'error') {
          throw new Error('AI provider error (stream).');
        }
      }
      if (done) break;
    }
    yield { type: 'stop', reason };
  };
}
