// Sales agent configuration per client (tracker 2.6, 2.7). The agent never invents pricing, discounts or guarantees:
// it can only state what is in this config, and anything outside it goes to a person.
// OWNER: Ventra's packages have no prices yet and no guarantees or discounts are approved, so for now every quote and
// every close escalates to a person. See docs/agents/OWNER_TODO.md (Sales decisions).

export type SalesPackage = {
  id: string;
  name: string;
  /** What is included, in plain words the agent can repeat. */
  description: string;
  /** Price in whole Australian dollars, or null when not set (the agent then cannot quote it). */
  priceAud: number | null;
  /** How it is billed: "per month", "one-off setup". */
  billing: string;
};
export type SalesDiscount = { id: string; description: string; percent: number };
export type Objection = {
  id: string;
  /** How a lead usually says it. */
  objection: string;
  /** The first answer, using only facts from the config. */
  response: string;
  /** What to do if the first answer does not land: usually a dated next step or a person. */
  fallback: string;
};
export type SalesConfig = {
  businessName: string;
  packages: SalesPackage[];
  /** Guarantees the agent may state, word for word. Empty: it must not promise any. */
  guarantees: string[];
  /** Discounts the agent may offer without a person. Empty: none. */
  allowedDiscounts: SalesDiscount[];
  /** Any deal above this value (AUD, after discount) goes to a person before it is closed. */
  escalateAboveAud: number;
  /** Facts the agent may state about how it works, terms and onboarding. Anything else goes to a person. */
  facts: string[];
  objections: Objection[];
};

export const ventraSalesConfig: SalesConfig = {
  businessName: 'Ventra',
  packages: [
    { id: 'launch', name: 'Launch', description: 'AI Setter on one channel: replies to every new lead, qualifies them with your questions and books them into your calendar, with follow-ups and reminders.', priceAud: null, billing: 'per month' },
    { id: 'grow', name: 'Grow', description: 'AI Setter across SMS, website chat and email, plus the AI Sales agent, set up and tuned for your business.', priceAud: null, billing: 'per month' },
  ],
  guarantees: [],
  allowedDiscounts: [],
  escalateAboveAud: 2000,
  facts: [
    'Ventra sets everything up for you: your questions, your calendar and your wording.',
    'Every message the AI sends is logged, and a person from your team can step in at any time.',
    'The AI says it is an AI assistant for your business; it never pretends to be a person.',
    'Leads who reply STOP are never messaged again.',
    'Ventra is based in Perth, Western Australia, and works with businesses across Australia.',
  ],
  objections: [
    { id: 'price', objection: 'It costs too much.', response: 'Ask what one lost lead is worth to them, and compare that with the package price exactly as configured.', fallback: 'Offer to book a dated follow-up after they have checked their numbers, or pass to a person.' },
    { id: 'think_about_it', objection: 'I need to think about it.', response: 'Ask what they still need to know to decide, and answer only from the facts.', fallback: 'Book a dated follow-up on a day they choose.' },
    { id: 'already_covered', objection: 'We already answer our leads.', response: 'Ask how fast replies go out after hours and on weekends, and what happens to people who go quiet.', fallback: 'Offer a dated follow-up once they have checked their reply times.' },
    { id: 'want_a_human', objection: 'My customers want to talk to a real person.', response: 'Explain the AI handles the first reply and booking, says it is an AI, and a person can step in at any time.', fallback: 'Pass to a person to talk it through.' },
    { id: 'tried_before', objection: 'We tried a tool like this and it did not work.', response: 'Ask what went wrong, and explain Ventra sets it up for them with their own questions and wording.', fallback: 'Book a dated follow-up or pass to a person.' },
    { id: 'no_time', objection: 'I do not have time to set this up.', response: 'Explain Ventra does the setup for them.', fallback: 'Offer to have a person run the setup call at a time that suits.' },
    { id: 'fit', objection: 'Not sure it works for my kind of business.', response: 'Repeat back what they said about their leads in discovery and link it to what the package does.', fallback: 'Pass to a person who can answer for their industry.' },
    { id: 'contract', objection: 'Am I locked into a contract?', response: 'Contract terms are not in the facts: say a person will confirm the exact terms.', fallback: 'Pass to a person.' },
    { id: 'privacy', objection: 'What happens to my customers’ data?', response: 'Say messages are stored only to reply and follow up, and point to the privacy policy.', fallback: 'Pass to a person for anything more specific.' },
    { id: 'send_info', objection: 'Just send me some information.', response: 'Offer to send a short summary by email and book a dated follow-up to go through it.', fallback: 'Book the dated follow-up.' },
  ],
};

export function checkedSalesConfig(c: SalesConfig): SalesConfig {
  if (!c.businessName.trim()) throw new Error('Sales config needs a business name.');
  if (!c.packages.length) throw new Error('Sales config needs at least one package.');
  const ids = new Set<string>();
  for (const p of c.packages) {
    if (!/^[a-z][a-z0-9_-]{1,39}$/.test(p.id) || ids.has(p.id)) throw new Error(`Package id "${p.id}" must be unique, lower case and short.`);
    ids.add(p.id);
    if (p.priceAud !== null && (!Number.isInteger(p.priceAud) || p.priceAud < 0)) throw new Error(`Package "${p.id}" price must be whole dollars or null.`);
  }
  const dIds = new Set<string>();
  for (const d of c.allowedDiscounts) {
    if (!/^[a-z][a-z0-9_-]{1,39}$/.test(d.id) || dIds.has(d.id)) throw new Error(`Discount id "${d.id}" must be unique, lower case and short.`);
    dIds.add(d.id);
    if (!(d.percent > 0 && d.percent <= 50)) throw new Error(`Discount "${d.id}" must be more than 0% and at most 50%.`);
  }
  if (!Number.isFinite(c.escalateAboveAud) || c.escalateAboveAud < 0) throw new Error('Escalation threshold must be zero or more.');
  if (c.objections.length < 1 || c.objections.length > 20) throw new Error('Use 1 to 20 objections in the playbook.');
  const oIds = new Set<string>();
  for (const o of c.objections) {
    if (!/^[a-z][a-z0-9_]{1,39}$/.test(o.id) || oIds.has(o.id)) throw new Error(`Objection id "${o.id}" must be unique, lower case and short.`);
    oIds.add(o.id);
    if (!o.objection.trim() || !o.response.trim() || !o.fallback.trim()) throw new Error(`Objection "${o.id}" needs an objection, a response and a fallback.`);
  }
  return c;
}

export type Quote = { packageId: string; name: string; billing: string; priceAud: number | null; discountId: string | null; totalAud: number | null; needsPerson: string | null };

/** The only way the agent gets a price: straight from the config, with an allowed discount. needsPerson says why it cannot close alone. */
export function quote(c: SalesConfig, packageId: string, discountId: string | null = null): Quote | null {
  const p = c.packages.find(x => x.id === packageId);
  if (!p) return null;
  const d = discountId ? c.allowedDiscounts.find(x => x.id === discountId) ?? null : null;
  if (discountId && !d) return { packageId: p.id, name: p.name, billing: p.billing, priceAud: p.priceAud, discountId, totalAud: null, needsPerson: 'That discount is not allowed.' };
  if (p.priceAud === null) return { packageId: p.id, name: p.name, billing: p.billing, priceAud: null, discountId: d?.id ?? null, totalAud: null, needsPerson: 'No price is set for this package yet.' };
  const total = d ? Math.round(p.priceAud * (100 - d.percent) / 100) : p.priceAud;
  return { packageId: p.id, name: p.name, billing: p.billing, priceAud: p.priceAud, discountId: d?.id ?? null, totalAud: total, needsPerson: total > c.escalateAboveAud ? `Deals above A$${c.escalateAboveAud} need a person.` : null };
}
