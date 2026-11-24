// Deterministic send eligibility. Runs BEFORE the model and AGAIN at the moment of sending. No AI involved.
import { MESSAGING_SCOPE, type AgentConfig, type DmConversation, type InstagramConnection } from './types.ts';

export const WINDOW_MS = 24 * 60 * 60 * 1000;

export type Block =
  | 'kill_switch' | 'mode_off' | 'paused' | 'not_connected' | 'missing_permission' | 'thread_ownership_unconfirmed'
  | 'opted_out' | 'human_takeover' | 'no_inbound' | 'window_closed';

export interface EligibilityInput {
  now: Date;
  killSwitch: boolean;
  config: AgentConfig | null;
  connection: InstagramConnection | null;
  conversation: DmConversation;
  optedOut: boolean;
}

/** `canSend` = an automated message may go out now. `canDraft` = we may still prepare a draft for the owner to read. */
export function checkEligibility(i: EligibilityInput): { canSend: boolean; canDraft: boolean; blocks: Block[] } {
  const blocks: Block[] = [];
  if (i.killSwitch) blocks.push('kill_switch');
  if (!i.config || i.config.mode === 'off') blocks.push('mode_off');
  if (i.config?.paused) blocks.push('paused');
  const c = i.connection;
  if (!c || c.status !== 'active' || Date.parse(c.tokenExpiresAt) <= i.now.getTime()) blocks.push('not_connected');
  else {
    if (!c.scopes.includes(MESSAGING_SCOPE)) blocks.push('missing_permission');
    if (!c.threadOwnershipConfirmed) blocks.push('thread_ownership_unconfirmed');
  }
  if (i.optedOut) blocks.push('opted_out');
  if (i.conversation.humanTakeover) blocks.push('human_takeover');
  const last = i.conversation.lastInboundAt ? Date.parse(i.conversation.lastInboundAt) : NaN;
  if (Number.isNaN(last)) blocks.push('no_inbound');
  else if (i.now.getTime() - last >= WINDOW_MS) blocks.push('window_closed');
  const hard: Block[] = ['kill_switch', 'mode_off', 'opted_out', 'human_takeover', 'no_inbound', 'window_closed'];
  return { canSend: blocks.length === 0, canDraft: !blocks.some((b) => hard.includes(b)), blocks };
}

const STOP = /^\s*(stop|unsubscribe|opt[\s-]?out|leave me alone|don'?t (message|text|dm) me|remove me)\b/i;
/** Opt-out is decided by rule, not by the model, and wins over everything. */
export const isOptOut = (text: string): boolean => STOP.test(text);
const HUMAN = /\b(real person|human|speak to (someone|a person)|talk to (someone|a person|the owner))\b/i;
export const wantsHuman = (text: string): boolean => HUMAN.test(text);
const BOT_Q = /\b(are|r) (you|u) (a |an )?(bot|ai|robot|real|human|automated|a person)\b|\bis this (a |an )?(bot|ai|automated|real person)\b|\b(am i )?(talking|chatting|speaking) (to|with) (a |an )?(bot|ai|robot|real person|human)\b/i;
/** The person asks whether they are talking to automation. */
export const asksIfAutomated = (text: string): boolean => BOT_Q.test(text);
