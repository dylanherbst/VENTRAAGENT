// Campaign strategy writer: Brand Brief -> 5 distinct angles (strict JSON). Three writers behind one interface:
//   claude (ANTHROPIC_API_KEY, already used by the setter), openai (OPENAI_API_KEY + OPENAI_TEXT_MODEL, Responses API + strict json_schema;
//   request shape UNVERIFIED against live docs, see docs/aimp/marketing-engine/PLAN.md), and demo (no key: labelled template output).
// Output is always validated by validateAngles; the writer never decides what is "verified".
import { approachInfo, approaches, type Approach, type BrandBrief } from './types.ts';
import { playbook } from './playbook.ts';

import { claudeJson, openaiJson, type FetchLike, type LlmUsage } from '../agents/llm.ts';
export { estimateCost, type FetchLike } from '../agents/llm.ts';
export type WriterUsage = LlmUsage;
export interface StrategyWriter { name: string; demo: boolean; write(brief: BrandBrief): Promise<{ raw: unknown; usage: WriterUsage | null }> }

/** JSON schema for one campaign's angles (used verbatim for OpenAI strict mode, and described to Claude). */
export const anglesSchema = {
  type: 'object', additionalProperties: false, required: ['angles'],
  properties: { angles: { type: 'array', minItems: 5, maxItems: 5, items: {
    type: 'object', additionalProperties: false,
    required: ['approach', 'format', 'hook', 'primary_copy', 'headline', 'cta', 'image_brief', 'storyboard', 'claims'],
    properties: {
      approach: { type: 'string', enum: [...approaches] },
      format: { type: 'string', enum: ['reel_9x16', 'static_4x5', 'carousel_4x5'] },
      hook: { type: 'string' }, primary_copy: { type: 'string' }, headline: { type: 'string' }, cta: { type: 'string' }, image_brief: { type: 'string' },
      storyboard: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['at_seconds', 'visual', 'overlay', 'voiceover'],
        properties: { at_seconds: { type: 'number' }, visual: { type: 'string' }, overlay: { type: 'string' }, voiceover: { type: 'string' } } } },
      claims: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string' } } } },
    } } } },
} as const;

function examplesFor(brief: BrandBrief): string {
  // Two playbook niches as style references (closest by shared words, else the first), so the writer learns the format, not the copy.
  const words = new Set(`${brief.niche} ${brief.audience}`.toLowerCase().match(/[a-z]{4,}/g) ?? []);
  const scored = playbook.map((n) => ({ n, s: (`${n.name} ${n.who}`.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => words.has(w)).length })).sort((a, b) => b.s - a.s);
  return scored.slice(0, 1).map(({ n }) => n.ads.map((a) => `- ${a.approach} (${a.kind}): hook "${a.hook}" | CTA "${a.cta}" | why: ${a.psychology}`).join('\n')).join('\n');
}

export function buildStrategyPrompt(brief: BrandBrief): { system: string; user: string } {
  const system = [
    'You are a senior direct-response strategist writing paid and organic social ads for a small business.',
    'Write exactly 5 angles, one per approach, each psychologically different (different problem, emotion and proof), not 5 rewrites of one idea.',
    ...approaches.map((a) => `- ${a}: ${approachInfo[a].why} Default format ${approachInfo[a].format}.`),
    'Rules:',
    '- Plain Australian English. Specific, concrete, no hype words (revolutionary, game-changer, unlock, skyrocket).',
    '- Hook under 12 words. Headline under 40 characters. CTA 2 to 4 words.',
    '- Never promise income, results, rankings or guarantees. No fake scarcity or countdowns. No invented reviews, numbers or customer stories.',
    '- Only use numbers and results that appear in FACTS. If you need a specific claim that is not in FACTS, list it in claims so the owner can check it.',
    '- Reels: 15 to 30 seconds, 3 to 6 storyboard beats starting at 0, the hook on screen in the first 2 seconds. Statics and carousels: storyboard may be empty.',
    '- image_brief: what to show, for an image generator. No text-heavy images, no real people or logos you were not given.',
    'Style reference (format and psychology only; do not copy):', examplesFor(brief),
  ].join('\n');
  const user = [
    `BUSINESS: ${brief.businessName}`, `NICHE: ${brief.niche}`, `OFFER: ${brief.offer}`, `REGION: ${brief.region}`, `AUDIENCE: ${brief.audience}`,
    `GOAL: ${brief.goal}`, `CHANNEL: ${brief.channel}`, `TONE: ${brief.tone}`,
    `FACTS (the only things you may state as true):\n${brief.facts.length ? brief.facts.map((f) => `- ${f}`).join('\n') : '- (none given: make no specific claims)'}`,
  ].join('\n');
  return { system, user };
}

/** Both writers go through the shared text-model integration (lib/aimp/agents/llm.ts). */
export function claudeWriter(deps: { apiKey: string; fetch: FetchLike; model?: string }): StrategyWriter { return fromModel(claudeJson(deps)); }
export function openaiWriter(deps: { apiKey: string; fetch: FetchLike; model: string }): StrategyWriter { return fromModel(openaiJson(deps)); }
function fromModel(m: ReturnType<typeof claudeJson>): StrategyWriter {
  return { name: m.name, demo: false, async write(brief) {
    const { system, user } = buildStrategyPrompt(brief);
    const out = await m.complete({ system, user, schema: anglesSchema, schemaName: 'ad_angles', maxTokens: 8000 });
    return { raw: out.text, usage: out.usage };
  } };
}

// Demo writer: deterministic, built from the brief, clearly labelled "demo" everywhere it shows. Makes no specific claims.
const first = (s: string) => s.split(/[,.;]/)[0]!.trim();
export const demoWriter: StrategyWriter = {
  name: 'demo', demo: true,
  async write(b) {
    const who = first(b.audience).toLowerCase(), offer = first(b.offer), name = b.businessName, niche = first(b.niche).toLowerCase();
    const verb = b.goal === 'sales' ? 'Shop now' : b.goal === 'leads' ? 'Get a quote' : 'Learn more';
    const reel = (h: string, mid: string, end: string) => [
      { at_seconds: 0, visual: `Close-up that shows the everyday ${niche} problem`, overlay: h, voiceover: h },
      { at_seconds: 6, visual: `${name} at work: ${offer}`, overlay: mid, voiceover: mid },
      { at_seconds: 14, visual: `Calm finished result, ${name} name on screen`, overlay: end, voiceover: end },
    ];
    const a = (approach: Approach, hook: string, headline: string, copy: string, brief: string, sb: ReturnType<typeof reel> | []) =>
      ({ approach, format: approachInfo[approach].format, hook, headline, primary_copy: copy, cta: verb, image_brief: brief, storyboard: sb, claims: [] });
    return { usage: null, raw: { angles: [
      a('pattern_interrupt', `Most ${who} put up with this. You don't have to.`, `Stop settling, ${name}`.slice(0, 40),
        `If you're one of the ${who} who has quietly accepted the usual hassle, ${name} does it differently: ${offer}.`, `Before-moment of the ${niche} problem, natural light, no text`, reel(`Most ${who} put up with this.`, `${name} fixes the part nobody mentions.`, `${verb} today.`)),
      a('value_contrast', `What you pay for vs what you actually need`, `What you really need`, `Plenty of ${niche} options look the same. ${name} focuses on what matters to ${who}: ${offer}.`, `Split image: generic option on the left, ${name}'s offer on the right`, []),
      a('curiosity_teaching', `3 things to check before you choose ${niche}`, `Check these 3 first`, `A quick guide for ${who}: what to ask, what to avoid and why ${name} built ${offer} around it. Swipe through.`, `Carousel cover: a clean checklist with three ticks on a brand-colour background`, []),
      a('identification_objection', `"I don't have time for this" - fair.`, `Made for busy ${who}`.slice(0, 40), `You've got enough going on. ${name} keeps it simple: ${offer}, without the back-and-forth.`, `Real-feeling phone video of an owner talking to camera in their workplace`, reel(`"I don't have time for this."`, `That's why ${name} keeps it simple.`, `${verb} in a minute.`)),
      a('specific_proof', `Here's exactly how ${name} does it`, `See how it works`, `No mystery: here's the step-by-step of ${offer}, start to finish, so you know what you're getting.`, `Over-the-shoulder shot of the real process, step by step`, reel(`Here's exactly how it works.`, `Step by step, start to finish.`, `${verb}.`)),
    ] } };
  },
};
