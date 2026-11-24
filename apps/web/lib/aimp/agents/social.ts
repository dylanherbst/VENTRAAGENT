// Social Media Agent: 7 or 30-day plan. The BACKEND lays out the slots (day, time, platform, format, pillar) from the owner's cadence
// and the preset; the model only fills each slot's words and briefs. Output is validated against platform rules and our claim rules.
import { bannedClaim, claimsIn, jaccard } from '../marketing-engine/validate.ts';
import type { AgentConfig } from './config.ts';
import { DEFAULT_WEEK, type ContentCategory, type IndustryPreset, type Platform, type PostFormat } from './presets.ts';

/** Per-platform rules we enforce. Instagram limits from Zernio's Instagram page (read 22 Nov 2026); others conservative, recheck. */
export const platformRules: Record<Platform, { caption: number; hashtags: number; formats: PostFormat[]; needsMedia: boolean; publishable: boolean; note: string }> = {
  instagram: { caption: 2200, hashtags: 30, formats: ['image', 'carousel', 'reel'], needsMedia: true, publishable: true, note: 'Business or Creator account; every post needs media.' },
  facebook: { caption: 5000, hashtags: 10, formats: ['image', 'carousel', 'reel', 'text'], needsMedia: false, publishable: true, note: 'Facebook Page.' },
  tiktok: { caption: 2200, hashtags: 10, formats: ['reel', 'carousel'], needsMedia: true, publishable: false, note: 'Publishing needs TikTok user review and consent: not switched on yet.' },
  linkedin: { caption: 3000, hashtags: 5, formats: ['text', 'image', 'carousel', 'reel'], needsMedia: false, publishable: false, note: 'Publishing not switched on yet.' },
};

export interface Slot { index: number; day: number; date: string; time: string; platform: Platform; format: PostFormat; category: ContentCategory; pillar: string }
export interface PostDraft { hook: string; caption: string; hashtags: string[]; altText: string; cta: string; assetBrief: string; storyboard: { atSeconds: number; visual: string; overlay: string }[] }

const DEFAULT_TIME: Record<PostFormat, string> = { reel: '18:30', image: '12:15', carousel: '19:30', text: '08:15' };
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/** Deterministic slot grid. Times are defaults, labelled as such in the UI, never "best time" claims. */
export function planSlots(cfg: AgentConfig, preset: IndustryPreset, days: 7 | 30, startDate: string, hasProof = false): Slot[] {
  const formats: PostFormat[] = [];
  for (const [f, n] of Object.entries(cfg.cadence) as [PostFormat, number][]) for (let i = 0; i < n; i++) formats.push(f);
  if (!formats.length) formats.push('image', 'reel', 'carousel');
  const pillars = [
    ...preset.pillars.filter((p) => cfg.categories.length === 0 || cfg.categories.includes(p.category)),
    ...cfg.customCategories.map((c) => ({ name: c.name, category: c.category })),
  ].filter((p) => hasProof || p.category !== 'testimonial'); // no testimonial slots without real, authorised reviews
  if (!pillars.length) pillars.push(...preset.pillars.filter((p) => p.category !== 'testimonial'));
  // Category order: round-robin through the default mix so a short week still covers several kinds of post (3 education, then 1 each).
  const mix: ContentCategory[] = [];
  const left = DEFAULT_WEEK.map((m) => ({ ...m }));
  while (left.some((m) => m.count > 0)) for (const m of left) if (m.count > 0) { mix.push(m.category); m.count--; }
  const used = new Map<string, number>();
  const pickPillar = (cat: ContentCategory) => {
    const pool = pillars.filter((p) => p.category === cat);
    const from = pool.length ? pool : pillars; // no pillar of this kind: use the least-used pillar overall
    return from.reduce((a, b) => ((used.get(b.name) ?? 0) < (used.get(a.name) ?? 0) ? b : a));
  };
  const slots: Slot[] = [];
  const weeks = Math.ceil(days / 7);
  let k = 0;
  for (let w = 0; w < weeks; w++) {
    const perWeek = formats.length;
    for (let i = 0; i < perWeek; i++) {
      const day = w * 7 + Math.floor((i * 7) / perWeek) + 1;
      if (day > days) continue;
      // Interleave formats so a week isn't all reels then all images.
      const format = formats[(i * 3 + w) % formats.length]!;
      const wantCat = mix[k % mix.length]!;
      const pillar = pickPillar(wantCat);
      used.set(pillar.name, (used.get(pillar.name) ?? 0) + 1);
      const usable = cfg.platforms.filter((p) => platformRules[p].formats.includes(format));
      const platform = usable.length ? usable[k % usable.length]! : cfg.platforms[0]!;
      const fmt = platformRules[platform].formats.includes(format) ? format : platformRules[platform].formats[0]!;
      slots.push({ index: slots.length, day, date: addDays(startDate, day - 1), time: DEFAULT_TIME[fmt], platform, format: fmt, category: pillar.category, pillar: pillar.name });
      k++;
    }
  }
  return slots;
}

export const postsSchema = {
  type: 'object', additionalProperties: false, required: ['posts'],
  properties: { posts: { type: 'array', items: { type: 'object', additionalProperties: false,
    required: ['slot', 'hook', 'caption', 'hashtags', 'alt_text', 'cta', 'asset_brief', 'storyboard'],
    properties: { slot: { type: 'number' }, hook: { type: 'string' }, caption: { type: 'string' }, hashtags: { type: 'array', items: { type: 'string' } }, alt_text: { type: 'string' }, cta: { type: 'string' }, asset_brief: { type: 'string' },
      storyboard: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['at_seconds', 'visual', 'overlay'], properties: { at_seconds: { type: 'number' }, visual: { type: 'string' }, overlay: { type: 'string' } } } } } } } },
} as const;

export function socialUserPrompt(brief: { businessName: string; offer: string; facts: string[]; description?: string; location?: string; products?: string[]; painPoints?: string[]; usps?: string[]; bookingUrl?: string }, slots: Slot[], handoff: string | null): string {
  return [
    `BUSINESS: ${brief.businessName}`, `OFFER: ${brief.offer}`,
    brief.description ? `ABOUT: ${brief.description}` : '', brief.location ? `LOCATION: ${brief.location}` : '',
    brief.products?.length ? `PRODUCTS AND SERVICES:\n${brief.products.map((x) => `- ${x}`).join('\n')}` : '',
    brief.painPoints?.length ? `CUSTOMER PAIN POINTS (from the owner):\n${brief.painPoints.map((x) => `- ${x}`).join('\n')}` : '',
    brief.usps?.length ? `WHY CUSTOMERS CHOOSE THEM (owner's words; only repeat, do not exaggerate):\n${brief.usps.map((x) => `- ${x}`).join('\n')}` : '',
    brief.bookingUrl ? `CALL TO ACTION LINK: ${brief.bookingUrl}` : '',
    `FACTS (the only things you may state as true):\n${brief.facts.length ? brief.facts.map((f) => `- ${f}`).join('\n') : '- (none: make no specific claims)'}`,
    handoff ? `CAMPAIGN HANDOFF from the Marketing agent (keep the organic posts consistent with it, do not copy the ad):\n${handoff}` : '',
    'Write one post for EVERY slot below. Each must suit its platform and format, sound like a person, and differ from the others (no repeated hooks).',
    'Reels: 3 to 6 storyboard beats within 30 seconds, hook on screen in the first 2 seconds. Image/text posts: storyboard empty. Carousels: one beat per slide (at_seconds = slide number).',
    `SLOTS:\n${slots.map((s) => `${s.index}: day ${s.day} ${s.platform} ${s.format} pillar "${s.pillar}" (${s.category})`).join('\n')}`,
  ].filter(Boolean).join('\n');
}

type J = Record<string, unknown>;
const o = (v: unknown): J | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as J) : null);
const t = (v: unknown, max: number) => (typeof v === 'string' ? v.trim() : '').slice(0, max + 1);

export function validatePosts(raw: unknown, slots: Slot[], cfg: AgentConfig, facts: string[]): { ok: true; drafts: (PostDraft & { slot: Slot; claims: ReturnType<typeof claimsIn> })[] } | { ok: false; errors: string[] } {
  const list = Array.isArray(o(raw)?.posts) ? (o(raw)!.posts as unknown[]) : null;
  if (!list) return { ok: false, errors: ['The writer did not return posts.'] };
  const errors: string[] = [];
  const bySlot = new Map<number, J>();
  for (const p of list) { const x = o(p); if (x && typeof x.slot === 'number') bySlot.set(x.slot, x); }
  const drafts: (PostDraft & { slot: Slot; claims: ReturnType<typeof claimsIn> })[] = [];
  const maxTags = Number(cfg.workflow.find((w) => w.kind === 'add_hashtags')?.value ?? 5);
  for (const s of slots) {
    const x = bySlot.get(s.index);
    if (!x) { errors.push(`Slot ${s.index + 1}: missing.`); continue; }
    const rule = platformRules[s.platform];
    const hook = t(x.hook, 150), caption = t(x.caption, rule.caption), cta = t(x.cta, 60), altText = t(x.alt_text, 300), assetBrief = t(x.asset_brief, 600);
    if (!hook || hook.length > 150) { errors.push(`Slot ${s.index + 1}: hook missing or too long.`); continue; }
    if (!caption || caption.length > rule.caption) { errors.push(`Slot ${s.index + 1}: caption missing or over ${rule.caption} characters for ${s.platform}.`); continue; }
    if (!assetBrief && s.format !== 'text') { errors.push(`Slot ${s.index + 1}: needs a visual brief.`); continue; }
    const hashtags = [...new Set((Array.isArray(x.hashtags) ? x.hashtags : []).map((h) => String(h).trim().replace(/^#*/, '#').replace(/\s+/g, '')).filter((h) => /^#[\p{L}\p{N}_]{2,40}$/u.test(h)))].slice(0, Math.min(rule.hashtags, maxTags));
    const storyboard = (Array.isArray(x.storyboard) ? x.storyboard : []).slice(0, 10).map((b) => { const y = o(b) ?? {}; return { atSeconds: typeof y.at_seconds === 'number' ? Math.max(0, Math.min(60, Math.round(y.at_seconds))) : 0, visual: t(y.visual, 240), overlay: t(y.overlay, 90) }; }).filter((b) => b.visual);
    if (s.format === 'reel' && (storyboard.length < 3 || storyboard[storyboard.length - 1]!.atSeconds > 35)) { errors.push(`Slot ${s.index + 1}: a reel needs 3+ beats within 30 seconds.`); continue; }
    const all = [hook, caption, cta, ...storyboard.map((b) => b.overlay)].join(' ');
    if (bannedClaim(all)) { errors.push(`Slot ${s.index + 1}: contains a claim we never allow.`); continue; }
    const avoid = cfg.avoidPhrases.find((p) => p && all.toLowerCase().includes(p.toLowerCase()));
    if (avoid) { errors.push(`Slot ${s.index + 1}: uses "${avoid}", which you asked to avoid.`); continue; }
    if (s.category === 'testimonial' && !facts.some((f) => /review|testimonial|said|stars|feedback/i.test(f))) { errors.push(`Slot ${s.index + 1}: a testimonial post needs a real, authorised review in your facts.`); continue; }
    drafts.push({ slot: s, hook, caption, cta, altText, assetBrief, hashtags, storyboard, claims: claimsIn([hook, caption], facts) });
  }
  if (errors.length) return { ok: false, errors };
  // Repetition check within each week (the window a follower actually sees).
  const week = (d: { slot: Slot }) => Math.floor((d.slot.day - 1) / 7);
  for (let i = 0; i < drafts.length; i++) for (let j = i + 1; j < drafts.length; j++) {
    if (week(drafts[i]!) === week(drafts[j]!) && (drafts[i]!.hook.toLowerCase() === drafts[j]!.hook.toLowerCase() || jaccard(drafts[i]!.hook, drafts[j]!.hook) > 0.7)) return { ok: false, errors: [`Posts ${i + 1} and ${j + 1} have near-identical hooks in the same week.`] };
  }
  if (drafts.length >= 5) {
    const counts = new Map<string, number>(); for (const d of drafts) counts.set(d.slot.pillar, (counts.get(d.slot.pillar) ?? 0) + 1);
    if (Math.max(...counts.values()) / drafts.length > 0.6) return { ok: false, errors: ['One pillar takes over the plan. Add pillars or change the cadence.'] };
  }
  return { ok: true, drafts };
}

/** Labelled demo writer: fills slots from the brief and preset with no model call and no specific claims. */
export function demoPosts(brief: { businessName: string; offer: string }, preset: IndustryPreset, slots: Slot[]): { posts: J[] } {
  const offer = brief.offer.split(/[,.;]/)[0]!.trim(), name = brief.businessName;
  const pains = preset.painPoints, pos = preset.positioning;
  const hooks: Record<ContentCategory, (i: number) => string> = {
    educational: (i) => [`One thing most people get wrong about ${preset.name.toLowerCase().split(',')[0]}`, `A 30-second tip from ${name}`, `Save this for later`, `Quick fix for "${pains[i % pains.length]!.toLowerCase()}"`][i % 4]!,
    promotional: (i) => [`This week at ${name}`, `Ready when you are`][i % 2]!,
    problem_solution: (i) => `"${pains[i % pains.length]}" - here's how we handle it`,
    product_showcase: (i) => [`How ${name} actually does it`, `Behind the scenes at ${name}`, `Step by step: ${offer}`][i % 3]!,
    short_video: (i) => `Watch this in ${15 + (i % 2) * 10} seconds`,
    engagement: (i) => [`Which one are you?`, `Tell us in the comments`, `Quick question for you`][i % 3]!,
    announcement: () => `News from ${name}`,
    testimonial: () => `In their words`,
    local: (i) => [`For our neighbours`, `Proudly local`][i % 2]!,
  };
  return { posts: slots.map((s, i) => ({
    slot: s.index,
    hook: hooks[s.category](slots.filter((x, j) => j < i && x.category === s.category && Math.floor((x.day - 1) / 7) === Math.floor((s.day - 1) / 7)).length + Math.floor((s.day - 1) / 7)),
    caption: `${pos[i % pos.length]}. ${s.pillar}: ${offer}. ${s.category === 'engagement' ? 'Drop your answer below.' : 'Questions? Send us a message.'}`,
    hashtags: [`#${name.replace(/[^A-Za-z0-9]/g, '')}`, `#${s.pillar.replace(/[^A-Za-z0-9]/g, '').slice(0, 30) || 'tips'}`],
    alt_text: `${s.format} post for ${name}: ${s.pillar}`, cta: s.category === 'promotional' ? 'Book now' : 'Learn more',
    asset_brief: s.format === 'text' ? '' : `${s.format === 'reel' ? 'Vertical video' : 'Photo'} showing ${s.pillar.toLowerCase()} at ${name}, natural light, no stock-photo look`,
    storyboard: s.format === 'reel' ? [{ at_seconds: 0, visual: `Close-up for "${s.pillar}"`, overlay: hooks[s.category](i).slice(0, 80) }, { at_seconds: 8, visual: `${name} at work`, overlay: '' }, { at_seconds: 18, visual: 'Result and name on screen', overlay: 'Learn more' }]
      : s.format === 'carousel' ? [1, 2, 3, 4].map((n) => ({ at_seconds: n, visual: `Slide ${n}: ${['the question', 'the common mistake', 'the better way', 'how we help'][n - 1]}`, overlay: '' })) : [],
  })) };
}
