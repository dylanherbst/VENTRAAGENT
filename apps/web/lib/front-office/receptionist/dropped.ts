// G5: a call that drops mid-way (the caller hung up, or the line or pipeline failed) before anything was settled leaves
// one call-back handoff for staff: caller number, what was captured, and where the call stopped. Nothing is sent.
import { checkedHandoff } from '../handoff';
import type { ChannelAuth, Rpc } from '../orchestrator';
import type { ContactState } from '../state';

/** Outcomes that mean the call was dealt with (or a person already has it): no call-back needed. 'message' is also
 * what this function stores once it has recorded the call-back, so a repeated end-of-call report creates nothing. */
const SETTLED = new Set(['booked', 'rescheduled', 'cancelled', 'message', 'transfer', 'not-live']);

/** Caller hang-up or a failure; normal endings (assistant ended, forwarded, voicemail, never answered) are not drops. */
export function isDroppedReason(reason: string): boolean {
  return reason === 'customer-ended-call' || reason === 'silence-timed-out' || /error|failed|closed-websocket/i.test(reason);
}

type Ctx = { contact: { id: string; name: string | null; phone: string | null; email: string | null; state: ContactState; answers: Record<string, string> } };

/** Called after fo_voice_end. Returns true when a call-back handoff was recorded. */
export async function recordDroppedCall(rpc: Rpc, auth: ChannelAuth, end: { contact: string | null; outcomes: string[] | null }, call: { id: string; caller: string | null; reason: string; transcript: string }): Promise<boolean> {
  if (!isDroppedReason(call.reason) || !end.contact) return false;
  const outcomes = end.outcomes ?? [];
  if (outcomes.some(o => SETTLED.has(o))) return false;
  const a = { channel: auth.channel, channel_key: auth.key };
  const ctx = await rpc('fo_contact_context', { ...a, contact: end.contact }) as Ctx | null;
  if (!ctx) return false;
  const c = ctx.contact;
  const from = c.phone ?? call.caller ?? 'number withheld';
  const captured = [c.name ? `name ${c.name}` : '', ...Object.entries(c.answers ?? {}).map(([k, v]) => `${k}: ${v}`)].filter(Boolean).join('; ') || 'nothing captured';
  const lastAi = call.transcript.split('\n').map(l => l.trim()).filter(l => /^(AI|Assistant|Bot):/i.test(l)).at(-1)?.replace(/^\w+:\s*/, '') ?? '';
  const stopped = `${call.reason}${outcomes.length ? ` after ${outcomes.join(', ')}` : ''}${lastAi ? `; last thing the AI said: "${lastAi.slice(0, 200)}"` : ''}`;
  const h = checkedHandoff({ contact: { id: c.id, name: c.name, phone: c.phone, email: c.email, state: c.state }, channel: 'voice', intent: 'call back (dropped call)',
    answers: c.answers ?? {}, summary: `Dropped call from ${from}. Captured: ${captured}. Stopped: ${stopped}.`.slice(0, 1500), nextAction: 'Call the caller back', from: 'receptionist', owner: 'human' });
  await rpc('fo_record_handoff', { ...a, contact: c.id, handoff: h });
  await rpc('fo_voice_outcome', { ...a, call_id: call.id, outcome: 'message' }).catch(() => undefined);
  return true;
}
