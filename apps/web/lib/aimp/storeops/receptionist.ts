// Enquiry receptionist: reads a buyer's question, labels the intent and drafts a reply from the shop's own catalogue and policies.
import { defineAgent, untrusted } from './agent.ts';

export const intents = ['product_question', 'pricing', 'delivery', 'complaint', 'refund', 'other'] as const;
export type Intent = (typeof intents)[number];

export interface ReceptionistInput {
  message: string;
  shop: { name: string; products: { title: string; priceLabel: string; summary: string }[]; policies: string[]; /** The only links a reply may contain. */ allowedLinks: string[] };
}
export interface ReceptionistDraft { intent: Intent; reply: string; handToOwner: boolean; note: string }

/** Complaints, refunds and unclear messages always reach the owner. */
const ownerIntents: readonly Intent[] = ['complaint', 'refund', 'other'];
const promise = /\b(we|i)('ll| will| can| have)\s+(refund|credit|replace|guarantee)|\bguarantee(d)?\b|\bfull refund\b/i;

export const receptionist = defineAgent<ReceptionistInput, ReceptionistDraft>({
  id: 'receptionist', action: 'draft', maxTokens: 500,
  system: 'You are the front desk for a small online shop. Reply in two or three friendly sentences using ONLY the products and policies you are given. If the answer is not there, say you will check and get back. Never promise refunds, discounts or dates. Only include links from the allowed list. Respond with JSON only: {"intent":"product_question|pricing|delivery|complaint|refund|other","reply":"...","handToOwner":true|false,"note":"why"}.',
  buildPrompt: (i) => [`Shop: ${i.shop.name}`, `Products:\n${i.shop.products.map((p) => `- ${p.title} (${p.priceLabel}): ${p.summary}`).join('\n')}`, `Policies:\n${i.shop.policies.map((p) => `- ${p}`).join('\n') || '- none'}`, `Allowed links: ${i.shop.allowedLinks.join(', ') || 'none'}`, untrusted('buyer message', i.message)].join('\n\n'),
  parse(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    if (!intents.includes(r.intent as Intent) || typeof r.reply !== 'string' || !r.reply.trim() || r.reply.length > 800 || typeof r.handToOwner !== 'boolean') return null;
    return { intent: r.intent as Intent, reply: r.reply.trim(), handToOwner: r.handToOwner || ownerIntents.includes(r.intent as Intent), note: typeof r.note === 'string' ? r.note.slice(0, 200) : '' };
  },
  guard(o, i) {
    const links = o.reply.match(/https?:\/\/[^\s)]+/gi) ?? [];
    if (links.some((l) => !i.shop.allowedLinks.some((a) => l.startsWith(a)))) return 'it contained a link that is not the shop\'s own.';
    if (promise.test(o.reply)) return 'it made a promise the shop has not approved.';
    return null;
  },
  fallback: () => ({ intent: 'other', reply: 'Thanks for your message. I will check and get back to you shortly.', handToOwner: true, note: 'Standard holding reply; the owner should answer.' }),
});
