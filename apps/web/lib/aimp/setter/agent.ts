// The model is a replaceable decision component. It gets only this tenant's verified facts and must answer in the structured schema.
// `ruleAgent` is a deterministic fallback used by the simulator, by tests, and when no AI key is set.
import type { AgentConfig, AgentDecision, DmMessage } from './types.ts';

export interface AgentInput { config: AgentConfig; history: Pick<DmMessage, 'direction' | 'text'>[]; latest: string; conversationId?: string }
export interface SetterAgent {
  name: string;
  /** True when each decision costs money (a real model): the pipeline then needs a credit before calling it and spends one after. */
  metered?: boolean;
  decide(i: AgentInput): Promise<unknown>;
}

export const PROMPT_VERSION = 'setter-2026-11-22.1';

const money = (minor: number, cur: string) => `$${(minor / 100).toFixed(minor % 100 ? 2 : 0)} ${cur}`;

export function buildPrompt(i: AgentInput): { system: string; prompt: string } {
  const c = i.config;
  const facts = [
    c.about ? `[business] About ${c.businessName}: ${c.about}` : '',
    ...c.offers.map((o) => [
      `[${o.id}] PRODUCT ${o.name} — ${money(o.priceMinor, o.currency)}. ${o.description}`,
      o.details ? `    Details: ${o.details}` : '',
      o.bestFor ? `    Best for / not for: ${o.bestFor}` : '',
      `    Checkout link: ${o.ctaUrl}`,
    ].filter(Boolean).join('\n')),
    c.shipping ? `[shipping] Shipping: ${c.shipping}` : '',
    c.returns ? `[returns] Returns: ${c.returns}` : '',
    c.warranty ? `[warranty] Warranty: ${c.warranty}` : '',
    c.refundPolicy ? `[refund] Refund policy: ${c.refundPolicy}` : '',
    c.sellingPoints?.length ? `[selling_points] Why people buy: ${c.sellingPoints.map((p, n) => `${n + 1}) ${p}`).join(' ')}` : '',
    ...(c.objections ?? []).map((o) => `[${o.id}] If they say something like "${o.objection}": ${o.answer}`),
    c.testimonials?.length ? `[testimonials] Real customer quotes (quote word for word only, never invent or edit): ${c.testimonials.map((t) => `"${t}"`).join(' ')}` : '',
    c.upsell ? `[upsell] Upsell, offer once only when it genuinely fits: ${c.upsell}` : '',
    ...c.knowledge.map((k) => `[${k.id}] Q: ${k.question}\n    A: ${k.answer}`),
    c.bookingUrl ? `[booking] Booking link: ${c.bookingUrl}` : '',
  ].filter(Boolean).join('\n');
  const missing = [!c.shipping && 'shipping', !c.returns && 'returns', !c.warranty && 'warranty'].filter(Boolean).join(', ');
  const system = `You are the person who runs Instagram DMs for ${c.businessName || 'this store'}. You are a top-performing salesperson and the expert on these products: you know every detail in the facts below and you love helping people pick the right thing.

VOICE: ${c.brandVoice || 'warm, casual, short'}. Text like a real person on their phone: 1 to 3 short sentences, contractions, plain words, no lists or bullet points, no sign-offs, at most one exclamation mark, match the customer's energy and formality. Never sound like a script or a bot. Never write "Thank you for reaching out", "I hope this helps", "Great question", "As an AI", or mention being an AI, a bot, a language model or an assistant unless they directly ask.

WHO WE HELP: ${c.idealCustomer || 'our customers'}

HOW YOU SELL (consultative, never pushy):
1. Read the whole conversation first. Never ask something already answered and never repeat yourself.
2. Answer exactly what they asked, with a specific detail from the facts (a number, a feature, what's in the box). Specifics build trust.
3. Find out what they need with at most ONE short question per reply, and only when it helps (e.g. "${c.qualifyingQuestion || 'What are you hoping it will do for you?'}"). Ask the qualifying question at most once in the whole chat.
4. Connect the product to THEIR situation using their own words (a gift, their bedroom, their budget), not a generic feature list. Pick the one or two most relevant points.
5. When they show buying signals (asking price, shipping to them, colours, "how do I order", "I'll take it"), make it easy: give the matching checkout link with a short confident line. When it genuinely fits, mention the upsell once.
6. If they decline or go quiet, be gracious and leave the door open. Never pitch again after a no.

PERSUASION TECHNIQUES (use naturally, one or two per reply at most, and only with true facts):
- Mirror and label: reflect their words and feeling first ("sounds like you want her room to feel extra cosy").
- Paint the picture: help them imagine using it ("picture that warm glow behind her when she's filming").
- Benefit over feature: say what a feature does for them, not just what it is.
- Easy yes: ask small, easy questions that move forward ("classic sunset or colourful?") rather than big ones.
- Choice close: when they're ready, offer two good options instead of yes/no ("one lamp, or the 2-pack so your friend gets one too?").
- Assumptive next step: once they've said yes, talk about the next step as natural ("here's the link, takes a minute").
- Remove risk: answer doubts with the real safety nets in the facts (returns, warranty, free shipping, tracking).
- Social proof: ONLY the real testimonials below, word for word. If there are none, don't mention other customers.
- Feel, felt, found: only when a real testimonial or fact backs the "found" part.
- Reciprocity: give genuinely useful tips (where to place it, best for photos) before asking for anything.
- Contrast: compare options inside our range (single vs 2-pack) using only real prices.
NEVER: fake scarcity or deadlines, invented discounts, guilt or shame, pressure after a no, exaggerated claims, or pushing someone who says they can't afford it. If they're unsure, make the next step small, not louder.

HARD RULES:
- Use ONLY the facts below for prices, features, specs, policies and delivery times. If it isn't in the facts, say you'll check and set recommended_action to "handoff". ${missing ? `There is NO information about: ${missing}. Do not guess these.` : ''}
- Never promise health, sleep, income or results benefits. Never ask for card details.
- Order problems (late, damaged, wrong item), complaints, refund requests, or legal/medical/financial questions: set recommended_action to "handoff".
- Never claim to be human.

FACTS (cite the [ids] you used in knowledge_source_ids):
${facts}

OUTPUT: reply with ONLY one JSON object, nothing else:
{"intent": "...", "lead_stage": "...", "response_text": "...", "confidence": 0.0-1.0, "knowledge_source_ids": ["..."], "recommended_action": "reply" | "handoff" | "ignore", "handoff_reason": null or "...", "cta_id": null or a product id or "booking"}
intent and lead_stage are each one of: interested, needs_more_information, not_a_fit, booking_ready, purchase_ready, complaint, human_requested, opt_out.`;
  const prompt = [...i.history.slice(-10).map((m) => `${m.direction === 'in' ? 'Person' : 'Store'}: ${m.text}`), `Person: ${i.latest}`].join('\n');
  return { system, prompt };
}

/** What a business still needs to tell the setter before it can sell well. */
export function profileGaps(c: AgentConfig): { field: string; why: string }[] {
  const g: { field: string; why: string }[] = [];
  if (!c.businessName) g.push({ field: 'Business name', why: 'it signs its replies as your store' });
  if (!c.offers.length) g.push({ field: 'At least one product with a price and checkout link', why: 'it cannot quote prices or send a link without one' });
  if (c.offers.some((o) => !o.details)) g.push({ field: 'Product details', why: 'specific answers (sizes, features, what is in the box) are what close sales' });
  if (!c.shipping) g.push({ field: 'Shipping', why: 'delivery is the most common question; without it the chat comes to you' });
  if (!c.returns) g.push({ field: 'Returns', why: 'returns are the best answer to "not sure"' });
  if (!c.warranty) g.push({ field: 'Warranty', why: 'it cannot reassure people about faults' });
  if (!c.sellingPoints?.length) g.push({ field: 'Why people buy', why: 'it needs your strongest true reasons to recommend the product' });
  if (!c.objections?.length) g.push({ field: 'Answers to hesitations', why: 'your own words for price, timing and trust worries sell better' });
  if (!c.qualifyingQuestion) g.push({ field: 'One question to understand the buyer', why: 'it helps match the product to the person' });
  return g;
}

/** Uses any text model behind the existing provider registry interface. */
export function llmAgent(llm: { generate(i: { prompt: string; system?: string }): Promise<{ text: string }> }, name = 'llm'): SetterAgent {
  return { name, async decide(i) { const p = buildPrompt(i); return (await llm.generate(p)).text; } };
}

const pick = (seed: string, options: string[]): string => { let h = 0; for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return options[h % options.length]!; };
const lcFirst = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);
const price = (minor: number): string => `$${(minor / 100).toFixed(minor % 100 ? 2 : 0)}`;
const words = (s: string): Set<string> => new Set(s.toLowerCase().match(/[a-z0-9]+/g) ?? []);
const overlap = (a: string, b: string): number => { const x = words(a); let n = 0; for (const w of words(b)) if (w.length > 3 && x.has(w)) n++; return n; };

export const ruleAgent: SetterAgent = {
  name: 'rules',
  async decide({ config: c, latest, history }): Promise<AgentDecision> {
    const t = latest.toLowerCase();
    const alreadyAsked = !!c.qualifyingQuestion && history.some((m) => m.direction === 'out' && m.text.includes(c.qualifyingQuestion));
    const base = { knowledge_source_ids: [] as string[], handoff_reason: null as string | null, cta_id: null as string | null };
    if (/\b(scam|complain|angry|terrible|chargeback|never arrived|still waiting|where is my order)\b/.test(t)) return { ...base, intent: 'complaint', lead_stage: 'complaint', response_text: '', confidence: 0.9, recommended_action: 'handoff', handoff_reason: 'complaint or order problem' };
    const faq = c.knowledge.map((k) => ({ k, s: overlap(t, k.question) })).sort((a, b) => b.s - a.s)[0];
    const offer = c.offers.map((o) => ({ o, s: overlap(t, `${o.name} ${o.description}`) })).sort((a, b) => b.s - a.s)[0];
    const wantsBuy = /\b(buy|price|cost|how much|link|order|purchase|get one|i'?ll take)\b/.test(t);
    // A price objection is answered with the prepared comparison, not treated as a "no".
    const compare = c.knowledge.find((k) => k.id === 'faq-compare');
    if (/\b(expensive|pricey|cheaper|budget|afford|kmart|amazon|temu|worth it)\b/.test(t) && !/\bhow much\b/.test(t) && compare) return { ...base, intent: 'needs_more_information', lead_stage: 'needs_more_information', response_text: compare.answer, confidence: 0.75, recommended_action: 'reply', knowledge_source_ids: [compare.id] };
    if (/\b(not interested|no thanks|nah|maybe later)\b/.test(t)) return { ...base, intent: 'not_a_fit', lead_stage: 'not_a_fit', response_text: pick(t, ['All good, no pressure at all. Shout if anything changes.', 'Totally fair. If you ever want it down the track, just message me here.']), confidence: 0.8, recommended_action: 'reply' };
    if (/\b(book|call|appointment)\b/.test(t) && c.bookingUrl) return { ...base, intent: 'booking_ready', lead_stage: 'booking_ready', response_text: pick(t, [`Yep! Easiest is to grab a time that suits you here: ${c.bookingUrl}`, `For sure, you can pick a time here: ${c.bookingUrl}`]), confidence: 0.8, recommended_action: 'reply', cta_id: 'booking', knowledge_source_ids: ['booking'] };
    // A clear product question (2+ matching words) is answered before any pitch.
    if (faq && faq.s >= 2 && !(wantsBuy && (offer?.s ?? 0) >= faq.s)) return { ...base, intent: 'needs_more_information', lead_stage: 'needs_more_information', response_text: faq.k.answer, confidence: 0.75, recommended_action: 'reply', knowledge_source_ids: [faq.k.id] };
    if (wantsBuy && offer) {
      const o = /\b(2|two)[ -]?pack|bundle|both|two of\b/.test(t) ? c.offers.find((x) => /2-pack|bundle/i.test(x.name)) ?? offer.o : offer.o;
      return { ...base, intent: 'purchase_ready', lead_stage: 'purchase_ready', response_text: `It's ${price(o.priceMinor)} for the ${o.name}${o.description ? `, ${lcFirst(o.description).replace(/[.!]+$/, '')}` : ''}. ${pick(t, ["Here's the link if you want it:", 'You can grab it here:', 'Link is here whenever you want it:'])} ${o.ctaUrl}`, confidence: 0.75, recommended_action: 'reply', cta_id: o.id, knowledge_source_ids: [o.id] };
    }
    if (faq && faq.s > 0) return { ...base, intent: 'needs_more_information', lead_stage: 'needs_more_information', response_text: faq.k.answer, confidence: 0.7, recommended_action: 'reply', knowledge_source_ids: [faq.k.id] };
    if (c.qualifyingQuestion && !alreadyAsked) return { ...base, intent: 'interested', lead_stage: 'interested', response_text: `${pick(t, ['Hey! ', 'Hi! ', 'Hey, thanks for the message. '])}${c.qualifyingQuestion}`, confidence: 0.6, recommended_action: 'reply' };
    return { ...base, intent: 'needs_more_information', lead_stage: 'needs_more_information', response_text: '', confidence: 0.2, recommended_action: 'handoff', handoff_reason: 'no matching fact' };
  },
};
