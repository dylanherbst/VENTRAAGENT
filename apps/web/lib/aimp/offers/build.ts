// Offer builder (must-have, 20 Nov 2026). The seller says what they know, who they want to help and what problem they can solve; we
// suggest three offers (checklist, workbook, guide), each with a target buyer, a price to TEST and a reason someone would pay. When the
// seller picks one, the finished PDF is built from THEIR words (steps and questions they can edit), so nothing is invented about
// results. No AI and no network: the same answers always give the same offers. A real model can later write the first draft of the
// steps; the seller still edits and approves.
import { allPages, deriveClaims, validateProductSpec } from '../factory/spec.ts';
import type { ProductSpec, SpecPage, SpecSection } from '../factory/spec.ts';
import { ProductFactoryError } from '../factory/generate.ts';

export interface OfferAnswers { knows: string; helps: string; problem: string }
export const offerFormats = ['checklist', 'workbook', 'guide'] as const;
export type OfferFormat = (typeof offerFormats)[number];

export interface Offer {
  id: OfferFormat;
  title: string;
  /** Who it is for, in the seller's own words. */
  buyer: string;
  /** What the buyer gets, as a plain description (never a result promise). */
  includes: string;
  /** A price to try first, in cents. A test, not a rule. */
  testPriceMinor: number;
  priceNote: string;
  /** Why someone would pay for this, based on what the seller said. */
  reason: string;
}

const MAX = 160;
const clean = (s: string): string => s.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
export function checkAnswers(a: OfferAnswers): string[] {
  const out: string[] = [];
  const f: [keyof OfferAnswers, string][] = [['knows', 'what you know'], ['helps', 'who you want to help'], ['problem', 'the problem you can solve']];
  for (const [k, label] of f) { const v = clean(String(a[k] ?? '')); if (v.length < 3) out.push(`Tell us ${label} (at least a few words).`); else if (v.length > MAX) out.push(`Keep ${label} under ${MAX} characters.`); }
  return out;
}

export const titleCase = (s: string): string => s.toLowerCase().replace(/(^|[\s-])([a-z])/g, (_m, p: string, c: string) => p + c.toUpperCase());
const topicOf = (knows: string): string => {
  const t = clean(knows).replace(/[.!?,;:]+$/, '');
  const cut = t.length > 40 ? t.slice(0, 40).replace(/\s+\S*$/, '') : t;
  return titleCase(cut || 'My');
};
const lower = (s: string): string => clean(s).replace(/[.!?]+$/, '');

export function buildOffers(a: OfferAnswers): { ok: true; offers: Offer[] } | { ok: false; errors: string[] } {
  const errors = checkAnswers(a);
  if (errors.length) return { ok: false, errors };
  const topic = topicOf(a.knows), who = lower(a.helps), problem = lower(a.problem);
  return {
    ok: true,
    offers: [
      { id: 'checklist', title: `${topic} Checklist`, buyer: who, testPriceMinor: 900, priceNote: 'Small and quick to use, so a low price is easy to say yes to.',
        includes: 'A short checklist they can work through in one sitting.', reason: `Someone who is ${who} and stuck on ${problem} can start today without reading a book.` },
      { id: 'workbook', title: `${topic} Workbook`, buyer: who, testPriceMinor: 1900, priceNote: 'A workbook asks for more effort, so test a middle price.',
        includes: 'Guided questions to write answers to, plus a checklist and notes pages.', reason: `It walks ${who} through ${problem} one question at a time, instead of leaving them to work it out alone.` },
      { id: 'guide', title: `${topic} Quick-Start Guide`, buyer: who, testPriceMinor: 2900, priceNote: 'The most complete option, so the highest price to test.',
        includes: 'A step-by-step guide with reflection questions, two checklists and notes pages.', reason: `It puts what you know about ${lower(a.knows)} in one place for ${who}, in the order you would teach it.` },
    ],
  };
}

export interface ProductContent {
  /** The steps or checklist items. Seller-edited. */
  steps: string[];
  /** Questions for the reader to answer. Seller-edited. */
  questions: string[];
}
const STEP_MAX = 110, MAX_STEPS = 24, MAX_QUESTIONS = 20;

/** A first draft the seller can edit. Plainly generic on purpose: it never claims anything about results. */
export function draftContent(a: OfferAnswers): ProductContent {
  const problem = lower(a.problem), knows = lower(a.knows);
  return {
    steps: [
      `Write down where you are now with ${problem}.`,
      `Write down what you would like to be different.`,
      `Gather what you already have that helps.`,
      `Pick one small first action and put a date on it.`,
      `Do that action and note what happened.`,
      `Look at what worked and what did not.`,
      `Choose the next action.`,
      `Come back to this page and tick off what is done.`,
    ].map((s) => s.slice(0, STEP_MAX)),
    questions: [
      `What does ${problem} look like for you right now?`,
      `What have you already tried?`,
      `What is one thing about ${knows} you want to understand better?`,
      `What would make the next step easier?`,
      `Who or what could help you?`,
      `What will you do this week?`,
    ],
  };
}

export function checkContent(c: ProductContent): string[] {
  const out: string[] = [];
  const lines = (label: string, list: unknown, min: number, max: number) => {
    if (!Array.isArray(list) || list.length < min || list.length > max) { out.push(`${label}: add between ${min} and ${max}.`); return; }
    list.forEach((x, i) => { const v = typeof x === 'string' ? clean(x) : ''; if (!v) out.push(`${label} ${i + 1} is empty.`); else if (v.length > STEP_MAX) out.push(`${label} ${i + 1} is over ${STEP_MAX} characters.`); });
  };
  lines('Step', c.steps, 3, MAX_STEPS);
  lines('Question', c.questions, 2, MAX_QUESTIONS);
  return out;
}

const chunk = <T>(xs: T[], n: number): T[][] => { const out: T[][] = []; for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n)); return out; };

/** The finished product as a spec the existing PDF renderer draws. Built only from the seller's answers and content. */
export function specFromOffer(offer: Offer, a: OfferAnswers, content: ProductContent, now: () => Date = () => new Date()): ProductSpec {
  const problems = [...checkAnswers(a), ...checkContent(content)];
  if (problems.length) throw new ProductFactoryError('The product needs fixing before it can be built.', problems);
  const steps = content.steps.map(clean), questions = content.questions.map(clean);
  const who = lower(a.helps);
  const perChecklist = offer.id === 'checklist' ? 8 : 6, perPrompts = 4;
  const checklistPages: SpecPage[] = chunk(steps, perChecklist).map((items, i, all) => ({ template: 'checklist', heading: all.length > 1 ? `Checklist ${i + 1} of ${all.length}` : 'Checklist', items }));
  const promptPages: SpecPage[] = chunk(questions, perPrompts).map((lines, i, all) => ({ template: 'prompts', heading: all.length > 1 ? `Questions ${i + 1} of ${all.length}` : 'Questions', lines }));
  const notes = (n: number): SpecPage[] => Array.from({ length: n }, (_, i) => ({ template: 'notes', heading: n > 1 ? `Notes ${i + 1}` : 'Notes' }));
  const subtitle = `For ${who}`;
  const sections: SpecSection[] = [
    { title: 'Start here', pages: [
      { template: 'cover', heading: offer.title, subheading: subtitle, lines: [`Written by the person who made it, for ${who}.`] },
      { template: 'howto', heading: 'How to use this', lines: ['Print it or fill it in on a tablet.', 'Work through it in order, one page at a time.', 'There are no wrong answers. Write what is true for you.'] },
    ] },
    offer.id === 'checklist' ? { title: 'Checklist', pages: checklistPages }
      : offer.id === 'workbook' ? { title: 'Workbook', pages: [...promptPages, ...checklistPages.slice(0, 1)] }
        : { title: 'Guide', pages: [...promptPages, ...checklistPages] },
    { title: 'Notes', pages: notes(offer.id === 'checklist' ? 1 : 2) },
  ];
  const spec: ProductSpec = {
    specVersion: 1, blueprint: { id: 'seller-workbook', version: '1.0.0' }, title: offer.title, subtitle, niche: clean(a.knows), audience: who,
    mode: 'live', generatedAt: now().toISOString(), paperSizes: ['a4', 'letter'], sections, claims: deriveClaims(sections),
    ai: { model: 'seller-written', note: 'Written by the seller. Not written by AI.' },
  };
  const check = validateProductSpec(spec);
  if (!check.ok) throw new ProductFactoryError('The product could not be built.', check.errors);
  return spec;
}

export const pageCount = (spec: ProductSpec): number => allPages(spec).length;
/** What the shop may say the buyer gets: exactly the pages that exist. */
export const buyerGets = (spec: ProductSpec): string[] => spec.claims.map((c) => c.text);
