// The Inbox: enquiries in, a drafted reply out, the owner decides. Nothing is sent until the owner approves, approving twice sends once, and
// one business never sees another's threads. In-memory store (DEMO); the shape is what a table would hold. No env, no network here: the caller
// injects orders, the shop's facts, the model (or null) and the sender (a fixture outbox today).
import { runAgent } from './agent.ts';
import type { AgentModel } from './agent.ts';
import { draftReply, lookupOrder, opsLogEntry } from './order-status.ts';
import type { OpsLogEntry, OrderFacts, ReplyDraft } from './order-status.ts';
import { receptionist } from './receptionist.ts';
import type { ReceptionistInput } from './receptionist.ts';

export const MAX_MESSAGE = 2000;
export const MAX_THREADS_PER_BUSINESS = 50;
const EMAIL = /^[^@\s]{1,64}@[^@\s]{1,190}$/;
const ORDERISH = /\b(order|download|receipt|paid|payment|delivery|delivered|link|file|email)\b/i;

export type ThreadStatus = 'waiting' | 'sent' | 'rejected';

export interface Thread {
  id: string;
  businessId: string;
  fromEmail: string;
  message: string;
  orderRef: string | null;
  kind: 'order' | 'enquiry';
  subject: string;
  /** The text that will be sent on approval. The owner can edit it first. */
  body: string;
  handToOwner: boolean;
  note: string;
  suggestedAction: ReplyDraft['suggestedAction'];
  source: 'agent' | 'fallback' | 'template';
  reason: string | null;
  status: ThreadStatus;
  log: OpsLogEntry;
  createdAt: number;
  decidedAt: number | null;
  sentMessageId: string | null;
}

export interface InboxDeps {
  now: () => number;
  newId: () => string;
  orders: (businessId: string) => Promise<OrderFacts[]>;
  shop: (businessId: string) => ReceptionistInput['shop'] | Promise<ReceptionistInput['shop']>;
  model: AgentModel | null;
  send: (input: { to: string; subject: string; text: string; idempotencyKey: string }) => Promise<{ id: string }>;
}

export type InboxResult =
  | { ok: true; thread: Thread; created?: boolean; alreadyDecided?: boolean }
  | { ok: false; code: 'invalid' | 'not_found' | 'full' | 'send_failed'; message: string };

export interface Inbox {
  add(businessId: string, input: { fromEmail: string; message: string; orderRef?: string | null }): Promise<InboxResult>;
  list(businessId: string): Thread[];
  decide(businessId: string, threadId: string, decision: 'approve' | 'reject', edit?: { body?: string }): Promise<InboxResult>;
}

const bad = (code: 'invalid' | 'not_found' | 'full' | 'send_failed', message: string): InboxResult => ({ ok: false, code, message });

export function createInbox(deps: InboxDeps): Inbox {
  const threads = new Map<string, Thread>();
  const keys = new Map<string, string>();
  const mine = (businessId: string): Thread[] => [...threads.values()].filter((t) => t.businessId === businessId);

  return {
    list: (businessId) => mine(businessId).sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1)),

    async add(businessId, input) {
      const email = String(input.fromEmail ?? '').trim();
      const message = String(input.message ?? '').trim();
      if (!businessId || !EMAIL.test(email)) return bad('invalid', 'Enter the buyer\'s email address.');
      if (!message || message.length > MAX_MESSAGE) return bad('invalid', `Write a message of up to ${MAX_MESSAGE} characters.`);
      const orderRef = input.orderRef ? String(input.orderRef).trim().slice(0, 100) : null;
      const key = `${businessId}|${email.toLowerCase()}|${message}|${orderRef ?? ''}`;
      const dup = keys.get(key);
      if (dup && threads.has(dup)) return { ok: true, thread: threads.get(dup)!, created: false };
      if (mine(businessId).length >= MAX_THREADS_PER_BUSINESS) return bad('full', 'The Inbox is full. Decide on some messages first.');

      const orders = await deps.orders(businessId);
      const shop = await deps.shop(businessId);
      const lookup = lookupOrder(orders, { fromEmail: email, orderRef });
      let kind: Thread['kind'];
      let subject: string, body: string, handToOwner: boolean, note: string, suggestedAction: ReplyDraft['suggestedAction'];
      let source: Thread['source'] = 'template';
      let reason: string | null = null;
      let log: OpsLogEntry;
      if (lookup.found || ORDERISH.test(message)) {
        kind = 'order';
        const d = draftReply(lookup, shop.name);
        ({ subject, body, handToOwner, note, suggestedAction } = d);
        log = opsLogEntry(lookup, d);
      } else {
        kind = 'enquiry';
        const r = await runAgent(receptionist, { message, shop }, { model: deps.model, idempotencyKey: `inbox:add:${key.length}:${email}` });
        subject = 'Your question'; body = r.output.reply; handToOwner = r.output.handToOwner; note = r.output.note; suggestedAction = 'none'; source = r.source; reason = r.reason;
        log = { workflow: 'receptionist', orderId: null, status: 'waiting_for_you', result: handToOwner ? `Needs you: ${note}` : `Drafted a reply (${r.output.intent.replace(/_/g, ' ')}) for approval.` };
      }
      const t: Thread = { id: deps.newId(), businessId, fromEmail: email, message, orderRef, kind, subject, body, handToOwner, note, suggestedAction, source, reason,
        status: 'waiting', log, createdAt: deps.now(), decidedAt: null, sentMessageId: null };
      threads.set(t.id, t);
      keys.set(key, t.id);
      return { ok: true, thread: t, created: true };
    },

    async decide(businessId, threadId, decision, edit) {
      const t = threads.get(threadId);
      if (!t || t.businessId !== businessId) return bad('not_found', 'That message was not found.');
      if (t.status !== 'waiting') return { ok: true, thread: t, alreadyDecided: true };
      if (decision === 'reject') {
        t.status = 'rejected'; t.decidedAt = deps.now(); t.log = { ...t.log, status: 'done', result: 'Not sent: you decided to handle it yourself.' };
        return { ok: true, thread: t };
      }
      if (edit?.body !== undefined) {
        const b = String(edit.body).trim();
        if (!b || b.length > MAX_MESSAGE) return bad('invalid', `The reply must be 1 to ${MAX_MESSAGE} characters.`);
        t.body = b;
      }
      try {
        const sent = await deps.send({ to: t.fromEmail, subject: t.subject, text: t.body, idempotencyKey: `inbox:${t.id}` });
        t.status = 'sent'; t.decidedAt = deps.now(); t.sentMessageId = sent.id; t.log = { ...t.log, status: 'done', result: 'Reply approved and sent.' };
        return { ok: true, thread: t };
      } catch {
        return bad('send_failed', 'The reply could not be sent. Nothing was sent; try again.');
      }
    },
  };
}
