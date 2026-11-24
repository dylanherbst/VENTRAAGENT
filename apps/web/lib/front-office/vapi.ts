// Vapi (managed voice: phone line, speech-to-text and voice) for the AI Receptionist. Vapi calls us two ways:
// 1. Custom LLM: an OpenAI-compatible POST .../chat/completions with the conversation; we answer with streamed
//    chat.completion.chunk events. Docs: https://docs.vapi.ai/customization/custom-llm/using-your-server,
//    https://docs.vapi.ai/customization/tool-calling-integration (SSE "data: {chunk}\n\n" ... "data: [DONE]\n\n";
//    transferCall is triggered by a transferCall function call carrying the destination).
// 2. Server URL: {"message": {"type": ...}} events. Docs: https://docs.vapi.ai/server-url/events (tool-calls ->
//    {"results":[{"name","toolCallId","result"}]}; transfer-destination-request -> {"destination":{...}} or {"error"};
//    status-update; end-of-call-report with endedReason and artifact.transcript).
// Auth: Vapi sends a credential as "Authorization: Bearer <token>" or, legacy, "X-Vapi-Secret: <token>"
//   (https://docs.vapi.ai/server-url/server-authentication). Our token is the voice channel's key.
import { timingSafeEqual } from 'node:crypto';
import type { CallerTurn } from './receptionist/agent';

export function vapiToken(headers: Headers): string {
  const bearer = headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  return bearer || headers.get('x-vapi-secret')?.trim() || '';
}
export function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

const E164 = /^\+[1-9][0-9]{6,14}$/, CALL_ID = /^[A-Za-z0-9_-]{8,100}$/;
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {});
const text = (v: unknown): string => typeof v === 'string' ? v : Array.isArray(v) ? v.map(p => typeof p === 'string' ? p : typeof obj(p).text === 'string' ? obj(p).text as string : '').join(' ') : '';

export type VapiChat = { conversation: CallerTurn[]; callId: string | null; caller: string | null; turn: number; lastUser: string };
/** The custom-LLM request: conversation (system and tool messages dropped; our own prompt runs), call id and caller. */
export function parseVapiChat(body: unknown): VapiChat {
  const b = obj(body);
  if (!Array.isArray(b.messages)) throw new Error('No messages.');
  const conversation: CallerTurn[] = [];
  for (const m of b.messages) {
    const r = obj(m);
    if ((r.role === 'user' || r.role === 'assistant') && text(r.content).trim()) conversation.push({ role: r.role, content: text(r.content).slice(0, 4000) });
  }
  const call = obj(b.call), customer = obj(call.customer ?? b.customer);
  const callId = typeof call.id === 'string' && CALL_ID.test(call.id) ? call.id : null;
  const number = typeof customer.number === 'string' ? customer.number.replace(/[\s()-]/g, '') : '';
  const users = conversation.filter(t => t.role === 'user');
  return { conversation, callId, caller: E164.test(number) ? number : null, turn: users.length, lastUser: users.at(-1)?.content ?? '' };
}

export type VapiEvent = {
  type: string; callId: string | null; caller: string | null;
  toolCalls: { id: string; name: string; args: Obj }[];
  endedReason: string; summary: string; transcript: string; status: string;
};
export function parseVapiEvent(body: unknown): VapiEvent {
  const m = obj(obj(body).message);
  if (typeof m.type !== 'string') throw new Error('No message type.');
  const call = obj(m.call), customer = obj(m.customer ?? call.customer), artifact = obj(m.artifact), analysis = obj(m.analysis);
  const number = typeof customer.number === 'string' ? customer.number.replace(/[\s()-]/g, '') : '';
  const toolCalls = (Array.isArray(m.toolCallList) ? m.toolCallList : []).map(t => {
    const r = obj(t), f = obj(r.function);
    let args: Obj;
    if (typeof f.arguments === 'string') { try { args = obj(JSON.parse(f.arguments)); } catch { args = {}; } } else args = obj(f.arguments);
    return { id: typeof r.id === 'string' ? r.id : '', name: typeof f.name === 'string' ? f.name : '', args };
  }).filter(t => t.id && t.name);
  return {
    type: m.type, callId: typeof call.id === 'string' && CALL_ID.test(call.id) ? call.id : null, caller: E164.test(number) ? number : null, toolCalls,
    endedReason: typeof m.endedReason === 'string' ? m.endedReason.slice(0, 120) : '',
    summary: typeof analysis.summary === 'string' ? analysis.summary : typeof m.summary === 'string' ? m.summary : '',
    transcript: typeof artifact.transcript === 'string' ? artifact.transcript : typeof m.transcript === 'string' ? m.transcript : '',
    status: typeof m.status === 'string' ? m.status : '',
  };
}

/** OpenAI-style streamed chunks, as Vapi's custom LLM integration reads them. */
export function chunkWriter(model: string, now = Date.now()) {
  const id = 'chatcmpl-ventra-' + now.toString(36);
  const created = Math.floor(now / 1000);
  const line = (delta: Obj, finish: string | null) => `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
  return {
    start: () => line({ role: 'assistant', content: '' }, null),
    text: (t: string) => line({ content: t }, null),
    /** A function call Vapi carries out itself (transferCall, endCall). */
    tool: (name: 'transferCall' | 'endCall', args: Obj) => line({ tool_calls: [{ index: 0, id: 'call_' + name + '_' + now.toString(36), type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, null) + line({}, 'tool_calls'),
    stop: () => line({}, 'stop'),
    done: () => 'data: [DONE]\n\n',
  };
}
export const sseHeaders = { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-store', Connection: 'keep-alive' };
