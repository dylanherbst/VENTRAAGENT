// Per-business agent settings (multi-tenant): what the AI Setter and AI Receptionist say and do for one workspace.
// Stored in public.fo_agent_settings (owner edits at /tools/front-office-settings); webhooks read them with their
// channel key (fo_channel_settings). Anything missing falls back to the template, so a business can start with a name.
import { checkedAvailability } from './calendar/slots';
import type { Availability } from './calendar/slots';
import type { ChannelAuth, Rpc } from './orchestrator';
import { checkedSetterConfig, ventraSetterConfig } from './setter/config';
import type { QualificationQuestion, SetterConfig } from './setter/config';
import { gymQuestions, gymTemplate } from './templates/gym';
import { ventraTemplate } from './templates/ventra';

export const templates = ['gym', 'ventra', 'custom'] as const;
export type TemplateId = typeof templates[number];
export type Faq = { q: string; a: string };
/** One thing the business sells. priceAud null: the owner has not given a price, so the AI never states one. */
export type Service = { id: string; name: string; description: string; priceAud: number | null; priceUnit: string; durationMinutes: number | null };
/** A current offer, exactly as the owner wrote it. validUntil "YYYY-MM-DD" (inclusive, business time zone) or null. */
export type KnowledgeOffer = { id: string; name: string; details: string; priceAud: number | null; validUntil: string | null };
export type Policy = { id: string; topic: string; text: string };
/** How to answer a kind of push-back. Any trigger phrase in the contact's words selects it; escalate: a person follows up. */
export type ObjectionRule = { id: string; triggers: string[]; response: string; escalate: boolean };
/** The business's own knowledge (A-16). Stored as settings.knowledge in fo_agent_settings.data; FAQs stay in settings.faqs. */
export type KnowledgeBase = { services: Service[]; offers: KnowledgeOffer[]; policies: Policy[]; objections: ObjectionRule[] };
export const emptyKnowledge = (): KnowledgeBase => ({ services: [], offers: [], policies: [], objections: [] });
/** Weekly booking hours, keyed "0" (Sunday) to "6", each window "HH:MM" to "HH:MM" in timeZone. */
export type Hours = Partial<Record<'0' | '1' | '2' | '3' | '4' | '5' | '6', [string, string][]>>;
export type AgentSettings = {
  template: TemplateId;
  businessName: string;
  /** What the AI books or sells, in a sentence or two. */
  offer: string;
  idealCustomer: string;
  notAFit: string;
  bookingType: string;
  bookingWhere: string;
  bookingMinutes: number;
  timeZone: string;
  hours: Hours;
  questions: QualificationQuestion[];
  /** Written by the business. The AI answers factual questions from these only. */
  faqs: Faq[];
  /** Services and prices, offers, policies and objection rules. Settings saved before A-16 have none: empty lists. */
  knowledge: KnowledgeBase;
  staffPhone: string | null;
  staffEmail: string | null;
  /** Where the Receptionist puts urgent callers through. None: it takes a message instead. */
  transferNumber: string | null;
  greeting: string;
  aiDisclosure: string;
  /** Read at the start of every call when set (for example when Vapi records calls). Empty: not read. */
  recordingNotice: string;
  setterOn: boolean;
  receptionistOn: boolean;
  voiceOn: boolean;
};

const E164 = /^\+[1-9][0-9]{6,14}$/, EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/, HHMM = /^([01][0-9]|2[0-3]):([0-5][0-9])$/;
const s = (v: unknown, field: string, max: number, required = false): string => {
  if (v === undefined || v === null) v = '';
  if (typeof v !== 'string') throw new Error(`${field} must be text.`);
  const t = v.trim();
  if (required && !t) throw new Error(`${field} is required.`);
  if (t.length > max) throw new Error(`${field} must be ${max} characters or fewer.`);
  return t;
};
const optional = (v: unknown, field: string, re: RegExp, hint: string): string | null => {
  const t = s(v, field, 254).replace(field.includes('phone') || field.includes('number') ? /[\s()-]/g : /$^/, '');
  if (!t) return null;
  if (!re.test(t)) throw new Error(`${field} ${hint}`);
  return field.includes('mail') ? t.toLowerCase() : t;
};

const KID = /^[a-z][a-z0-9_-]{0,39}$/, DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;
const list = (v: unknown, field: string, max: number): unknown[] => {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new Error(`${field} must be a list.`);
  if (v.length > max) throw new Error(`Use ${max} ${field.toLowerCase()} or fewer.`);
  return v;
};
const rec = (v: unknown, field: string): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`${field} must be an object.`);
  return v as Record<string, unknown>;
};
/** An owner-given id, or one made from the position. Unique within its list. */
const kid = (v: unknown, field: string, fallback: string, seen: Set<string>): string => {
  const id = s(v, `${field} id`, 40) || fallback;
  if (!KID.test(id) || seen.has(id)) throw new Error(`${field} id must be unique, lower case letters, numbers, - or _.`);
  seen.add(id);
  return id;
};
/** Dollars (AUD), up to two decimals, or null when not given. Never a guess: blank stays null. */
const price = (v: unknown, field: string): number | null => {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\s*\$?\d+(\.\d{1,2})?\s*$/.test(v) ? Number(v.replace(/[$\s]/g, '')) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000 || Math.abs(Math.round(n * 100) - n * 100) > 1e-6) throw new Error(`${field} must be a dollar amount like 29 or 29.50, or left blank.`);
  return Math.round(n * 100) / 100;
};
const minutes = (v: unknown, field: string): number | null => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 5 || n > 1440) throw new Error(`${field} must be 5 to 1440 minutes, or left blank.`);
  return n;
};

/** Validate the knowledge base. Missing (settings saved before A-16): empty lists, so older settings keep working. */
export function checkedKnowledge(x: unknown): KnowledgeBase {
  if (x === undefined || x === null) return emptyKnowledge();
  const o = rec(x, 'Knowledge base');
  const ids = { s: new Set<string>(), o: new Set<string>(), p: new Set<string>(), r: new Set<string>() };
  const services = list(o.services, 'Services', 50).map((v, i): Service => {
    const r = rec(v, `Service ${i + 1}`), f = `Service ${i + 1}`;
    return { id: kid(r.id, f, `service_${i + 1}`, ids.s), name: s(r.name, `${f} name`, 120, true), description: s(r.description, `${f} description`, 400), priceAud: price(r.priceAud, `${f} price`), priceUnit: s(r.priceUnit, `${f} price unit`, 40), durationMinutes: minutes(r.durationMinutes, `${f} length`) };
  });
  const offers = list(o.offers, 'Offers', 20).map((v, i): KnowledgeOffer => {
    const r = rec(v, `Offer ${i + 1}`), f = `Offer ${i + 1}`;
    const until = s(r.validUntil, `${f} end date`, 10);
    if (until && !DATE.test(until)) throw new Error(`${f} end date must be YYYY-MM-DD, or left blank.`);
    return { id: kid(r.id, f, `offer_${i + 1}`, ids.o), name: s(r.name, `${f} name`, 120, true), details: s(r.details, `${f} details`, 600, true), priceAud: price(r.priceAud, `${f} price`), validUntil: until || null };
  });
  const policies = list(o.policies, 'Policies', 30).map((v, i): Policy => {
    const r = rec(v, `Policy ${i + 1}`), f = `Policy ${i + 1}`;
    return { id: kid(r.id, f, `policy_${i + 1}`, ids.p), topic: s(r.topic, `${f} topic`, 80, true), text: s(r.text, `${f} text`, 800, true) };
  });
  const objections = list(o.objections, 'Objection rules', 20).map((v, i): ObjectionRule => {
    const r = rec(v, `Objection rule ${i + 1}`), f = `Objection rule ${i + 1}`;
    const triggers = list(r.triggers, `${f} trigger phrases`, 10).map((t, j) => {
      const v = s(t, `${f} trigger ${j + 1}`, 60, true).toLowerCase().replace(/\s+/g, ' ');
      if (v.length < 4) throw new Error(`${f} trigger ${j + 1} must be at least 4 characters.`);
      return v;
    });
    if (!triggers.length) throw new Error(`${f} needs at least one trigger phrase.`);
    return { id: kid(r.id, f, `objection_${i + 1}`, ids.r), triggers, response: s(r.response, `${f} response`, 500, true), escalate: r.escalate === true };
  });
  return { services, offers, policies, objections };
}

/** "$80 per session", "$29.50", "free". */
export function formatPriceAud(aud: number, unit = ''): string {
  const p = aud === 0 ? 'free' : `$${Number.isInteger(aud) ? aud : aud.toFixed(2)}`;
  return unit && aud !== 0 ? `${p} ${unit}` : p;
}
/** Today in the business's time zone, YYYY-MM-DD. */
const today = (now: number, timeZone: string) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
/** Offers still running on this day (no end date, or the end date is today or later). */
export function activeOffers(k: KnowledgeBase, now: number, timeZone: string): KnowledgeOffer[] {
  const d = today(now, timeZone);
  return k.offers.filter(o => !o.validUntil || o.validUntil >= d);
}

const STOP = new Set('the and for are you your our with what how much does can have when where which this that from about there their them they is it to of in on at a an do i we be or if my me any cost costs price prices pricing charge charges fee fees rate rates pay would will please tell know'.split(' '));
const words = (t: string) => new Set(t.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP.has(w)).map(w => w.replace(/(ss|sh|ch|x)es$/, '$1').replace(/([^s])s$/, '$1')));
const norm = (t: string) => ` ${t.toLowerCase().replace(/[^a-z0-9$\s]/g, ' ').replace(/\s+/g, ' ').trim()} `;
const overlap = (q: Set<string>, t: string) => { let n = 0; for (const w of words(t)) if (q.has(w)) n++; return n; };
const PRICE_Q = /\b(price|prices|pricing|cost|costs|how much|fee|fees|rate|rates|charge|charges)\b|\$/i;
const OFFER_Q = /\b(offer|offers|deal|deals|special|specials|promo|promotion|intro)\b/i;

/** What the business's own knowledge says about a question. Nothing here is generated: every answer is the owner's text. */
export type KnowledgeAnswer = {
  /** A matched objection rule: answer with its response (and hand to a person when escalate is set). */
  objection: ObjectionRule | null;
  /** Answers to state, best first: { topic, answer } in the owner's words. */
  answers: { topic: string; answer: string }[];
  /** Price question about something with no price on file (or no price list at all): names it, so the AI can say it will check. */
  missingPrice: string[];
  priceQuestion: boolean;
};
export function knowledgeAnswer(question: string, st: Pick<AgentSettings, 'knowledge' | 'faqs' | 'timeZone'>, now: number, max = 3): KnowledgeAnswer {
  const k = st.knowledge ?? emptyKnowledge(), q = words(question), n = norm(question);
  const objection = k.objections.find(r => r.triggers.some(t => n.includes(norm(t)))) ?? null;
  const priceQuestion = PRICE_Q.test(question);
  const answers: { topic: string; answer: string; score: number }[] = [];
  const missingPrice: string[] = [];
  const serviceLine = (x: Service) => `${x.name}: ${x.priceAud === null ? 'price not on file' : formatPriceAud(x.priceAud, x.priceUnit)}${x.durationMinutes ? `, ${x.durationMinutes} minutes` : ''}.${x.description ? ' ' + x.description : ''}`;
  // A service is named only when every word of its name is in the question, or at least two are: one shared generic
  // word ("session") must never answer "a yoga session?" with "Free trial session".
  const namedBy = (x: Service) => { const nw = words(x.name), hit = overlap(q, x.name); return nw.size > 0 && (hit === nw.size || hit >= 2); };
  let named: { x: Service; score: number }[] = k.services.filter(namedBy).map(x => ({ x, score: overlap(q, x.name) * 3 + overlap(q, x.description) }));
  // "How much is it?" with nothing else in it: the whole price list (it is short). A price question naming something
  // that is not listed ("how much is membership?") is never answered with another service's price.
  if (!named.length && priceQuestion && !q.size) named = k.services.map(x => ({ x, score: 1 }));
  for (const { x, score } of named) {
    if (priceQuestion && x.priceAud === null) missingPrice.push(x.name);
    else answers.push({ topic: x.name, answer: serviceLine(x), score: score + 1 });
  }
  for (const o of activeOffers(k, now, st.timeZone)) {
    const score = overlap(q, o.name) * 3 + overlap(q, o.details) + (OFFER_Q.test(question) ? 3 : 0);
    if (score >= 3) answers.push({ topic: o.name, answer: `${o.name}: ${o.details}${o.priceAud !== null ? ` (${formatPriceAud(o.priceAud)})` : ''}${o.validUntil ? `. Ends ${o.validUntil}.` : ''}`, score });
  }
  for (const p of k.policies) { const score = overlap(q, p.topic) * 3 + overlap(q, p.text); if (score >= 3) answers.push({ topic: p.topic, answer: p.text, score }); }
  for (const f of st.faqs) { const score = overlap(q, f.q) * 2 + overlap(q, f.a); if (score >= 2) answers.push({ topic: f.q, answer: f.a, score }); }
  if (priceQuestion && !named.length && !answers.length && !objection) missingPrice.push('that');
  answers.sort((a, b) => b.score - a.score);
  return { objection, answers: answers.slice(0, max).map(({ topic, answer }) => ({ topic: topic.replace(/\s+/g, ' ').trim(), answer: answer.replace(/\s+/g, ' ').trim() })), missingPrice, priceQuestion };
}

/** Starting knowledge for a template. Prices the business has not given stay null: the AI says it will check. */
export function templateKnowledge(template: TemplateId): KnowledgeBase {
  if (template === 'ventra') return {
    services: [
      // Free only because Ventra's own facts say so (setter/config.ts); otherwise null.
      { id: 'strategy_call', name: 'Strategy call', description: 'A phone call with a person from Ventra.', priceAud: ventraTemplate.facts.some(f => /strategy call is free/i.test(f)) ? 0 : null, priceUnit: '', durationMinutes: ventraTemplate.bookingMinutes },
      { id: 'ai_front_office', name: 'AI front office', description: 'AI Setter, AI Sales agent and AI Receptionist, set up for you.', priceAud: null, priceUnit: '', durationMinutes: null },
    ],
    offers: [], policies: [],
    objections: [
      { id: 'price', triggers: ['too expensive', 'cannot afford', "can't afford", 'out of my budget'], response: 'Fair question. I do not have pricing in front of me, but a person from Ventra can go through it on the free 30-minute call. Want me to find a time?', escalate: false },
      { id: 'think', triggers: ['think about it', 'not sure yet', 'maybe later', 'not right now'], response: 'No rush. Would a time later this week suit for the call?', escalate: false },
    ],
  };
  if (template === 'gym') return {
    services: [
      // Only what the gym template itself offers. Memberships, classes and their prices are the gym's to add.
      // Free only because the gym template's own offer says "free trial" (templates/gym.ts); otherwise null.
      { id: 'trial', name: 'Free trial session', description: 'Try the gym before joining.', priceAud: /\bfree trial\b/i.test(gymTemplate.offer) ? 0 : null, priceUnit: '', durationMinutes: gymTemplate.bookingMinutes },
    ],
    offers: [], policies: [],
    objections: [
      { id: 'price', triggers: ['too expensive', 'cannot afford', "can't afford"], response: 'That is fair. The trial session is free, so you can see if it suits before spending anything. Want me to find you a time?', escalate: false },
      { id: 'think', triggers: ['think about it', 'not sure yet', 'maybe later'], response: 'No rush at all. Happy to hold a trial time for you, and you can decide after.', escalate: false },
    ],
  };
  return emptyKnowledge();
}

/** Validate settings from the owner or the database. Throws a plain-English message on the first problem. */
export function checkedAgentSettings(x: unknown): AgentSettings {
  if (!x || typeof x !== 'object' || Array.isArray(x)) throw new Error('Settings must be an object.');
  const o = x as Record<string, unknown>;
  if (!templates.includes(o.template as TemplateId)) throw new Error('Choose a template: gym, ventra or custom.');
  const questions = Array.isArray(o.questions) ? o.questions : [];
  if (questions.length < 3 || questions.length > 5) throw new Error('Use 3 to 5 qualifying questions.');
  const ids = new Set<string>();
  const qs: QualificationQuestion[] = questions.map((q, i) => {
    const r = (q ?? {}) as Record<string, unknown>;
    const id = s(r.id, `Question ${i + 1} id`, 40, true);
    if (!/^[a-z][a-z0-9_]{1,39}$/.test(id) || ids.has(id)) throw new Error(`Question ${i + 1} id must be unique, lower case letters, numbers or _.`);
    ids.add(id);
    return { id, ask: s(r.ask, `Question ${i + 1}`, 300, true), required: r.required !== false };
  });
  if (!qs.some(q => q.required)) throw new Error('Make at least one question required.');
  const faqsIn = Array.isArray(o.faqs) ? o.faqs : [];
  if (faqsIn.length > 40) throw new Error('Use 40 FAQs or fewer.');
  const faqs = faqsIn.map((f, i) => { const r = (f ?? {}) as Record<string, unknown>; return { q: s(r.q, `FAQ ${i + 1} question`, 200, true), a: s(r.a, `FAQ ${i + 1} answer`, 600, true) }; });
  const hoursIn = (o.hours && typeof o.hours === 'object' && !Array.isArray(o.hours) ? o.hours : {}) as Record<string, unknown>;
  const hours: Hours = {};
  for (const [day, windows] of Object.entries(hoursIn)) {
    if (!/^[0-6]$/.test(day)) throw new Error('Hours use days 0 (Sunday) to 6 (Saturday).');
    if (!Array.isArray(windows) || windows.length > 4) throw new Error('Use up to 4 time windows a day.');
    const list = windows.map(w => {
      if (!Array.isArray(w) || w.length !== 2 || !HHMM.test(String(w[0])) || !HHMM.test(String(w[1]))) throw new Error('Hours must be HH:MM to HH:MM.');
      if (String(w[1]) <= String(w[0])) throw new Error(`Window ${w[0]}-${w[1]} must end after it starts.`);
      return [String(w[0]), String(w[1])] as [string, string];
    });
    if (list.length) hours[day as keyof Hours] = list;
  }
  const bookingMinutes = Number(o.bookingMinutes);
  if (!Number.isInteger(bookingMinutes) || bookingMinutes < 10 || bookingMinutes > 240) throw new Error('Booking length must be 10 to 240 minutes.');
  const timeZone = s(o.timeZone, 'Time zone', 60, true);
  checkedAvailability({ timeZone, weekly: {}, slotMinutes: bookingMinutes, bufferMinutes: 0, minNoticeMinutes: 0, horizonDays: 14 });
  return {
    template: o.template as TemplateId,
    businessName: s(o.businessName, 'Business name', 160, true),
    offer: s(o.offer, 'What you book or sell', 600, true),
    idealCustomer: s(o.idealCustomer, 'Good fit', 400),
    notAFit: s(o.notAFit, 'Not a fit', 400),
    bookingType: s(o.bookingType, 'Booking type', 80, true),
    bookingWhere: s(o.bookingWhere, 'Where the booking happens', 80, true),
    bookingMinutes, timeZone, hours, questions: qs, faqs, knowledge: checkedKnowledge(o.knowledge),
    staffPhone: optional(o.staffPhone, 'Staff phone', E164, 'must be a mobile like +61412345678.'),
    staffEmail: optional(o.staffEmail, 'Staff email', EMAIL, 'is not a valid email.'),
    transferNumber: optional(o.transferNumber, 'Transfer number', E164, 'must be a number like +61812345678.'),
    greeting: s(o.greeting, 'Greeting', 200, true),
    aiDisclosure: s(o.aiDisclosure, 'AI disclosure', 200, true),
    recordingNotice: s(o.recordingNotice, 'Recording notice', 300),
    setterOn: o.setterOn !== false, receptionistOn: o.receptionistOn !== false, voiceOn: o.voiceOn === true,
  };
}

const fill = (t: string, business: string) => t.replace(/\{business\}/g, business);
const hoursFromWeekly = (w: Availability['weekly']): Hours => Object.fromEntries(Object.entries(w).map(([d, ws]) => [d, (ws ?? []).map(x => [x[0], x[1]])])) as Hours;

/** Starting settings for a new business. Gym: FAQs and hours empty on purpose (only the gym can state them). */
export function templateSettings(template: TemplateId, businessName = ''): AgentSettings {
  if (template === 'ventra') {
    const v = ventraTemplate;
    return {
      template, businessName: businessName || v.businessName, offer: v.offer, idealCustomer: v.idealCustomer, notAFit: v.notAFit,
      bookingType: v.bookingType, bookingWhere: v.bookingWhere, bookingMinutes: v.bookingMinutes, timeZone: v.timeZone,
      hours: hoursFromWeekly(v.weekly), questions: v.questions.map(q => ({ ...q })), faqs: v.facts.map(f => ({ q: 'About Ventra', a: f })),
      knowledge: templateKnowledge('ventra'), staffPhone: null, staffEmail: null, transferNumber: null, greeting: v.greeting, aiDisclosure: v.aiDisclosure, recordingNotice: '',
      setterOn: true, receptionistOn: true, voiceOn: false,
    };
  }
  const g = gymTemplate;
  return {
    template, businessName, offer: g.offer, idealCustomer: g.idealCustomer, notAFit: g.notAFit,
    bookingType: g.bookingType, bookingWhere: g.bookingWhere, bookingMinutes: g.bookingMinutes, timeZone: 'Australia/Perth',
    hours: {}, questions: gymQuestions.map(q => ({ ...q })), faqs: [], knowledge: templateKnowledge(template),
    staffPhone: null, staffEmail: null, transferNumber: null, greeting: g.greeting, aiDisclosure: g.aiDisclosure, recordingNotice: '',
    setterOn: true, receptionistOn: true, voiceOn: false,
  };
}

export function availabilityFor(st: AgentSettings): Availability {
  const weekly: Availability['weekly'] = {};
  for (const [d, ws] of Object.entries(st.hours)) weekly[Number(d) as 0] = ws;
  return checkedAvailability({ timeZone: st.timeZone, weekly, slotMinutes: st.bookingMinutes, bufferMinutes: 15, minNoticeMinutes: 120, horizonDays: 14 });
}

/** The Setter's config for this business: its own words, questions and knowledge base, the template's follow-up texts.
 * The knowledge base rides along on the config object (SetterConfig itself has no field for it); setterSystemPrompt
 * reads it. */
export function setterConfigFor(st: AgentSettings): SetterConfig & { knowledge: KnowledgeBase } {
  const t = st.template === 'ventra' ? ventraTemplate : gymTemplate;
  const b = st.businessName;
  return withKnowledge(checkedSetterConfig({
    businessName: b, offer: st.offer, idealCustomer: st.idealCustomer || 'People who want what we offer.', notAFit: st.notAFit || 'Spam, job seekers and sales pitches.',
    questions: st.questions, meetingTitle: st.bookingType, where: st.bookingWhere, availability: availabilityFor(st),
    facts: st.faqs.map(f => `${f.q} ${f.a}`),
    followUps: t.followUps.map(x => fill(x, b)), reminder24h: fill(t.reminder24h, b), reminder2h: fill(t.reminder2h, b), noShowRescue: t.noShowRescue.map(x => fill(x, b)),
  }), st.knowledge ?? emptyKnowledge());
}
/** Attach the knowledge base to the same config object (checkedSetterConfig returns its input, so identity is kept). */
function withKnowledge(c: SetterConfig, knowledge: KnowledgeBase): SetterConfig & { knowledge: KnowledgeBase } {
  return Object.assign(c, { knowledge });
}

/** This channel's business settings, or null (not saved yet, invalid, or the database is unreachable). */
export async function loadAgentSettings(rpc: Rpc, auth: ChannelAuth): Promise<AgentSettings | null> {
  try {
    const raw = await rpc('fo_channel_settings', { channel: auth.channel, channel_key: auth.key });
    return raw ? checkedAgentSettings(raw) : null;
  } catch { return null; }
}

/** What the Setter runs with on this channel. No saved settings: Ventra's own config (customer zero). */
export async function loadSetter(rpc: Rpc, auth: ChannelAuth, fallback: SetterConfig = ventraSetterConfig): Promise<{ config: SetterConfig; on: boolean; settings: AgentSettings | null }> {
  const st = await loadAgentSettings(rpc, auth);
  if (!st) return { config: fallback, on: true, settings: null };
  try { return { config: setterConfigFor(st), on: st.setterOn, settings: st }; } catch { return { config: fallback, on: st.setterOn, settings: st }; }
}
