// The handoff contract (tracker 0.4). Every handoff (Setter to Sales, Setter to Receptionist, Receptionist to Setter,
// Sales to Onboarding) passes this one object. An agent that cannot fill it cannot hand off.
import { isContactState } from './state';
import type { ContactState } from './state';

export const agents = ['setter', 'sales', 'receptionist', 'onboarding', 'human'] as const;
export type Agent = typeof agents[number];
export const channels = ['sms', 'web-chat', 'email', 'voice', 'form', 'instagram', 'messenger'] as const;
export type Channel = typeof channels[number];

export type Handoff = {
  contact: { id: string; name: string | null; phone: string | null; email: string | null; state: ContactState };
  channel: Channel;
  /** Why the contact is being handed on, in a few words: "book a consult", "billing question". */
  intent: string;
  /** Qualification answers keyed by the client's question id. */
  answers: Record<string, string>;
  /** Plain-English summary of the conversation so far, so the contact never repeats themselves. */
  summary: string;
  nextAction: string;
  from: Agent;
  /** Who owns the contact now. */
  owner: Agent;
};

const text = (v: unknown, max: number, field: string, allowEmpty = false): string => {
  if (typeof v !== 'string') throw new Error(`Handoff ${field} is missing.`);
  const t = v.trim();
  if ((!allowEmpty && !t) || t.length > max) throw new Error(`Handoff ${field} is empty or too long.`);
  return t;
};
const nullable = (v: unknown, max: number, field: string): string | null => v === null || v === undefined || v === '' ? null : text(v, max, field);
const oneOf = <T extends string>(list: readonly T[], v: unknown, field: string): T => {
  if (typeof v !== 'string' || !(list as readonly string[]).includes(v)) throw new Error(`Handoff ${field} is not valid.`);
  return v as T;
};

/** Validate an untrusted handoff (for example model output). Throws a plain-English error on the first problem. */
export function checkedHandoff(input: unknown): Handoff {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Handoff must be an object.');
  const h = input as Record<string, unknown>;
  const c = h.contact as Record<string, unknown> | undefined;
  if (!c || typeof c !== 'object') throw new Error('Handoff contact is missing.');
  if (!isContactState(c.state)) throw new Error('Handoff contact state is not valid.');
  const answersIn = h.answers ?? {};
  if (typeof answersIn !== 'object' || answersIn === null || Array.isArray(answersIn)) throw new Error('Handoff answers must be an object.');
  const entries = Object.entries(answersIn as Record<string, unknown>);
  if (entries.length > 30) throw new Error('Handoff has too many answers.');
  const answers: Record<string, string> = {};
  for (const [k, v] of entries) answers[text(k, 80, 'answer id')] = text(v, 1000, `answer ${k}`, true);
  const from = oneOf(agents, h.from, 'from'), owner = oneOf(agents, h.owner, 'owner');
  if (from === owner) throw new Error('Handoff must change the owner.');
  const handoff: Handoff = {
    contact: { id: text(c.id, 64, 'contact id'), name: nullable(c.name, 160, 'contact name'), phone: nullable(c.phone, 32, 'contact phone'), email: nullable(c.email, 254, 'contact email'), state: c.state },
    channel: oneOf(channels, h.channel, 'channel'),
    intent: text(h.intent, 200, 'intent'),
    answers,
    summary: text(h.summary, 4000, 'summary'),
    nextAction: text(h.nextAction, 500, 'next action'),
    from, owner,
  };
  // A web chat visitor may not have shared either yet; the next owner answers in the same chat.
  if (!handoff.contact.phone && !handoff.contact.email && !['web-chat', 'instagram', 'messenger'].includes(handoff.channel)) throw new Error('Handoff contact needs a phone or an email.');
  return handoff;
}
