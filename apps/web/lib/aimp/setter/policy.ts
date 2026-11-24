// Post-decision policy gate. The model suggests; this decides. Every rule is deterministic and explainable.
import type { AgentConfig, AgentDecision, DmConversation } from './types.ts';

export const DISCLOSURE = "(Automated reply from {business}. A person can take over any time, just ask.)";
export const MAX_TEXT_BYTES = 1000;
const BANNED = [
  /\bguarantee(d|s)?\b/i, /\brisk[- ]free\b/i, /\b(make|earn) \$?\d[\d,]*(k)?\b.*\b(per|a|every) (day|week|month)\b/i, /\bget rich\b/i,
  /\bonly \d+ (left|spots?)\b/i, /\b(last chance|expires (tonight|today))\b/i, /\b(card number|cvv|cvc|bank (details|account))\b/i,
  /\b(diagnos|prescri|legal advice|financial advice|tax advice)\w*/i,
  // Never claim to be a person.
  /\bi'?\s?a?m (a )?(real|human|not a bot|not an ai|not ai)\b/i, /\b(this is|you'?re talking to) (a )?real (person|human)\b/i,
];

export type Outcome = { action: 'send' | 'draft' | 'handoff' | 'ignore'; text: string; notes: string[]; ctaId: string | null };

const urlsIn = (t: string): string[] => t.match(/https?:\/\/[^\s)>\]]+/gi) ?? [];
const moneyIn = (t: string): number[] => (t.match(/\$\s?\d[\d,]*(\.\d{1,2})?/g) ?? []).map((m) => Math.round(Number(m.replace(/[$,\s]/g, '')) * 100));

// Self-references the setter never makes unprompted (owner decision: it does not say it is AI unless asked).
const SELF_AI = /\b(as an ai|i'?m an? (ai|bot|chatbot|virtual assistant|language model|automated)|i am an? (ai|bot|chatbot|virtual assistant|language model)|language model|chatbot|artificial intelligence)\b/i;

export function applyPolicy(d: AgentDecision, cfg: AgentConfig, conv: DmConversation, opts: { canSend: boolean; canDraft: boolean }, ctx: { askedIfBot?: boolean } = {}): Outcome {
  const notes: string[] = [];
  if (!opts.canDraft) return { action: 'ignore', text: '', notes: ['Not eligible to reply or draft.'], ctaId: null };
  if (d.recommended_action === 'ignore') return { action: 'ignore', text: '', notes: ['Model suggested no reply.'], ctaId: null };
  if (d.recommended_action === 'handoff' || ['complaint', 'human_requested'].includes(d.intent)) {
    return { action: 'handoff', text: '', notes: [`Handed to a person: ${d.handoff_reason ?? d.intent}.`], ctaId: null };
  }
  let text = d.response_text.trim();
  let forceDraft = false;
  if (!text) return { action: 'handoff', text: '', notes: ['Empty reply; a person should answer.'], ctaId: null };

  const known = new Set([...cfg.knowledge.map((k) => k.id), ...cfg.offers.map((o) => o.id), ...(cfg.objections ?? []).map((o) => o.id), 'business', 'shipping', 'returns', 'warranty', 'selling_points', 'testimonials', 'upsell', 'refund', 'booking']);
  const unknownSrc = d.knowledge_source_ids.filter((id) => !known.has(id));
  if (unknownSrc.length) { forceDraft = true; notes.push(`Cited facts that do not exist (${unknownSrc.join(', ')}).`); }

  const allowedUrls = new Set([...cfg.offers.map((o) => o.ctaUrl), cfg.bookingUrl].filter(Boolean));
  const badUrls = urlsIn(text).filter((u) => !allowedUrls.has(u.replace(/[.,!?]+$/, '')));
  if (badUrls.length) return { action: 'handoff', text: '', notes: [`Reply contained a link that is not one of the business's links: ${badUrls.join(' ')}`], ctaId: null };

  // Allowed amounts: product prices plus any dollar amount the owner wrote in their own facts (e.g. "saves $9").
  const ownText = [cfg.about, cfg.shipping, cfg.returns, cfg.warranty, cfg.upsell, cfg.refundPolicy, ...(cfg.sellingPoints ?? []), ...(cfg.objections ?? []).map((o) => o.answer), ...cfg.offers.flatMap((o) => [o.description, o.details ?? '']), ...cfg.knowledge.map((k) => k.answer)].join(' ');
  const prices = new Set([...cfg.offers.map((o) => o.priceMinor), ...moneyIn(ownText ?? '')]);
  const badPrices = moneyIn(text).filter((p) => !prices.has(p));
  if (badPrices.length) return { action: 'handoff', text: '', notes: ['Reply stated a price that is not in the offer list.'], ctaId: null };

  const hits = BANNED.filter((r) => r.test(text)).map((r) => r.source);
  const custom = cfg.prohibitedClaims.filter((c) => c.trim() && text.toLowerCase().includes(c.trim().toLowerCase()));
  if (hits.length || custom.length) return { action: 'handoff', text: '', notes: ['Reply contained a claim that is not allowed.'], ctaId: null };

  if (!ctx.askedIfBot && SELF_AI.test(text)) { forceDraft = true; notes.push('The reply mentioned being an AI without being asked; check the wording.'); }
  // Testimonials: only word-for-word quotes the owner entered.
  const quoted = text.match(/["“]([^"”]{12,})["”]/g) ?? [];
  if (quoted.some((q) => !cfg.testimonials.some((t) => t.includes(q.replace(/^["“]|["”]$/g, ''))))) return { action: 'handoff', text: '', notes: ['Reply quoted a review that is not one of your saved testimonials.'], ctaId: null };

  let ctaId = d.cta_id;
  if (ctaId && !cfg.offers.some((o) => o.id === ctaId) && ctaId !== 'booking') { notes.push('Unknown call to action dropped.'); ctaId = null; }
  if (ctaId && conv.pitchesDeclined > 0) { notes.push('The person declined before; no link pushed again.'); ctaId = null; forceDraft = true; }

  if (cfg.discloseAi && !conv.aiDisclosed) text = `${DISCLOSURE.replace('{business}', cfg.businessName || 'this business')} ${text}`;
  if (Buffer.byteLength(text, 'utf8') > MAX_TEXT_BYTES) { forceDraft = true; notes.push('Reply is over 1000 bytes; shorten before sending.'); }
  if (d.confidence < cfg.minConfidence) { forceDraft = true; notes.push(`Low confidence (${d.confidence}).`); }

  const auto = cfg.mode === 'auto' && opts.canSend && !forceDraft;
  if (cfg.mode !== 'auto') notes.push('Draft only: auto-replies are not switched on.');
  else if (!opts.canSend) notes.push('Not allowed to send automatically right now.');
  return { action: auto ? 'send' : 'draft', text, notes, ctaId };
}
