// Turns a blueprint plus the owner's inputs into a ProductSpec (AMP-021).
// The layout (sections, page counts) comes from the blueprint. The wording comes from the provider registry's
// llm adapter: live AI text when connected, otherwise the labelled fixture adapter (mode "demo"). Tests only
// ever pass the fixture adapter, so no live API is called.
import type { BlueprintDefinition, InputSpec } from '../blueprints/index.ts';
import type { ProviderEntry } from '../providers/registry.ts';
import { deriveClaims, validateProductSpec } from './spec.ts';
import type { ProductSpec, SpecPage, SpecSection, TemplateKind } from './spec.ts';

export class ProductFactoryError extends Error {
  readonly problems: string[];
  constructor(message: string, problems: string[] = []) {
    super(message);
    this.name = 'ProductFactoryError';
    this.problems = problems;
  }
}

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;

export interface AiContent {
  tagline: string;
  howTo: string[];
  goalPrompts: string[];
  checklistItems: string[];
  habits: string[];
}

/** Check the owner's answers against the blueprint's required inputs. Returns plain-English problems. */
export function validateInputs(specs: readonly InputSpec[], inputs: Record<string, unknown>): string[] {
  const problems: string[] = [];
  for (const spec of specs) {
    const v = inputs[spec.key];
    if (spec.type === 'text') {
      const len = typeof v === 'string' ? v.trim().length : -1;
      if (len < spec.min || len > spec.max) problems.push(`${spec.label} must be ${spec.min} to ${spec.max} characters.`);
    } else if (typeof v !== 'number' || !Number.isInteger(v) || v < spec.min || v > spec.max) {
      problems.push(`${spec.label} must be a whole number from ${spec.min} to ${spec.max}${spec.unit ? ` (${spec.unit})` : ''}.`);
    }
  }
  return problems;
}

/** Wording used in demo mode; shaped by the niche and audience so different inputs give different pages. */
export function demoContent(niche: string, audience: string): AiContent {
  return {
    tagline: `A simple printable ${niche} set for ${audience}.`,
    howTo: [
      'Print the pages you want on A4 or US Letter paper, at 100% scale.',
      `Start with the goals pages: write what you want from ${niche} this year.`,
      'Use the monthly pages to see the big picture and the weekly pages for day-to-day plans.',
      'Tick off the checklists and trackers as you go. Reprint any page you need again.',
    ],
    goalPrompts: [
      `What is the one result I want from ${niche} this year?`,
      'What will I do each week to get there?',
      'What could get in my way, and how will I handle it?',
      'Who can support me?',
      'How will I know I am on track?',
      'What am I proud of so far?',
      'What do I want to learn next?',
      'What can I let go of?',
      'What would make this month a win?',
      'Which small habit will help most?',
      'What did I learn this month?',
      'What will I do differently next month?',
    ],
    checklistItems: [
      `Choose three ${niche} priorities`, 'Block out time in the calendar', 'Gather what I need', 'Do the first small step',
      'Review progress on Friday', 'Plan next week', 'Tidy my workspace', 'Celebrate one win',
      'Ask for help if stuck', 'Update my goals page', 'Rest and reset', 'Share progress with a friend',
      'Write down the key dates', 'Make a short shopping list', 'Set a simple budget', 'Book what needs booking',
      'Confirm the details', 'Prepare the essentials', 'Do a quick test run', 'Check the plan once more',
      'Handle the last small tasks', 'Pack or set up', 'Take a breath', 'Enjoy the result',
    ],
    habits: ['Drink water', 'Move my body', 'Plan my day', 'Read or learn', 'Sleep on time', 'Tidy up', 'Reflect', 'Time outside', 'Connect with someone', 'Work on my goal'],
  };
}

/** Exact item counts and length caps the templates are built for. Live AI output must match them. */
export const CONTENT_LIMITS = {
  tagline: 100, howTo: { count: 4, max: 160 }, goalPrompts: { count: 12, max: 140 },
  checklistItems: { count: 24, max: 60 }, habits: { count: 10, max: 40 },
} as const;
const PROMPTS_PER_PAGE = 4;
const CHECKLIST_PER_PAGE = 6;

const strList = (v: unknown, rule: { count: number; max: number }): string[] | null =>
  Array.isArray(v) && v.length === rule.count && v.every((x) => typeof x === 'string' && x.trim().length > 0 && x.trim().length <= rule.max)
    ? (v as string[]).map((x) => x.trim()) : null;

/** True when content has exactly the counts and lengths the templates need. */
export function isValidContent(c: AiContent): boolean {
  return c.tagline.trim().length > 0 && c.tagline.length <= CONTENT_LIMITS.tagline &&
    strList(c.howTo, CONTENT_LIMITS.howTo) !== null && strList(c.goalPrompts, CONTENT_LIMITS.goalPrompts) !== null &&
    strList(c.checklistItems, CONTENT_LIMITS.checklistItems) !== null && strList(c.habits, CONTENT_LIMITS.habits) !== null;
}

/** Parse live AI output (a JSON object, possibly inside text). Returns null when the shape is wrong. */
export function parseAiContent(text: string): AiContent | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let raw: unknown;
  try { raw = JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const howTo = strList(o.howTo, CONTENT_LIMITS.howTo);
  const goalPrompts = strList(o.goalPrompts, CONTENT_LIMITS.goalPrompts);
  const checklistItems = strList(o.checklistItems, CONTENT_LIMITS.checklistItems);
  const habits = strList(o.habits, CONTENT_LIMITS.habits);
  if (typeof o.tagline !== 'string' || !o.tagline.trim() || o.tagline.trim().length > CONTENT_LIMITS.tagline || !howTo || !goalPrompts || !checklistItems || !habits) return null;
  return { tagline: o.tagline.trim(), howTo, goalPrompts, checklistItems, habits };
}

function aiPrompt(niche: string, audience: string, blueprintTitle: string): string {
  return `Write wording for a printable ${blueprintTitle.toLowerCase()} for the niche "${niche}", for ${audience}. ` +
    'Reply with one JSON object only, with keys: tagline (string, under 100 characters), howTo (exactly 4 steps, each under 160 characters), goalPrompts (exactly 12 reflection questions, each under 140), ' +
    'checklistItems (exactly 24 short tasks, each under 60), habits (exactly 10 habit names, each under 40). No income, health or legal promises.';
}

/** Capitalise the first letter of each space-separated word ("mother's day" -> "Mother's Day"; works for non-ASCII). */
export function titleCase(s: string): string {
  return s.trim().split(/\s+/).map((w) => { const [first = '', ...rest] = Array.from(w); return first.toLocaleUpperCase() + rest.join(''); }).join(' ');
}

/** Items for one page: a distinct slice, never wrapped. Throws when the content cannot fill every page of the section. */
function slice(list: readonly string[], page: number, per: number, what: string, section: string): string[] {
  const out = list.slice(page * per, page * per + per);
  if (out.length < per) throw new ProductFactoryError(`There is not enough ${what} to give every page of "${section}" its own content.`);
  return out;
}

/** Month label for repeated pages; after twelve pages it adds a year number so no heading repeats. */
const monthLabel = (i: number): string => (i < 12 ? (MONTHS[i] as string) : `${MONTHS[i % 12] as string} (${Math.floor(i / 12) + 1})`);

/** Choose the page templates for one blueprint section from its title. Page counts always equal the blueprint's. */
function planSection(title: string, count: number, c: AiContent, spec: { title: string; subtitle: string; audience: string; niche: string }): SpecPage[] {
  const t = title.toLowerCase();
  const many = (base: string, i: number) => (count > 1 ? `${base} ${i + 1}` : base);
  const pages: SpecPage[] = [];
  for (let i = 0; i < count; i++) {
    let p: SpecPage;
    if (/cover/.test(t)) {
      p = i === 0
        ? { template: 'cover', heading: spec.title, subheading: spec.subtitle, lines: [c.tagline] }
        : { template: 'howto', heading: count > 2 ? `How to use this product ${i}` : 'How to use this product', lines: c.howTo };
    } else if (/year/.test(t)) {
      const per = Math.ceil(12 / count);
      p = { template: 'year-glance', heading: count > 1 ? `Year at a glance (${i + 1} of ${count})` : 'Year at a glance', items: MONTHS.slice(i * per, i * per + per) as unknown as string[] };
      if ((p.items ?? []).length === 0) p.items = [...MONTHS];
    } else if (/review/.test(t)) {
      p = { template: 'prompts', heading: many('Monthly review', i), lines: slice(c.goalPrompts, i, PROMPTS_PER_PAGE, 'reflection questions', title) };
    } else if (/goal/.test(t) && /note/.test(t)) {
      const goalPages = Math.ceil(count / 2);
      p = i < goalPages
        ? { template: 'prompts', heading: many('Goals', i), lines: slice(c.goalPrompts, i, PROMPTS_PER_PAGE, 'goal questions', title) }
        : { template: 'notes', heading: many('Notes', i - goalPages) };
    } else if (/month/.test(t)) {
      p = { template: 'month', heading: monthLabel(i), subheading: 'Monthly spread' };
    } else if (/tracker/.test(t)) {
      p = { template: 'tracker', heading: `Habit tracker: ${monthLabel(i)}`, items: [...c.habits] };
    } else if (/checklist/.test(t)) {
      p = { template: 'checklist', heading: many('Checklist', i), items: slice(c.checklistItems, i, CHECKLIST_PER_PAGE, 'checklist items', title) };
    } else if (/week|planner/.test(t)) {
      p = { template: 'week', heading: `Week ${i + 1}`, subheading: 'Weekly planner' };
    } else if (/goal/.test(t)) {
      p = { template: 'prompts', heading: many('Goals', i), lines: slice(c.goalPrompts, i, PROMPTS_PER_PAGE, 'goal questions', title) };
    } else {
      p = { template: 'notes', heading: many('Notes', i) };
    }
    pages.push(p);
  }
  return pages;
}

export interface GenerateOptions {
  blueprint: BlueprintDefinition;
  inputs: Record<string, unknown>;
  /** From createProviderRegistry(...).llm: status plus adapter (null when off). */
  provider: ProviderEntry<'llm'>;
  now?: () => Date;
}

/** Build and validate a product spec. Throws ProductFactoryError with plain-English problems. */
export async function generateProductSpec(opts: GenerateOptions): Promise<ProductSpec> {
  const { blueprint, inputs, provider } = opts;
  if (!blueprint.output.formats.includes('PDF')) throw new ProductFactoryError('This blueprint does not produce a PDF.');
  const problems = validateInputs(blueprint.requiredInputs, inputs);
  if (problems.length) throw new ProductFactoryError('The product inputs need fixing.', problems);
  if (!provider.adapter) throw new ProductFactoryError(`AI generation is not available: ${provider.status.reason}`);

  const niche = String(inputs.niche).trim();
  const audience = String(inputs.audience).trim();
  const demo = provider.status.demo;
  const res = await provider.adapter.generate({ system: 'You write wording for printable digital products.', prompt: aiPrompt(niche, audience, blueprint.title) });

  let content: AiContent;
  let note: string;
  if (demo) {
    content = demoContent(niche, audience);
    note = `DEMO: sample wording, not written by a live AI model. Provider reply: ${res.text.slice(0, 80)}`;
  } else {
    const parsed = parseAiContent(res.text);
    if (!parsed) throw new ProductFactoryError('The AI reply was not in the expected format, so nothing was built. Try again.');
    content = parsed;
    note = `Wording written by ${res.model}.`;
  }

  const title = `${titleCase(niche)} ${blueprint.title}`;
  const subtitle = blueprint.summary;
  const sections: SpecSection[] = blueprint.output.sections.map((s) => ({
    title: s.title,
    pages: planSection(s.title, s.pages, content, { title, subtitle, audience, niche }),
  }));
  const spec: ProductSpec = {
    specVersion: 1,
    blueprint: { id: blueprint.id, version: blueprint.version },
    title, subtitle, niche, audience,
    mode: demo ? 'demo' : 'live',
    generatedAt: (opts.now ?? (() => new Date()))().toISOString(),
    paperSizes: ['a4', 'letter'],
    sections,
    claims: deriveClaims(sections),
    ai: { model: res.model, note },
  };
  const check = validateProductSpec(spec, blueprint);
  if (!check.ok) throw new ProductFactoryError('The generated product spec failed validation.', check.errors);
  return spec;
}

export type { TemplateKind };
