// The orchestrator (tracker 0.2): every inbound event comes through here. It records the event against the one shared
// contact record, applies opt-out, decides which agent owns the contact, and logs the dispatch. Agents (Phase 1+) plug in
// behind routeByState; until then the contact is recorded and routed, and only system messages are sent.
import { isOptIn, isOptOut, OPT_OUT_CONFIRMATION, OPT_OUT_PROMPT_VERSION } from './opt-out';
import { routeByState } from './router';
import type { Route } from './router';
import { isContactState } from './state';
import type { ContactState } from './state';
import type { InboundSms } from './twilio';

/** A Supabase-style RPC call: resolves with data or rejects with an Error. */
export type Rpc = (fn: string, args: Record<string, unknown>) => Promise<unknown>;
export type ChannelAuth = { channel: string; key: string };
export type InboundResult = {
  contact: string; state: ContactState; created: boolean; duplicate: boolean; optedOut: boolean;
  route: Route; reply: string | null;
};

export const OPT_IN_CONFIRMATION = 'You are subscribed again. Reply STOP at any time to opt out.';
export const OPT_IN_PROMPT_VERSION = 'system/opt-in-confirmation@1';

/** Agents that can take a turn after the dispatch. Each is called at most once per new inbound message. */
/** sales: called for booked contacts. The Sales agent is not run by any live route until the owner approves it; web chat
 * and the Setter Lab pass setter/agent.ts setterHooks(), which sends booked contacts writing again to the Setter's
 * returning-booked answer (task A-54). Other channels pass no sales hook, so booked contacts there get no AI reply. */
export type AgentHooks = { setter?: (contact: string) => void; sales?: (contact: string) => void };

export async function handleInboundSms(rpc: Rpc, auth: ChannelAuth, sms: InboundSms, agents: AgentHooks = {}): Promise<InboundResult> {
  return handleInbound(rpc, auth, { via: 'sms', sender: sms.from, to: sms.to, body: sms.body, messageId: sms.messageSid }, agents);
}

/** One inbound message on any channel: SMS (fo_ingest_sms), web chat or email (fo_ingest). */
/** checkText: the words checked for STOP/START when the stored body has extra framing (an email's subject line). */
export type InboundMessage = { via: 'sms' | 'web-chat' | 'email' | 'instagram' | 'messenger'; sender: string; to?: string; body: string; messageId: string; checkText?: string };
export async function handleInbound(rpc: Rpc, auth: ChannelAuth, m: InboundMessage, agents: AgentHooks = {}): Promise<InboundResult> {
  const words = m.checkText ?? m.body;
  const optOut = isOptOut(words), optIn = !optOut && isOptIn(words);
  const raw = (m.via === 'sms'
    ? await rpc('fo_ingest_sms', { channel: auth.channel, channel_key: auth.key, from_number: m.sender, to_number: m.to, message: m.body, msg_id: m.messageId, opt_out: optOut, opt_in: optIn })
    : await rpc('fo_ingest', { channel: auth.channel, channel_key: auth.key, sender: m.sender, message: m.body, msg_id: m.messageId, opt_out: optOut, opt_in: optIn })) as Record<string, unknown>;
  if (!raw || typeof raw.contact !== 'string' || !isContactState(raw.state)) throw new Error('Unexpected ingest result.');
  const base = { contact: raw.contact, state: raw.state, created: raw.created === true, duplicate: raw.duplicate === true, optedOut: raw.optedOut === true };
  const route = routeByState(base.state, base.optedOut);
  // A retry of a message already handled: answer the same way, record nothing twice.
  if (base.duplicate) return { ...base, route, reply: null };
  if (route.agent) await rpc('fo_log_dispatch', { channel: auth.channel, channel_key: auth.key, contact: base.contact, agent_name: route.agent, reason: route.reason });
  let reply: string | null = null;
  if (optOut && base.optedOut) reply = OPT_OUT_CONFIRMATION;
  else if (optIn && !base.optedOut) reply = OPT_IN_CONFIRMATION;
  if (reply) {
    // Logged before it is sent (tracker 0.6).
    await rpc('fo_log_outbound', { channel: auth.channel, channel_key: auth.key, contact: base.contact, message: reply, agent_name: 'system', prompt: reply === OPT_OUT_CONFIRMATION ? OPT_OUT_PROMPT_VERSION : OPT_IN_PROMPT_VERSION });
  }
  // STOP by SMS or email also closes any explicit consent for that channel (fo_contact_consents, A-38/A-45). The opt-out
  // above is what stops all messaging; this only keeps the consent history right, so a failure (an older database
  // without the RPC, a transient error) is logged and never changes the opt-out or the reply. Always on (A-47); needs
  // migration 202611110004. The log carries a fixed text and the error's name/code only, never its message.
  if (optOut && base.optedOut && (m.via === 'sms' || m.via === 'email')) {
    try {
      await rpc('fo_withdraw_consent', { channel: auth.channel, channel_key: auth.key, contact: base.contact, consent_channel: m.via, source: `inbound STOP (${m.via})`, withdrawn: null });
    } catch (e) {
      const code = e && typeof e === 'object' && 'code' in e && (typeof e.code === 'string' || typeof e.code === 'number') ? String(e.code).slice(0, 40) : null;
      console.warn('fo_withdraw_consent failed after an opt-out; the opt-out stands.', { channel: m.via, error: e instanceof Error ? e.name : typeof e, ...(code ? { code } : {}) });
    }
  }
  // System replies (opt-out, opt-in) end the turn; otherwise the owning agent replies on its own.
  if (!reply && route.agent === 'setter' && agents.setter) agents.setter(base.contact);
  if (!reply && route.agent === 'sales' && agents.sales) agents.sales(base.contact);
  return { ...base, route, reply };
}
