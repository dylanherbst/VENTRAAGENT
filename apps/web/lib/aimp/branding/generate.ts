// Deterministic brand generator (AMP-020). Same input, same output: no clock, no randomness, no network and no model call.
// (A live model would go behind the llm provider adapter later; this module never calls one.)
import type { CoverStyle, StoreFont } from '../storefront/schema.ts';
import { AA_LARGE, AA_NORMAL, bestTextOn, contrastRatio, luminance, normaliseHex } from './contrast.ts';
import { checkNameClashes, type ClashDeps } from './name-clash.ts';
import { brandTones, type BrandIssue, type BrandInput, type BrandListing, type BrandNameOption, type BrandOptions, type BrandPalette, type BrandTone, type VisualDirection } from './types.ts';
import { LONG_MAX, NAME_MAX, SHORT_MAX, TAGLINE_MAX, nameIssues, sanitiseName, slugIssues, slugify, stripPromises } from './validate.ts';

/** 32-bit FNV-1a over UTF-16 code units; pure JS so it also runs in the browser. */
function hash(text: string): number {
  let a = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) a = Math.imul(a ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return a >>> 0;
}
const pick = <T>(list: readonly T[], seed: string): T => list[hash(seed) % list.length]!;

const norm = (s: string) => s.normalize('NFKC').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
const title = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** Cut at a word boundary so the result is at most `max` characters. */
export function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const at = cut.lastIndexOf(' ');
  return (at > max * 0.5 ? cut.slice(0, at) : cut).replace(/[\s,;:\-&]+$/, '');
}

/** Check the generator input. */
export function brandInputIssues(i: unknown): BrandIssue[] {
  const out: BrandIssue[] = [];
  const r = (typeof i === 'object' && i !== null ? i : {}) as Record<string, unknown>;
  for (const [k, label] of [['niche', 'niche'], ['audience', 'audience']] as const) {
    const v = r[k];
    if (typeof v !== 'string' || norm(v).length < 2) out.push({ field: k, message: `Choose an opportunity first: the ${label} is missing.` });
    else if (norm(v).length > 120) out.push({ field: k, message: `The ${label} is too long (120 characters at most).` });
  }
  return out;
}

/** Opportunity text is copied into names and listing copy, so phrases that promise income or guaranteed results are removed first. */
export function scrubInput(i: BrandInput): BrandInput {
  const s = (v: string) => stripPromises(v);
  return {
    ...i, niche: s(i.niche), audience: s(i.audience),
    ...(typeof i.productType === 'string' ? { productType: s(i.productType) } : {}),
    ...(typeof i.productTitle === 'string' ? { productTitle: s(i.productTitle) } : {}),
    ...(typeof i.productSummary === 'string' ? { productSummary: s(i.productSummary) } : {}),
    ...(Array.isArray(i.formats) ? { formats: i.formats.map((f) => (typeof f === 'string' ? s(f) : '')) } : {}),
  };
}

// ---- names -----------------------------------------------------------------------------------------------------------------

const STOP = new Set(['and', 'the', 'for', 'with', 'of', 'to', 'a', 'an', 'in', 'on', 'by', 'at', 'from', 'your', 'my', 'our', 'printable', 'printables', 'digital', 'template', 'templates', 'products', 'product']);
const PREFIXES = ['Little', 'Bright', 'Good', 'Tidy', 'Simple', 'Plain', 'Honest', 'Gentle', 'Quiet', 'Fresh'] as const;
const SUFFIXES = ['Studio', 'Press', 'Lane', 'House', 'Works', 'Collective', 'Atelier', 'Corner', 'Paper', 'Pages'] as const;

function coreWords(niche: string): string[] {
  const words = norm(niche).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2 && !STOP.has(w.toLowerCase()));
  const picked = words.slice(0, 2).map((w) => title(w.slice(0, 14)));
  return picked.length ? picked : ['Daily'];
}

function nameCandidates(input: BrandInput): string[] {
  const core = coreWords(input.niche);
  const one = core[0]!;
  const both = core.join(' ');
  const seed = `${norm(input.niche)}|${norm(input.audience)}`;
  const list: string[] = [];
  const order = (items: readonly string[], salt: string) => [...items].sort((a, b) => hash(`${seed}|${salt}|${a}`) - hash(`${seed}|${salt}|${b}`) || a.localeCompare(b));
  const pre = order(PREFIXES, 'p'), suf = order(SUFFIXES, 's');
  list.push(`${both} ${suf[0]}`, `${pre[0]} ${one}`, `${one} ${suf[1]}`, `${pre[1]} ${both}`, `The ${one} ${suf[2]}`, `${pre[2]} ${one} ${suf[3]}`);
  list.push(`${both} ${suf[4]}`, `${pre[3]} ${both}`, `${one} ${suf[5]}`, `${pre[4]} ${one}`);
  return list;
}

/** At least three, up to five distinct, sanitised name options with unique slugs. */
export function generateNames(input: BrandInput, count = 5, clashDeps: ClashDeps = {}): BrandNameOption[] {
  const seen = new Set<string>();
  const out: BrandNameOption[] = [];
  for (const raw of nameCandidates(input)) {
    const name = sanitiseName(raw);
    const slug = slugify(name);
    if (nameIssues(name).length || name.length > NAME_MAX || slugIssues(slug).length || seen.has(slug)) continue;
    seen.add(slug);
    out.push({ name, slug });
    if (out.length === count) break;
  }
  const clashes = checkNameClashes(out.map((o) => o.name), clashDeps);
  return out.map((o, i) => ({ ...o, clash: clashes[i]! }));
}

// ---- palette, tone, font ---------------------------------------------------------------------------------------------------

const PALETTES: Record<BrandTone, readonly Omit<BrandPalette, 'onPrimary'>[]> = {
  warm: [
    { primary: '#a63d55', accent: '#d9822b', background: '#fdf8f6', text: '#2b1f22' },
    { primary: '#9c4a1a', accent: '#c4566a', background: '#fffaf3', text: '#2e2118' },
  ],
  playful: [
    { primary: '#c2410c', accent: '#0e7c86', background: '#fffaf0', text: '#2a1a10' },
    { primary: '#7a3fc4', accent: '#e0467c', background: '#fcf9ff', text: '#241338' },
  ],
  calm: [
    { primary: '#2f6b4f', accent: '#8a6d2f', background: '#f7f8f4', text: '#1f2a22' },
    { primary: '#3b5f7a', accent: '#6c8f8a', background: '#f6f9fa', text: '#1c2a33' },
  ],
  professional: [
    { primary: '#1f4e79', accent: '#1f7a6e', background: '#f8fafc', text: '#12202e' },
    { primary: '#2b2f4f', accent: '#b4572b', background: '#f9f9fb', text: '#16172a' },
  ],
  bold: [
    { primary: '#5b2bd0', accent: '#f2b705', background: '#ffffff', text: '#1a1033' },
    { primary: '#b3261e', accent: '#111111', background: '#fffdfa', text: '#1f1412' },
  ],
};

const TONE_FONT: Record<BrandTone, StoreFont> = { warm: 'rounded', playful: 'rounded', calm: 'serif', professional: 'sans', bold: 'sans' };
const TONE_COVER: Record<BrandTone, readonly CoverStyle[]> = { warm: ['arch', 'dots'], playful: ['dots', 'arch'], calm: ['lines', 'arch'], professional: ['grid', 'lines'], bold: ['grid', 'dots'] };
const TONE_WORDS: [BrandTone, RegExp][] = [
  ['playful', /\b(kids?|child(?:ren)?|teen|toddlers?|students?|party|parties|games?|fun)\b/i],
  ['warm', /\b(parents?|mums?|moms?|mothers?|dads?|famil(?:y|ies)|home|cooking|meals?|pets?|wedding|gift)\b/i],
  ['professional', /\b(business(?:es)?|owners?|freelanc\w+|consult\w+|managers?|teams?|finance|budget\w*|tax|small)\b/i],
  ['calm', /\b(wellbeing|wellness|mindful\w*|journal\w*|sleep|self[- ]care|gratitude|habit\w*|reflect\w*)\b/i],
  ['bold', /\b(fitness|gym|athletes?|goals?|productivity|hustle|sales?)\b/i],
];

/** Pick a tone from the audience and niche words, falling back to a stable pick from the text. */
export function chooseTone(input: BrandInput): BrandTone {
  const text = `${input.audience} ${input.niche}`;
  for (const [tone, re] of TONE_WORDS) if (re.test(text)) return tone;
  return pick(brandTones, `tone|${norm(input.niche)}|${norm(input.audience)}`);
}

/** Build a palette from the base colours: onPrimary is always the better of white or near-black, and text is repaired if it would be too faint. */
export function completePalette(base: Omit<BrandPalette, 'onPrimary'>): BrandPalette {
  const primary = normaliseHex(base.primary)!, background = normaliseHex(base.background)!;
  let text = normaliseHex(base.text)!;
  if (contrastRatio(text, background) < AA_NORMAL) text = bestTextOn(background);
  // The accent must pass its own readability check (3:1 on the background), or the owner cannot approve the brand we suggested.
  return { primary, accent: deepenUntil(normaliseHex(base.accent)!, background, AA_LARGE), background, text, onPrimary: bestTextOn(primary) };
}

/** Darkens (or, on a dark background, lightens) a colour in small steps, keeping its hue, until it reaches `min` contrast. */
export function deepenUntil(hex: string, background: string, min: number): string {
  const towards = luminance(background) > 0.5 ? 0 : 255;
  let rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  let out = hex;
  for (let step = 0; step < 40 && contrastRatio(out, background) < min; step++) {
    rgb = rgb.map((c) => Math.round(c + (towards - c) * 0.06));
    out = `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
  }
  return out;
}

export function paletteFor(tone: BrandTone, input: BrandInput): BrandPalette {
  return completePalette(pick(PALETTES[tone], `palette|${tone}|${norm(input.niche)}`));
}

// ---- copy ------------------------------------------------------------------------------------------------------------------

/** "planner" -> "planners"; "budget tracker with a progress page" -> "budget trackers with a progress page"; already plural stays. */
function plural(type: string): string {
  const m = /^(.*?)(\s+(?:with|for)\s.*)$/i.exec(type);
  const head = m ? m[1]! : type, tail = m ? m[2]! : '';
  return /s$/i.test(head) ? type : `${head}s${tail}`;
}
/** "A printable tracker" -> "printable tracker": the copy adds its own article. Keeps acronyms like "PDF". */
function bareType(type: string): string {
  const t = type.replace(/^(a|an|the)\s+/i, '').trim();
  return /^[A-Z]{2,}/.test(t) ? t : t.charAt(0).toLowerCase() + t.slice(1);
}
/** "a" or "an" for a word. */
const article = (w: string): string => (/^[aeiou]/i.test(w) ? 'an' : 'a');

function listFormats(formats: string[]): string {
  const f = formats.map(norm).filter(Boolean);
  if (f.length <= 1) return f[0] ?? 'a digital file';
  return `${f.slice(0, -1).join(', ')} and ${f[f.length - 1]}`;
}

export function generateListing(input: BrandInput, tone: BrandTone): BrandListing {
  const niche = clip(norm(input.niche), 40);
  const audience = lower(clip(norm(input.audience), 50));
  const type = bareType(norm(input.productType ?? 'digital product')) || 'digital product';
  const taglines: Record<BrandTone, string> = {
    warm: `Thoughtful ${plural(type)} for ${audience}`,
    playful: `${niche.charAt(0).toUpperCase()}${niche.slice(1)} made easy, and a little fun`,
    calm: `Calm, clear ${plural(type)} for ${audience}`,
    professional: `Clear ${plural(type)} for ${audience}`,
    bold: `${clip(niche, 40)} without the guesswork`,
  };
  const tagline = clip(taglines[tone], TAGLINE_MAX);
  const productTitle = clip(norm(input.productTitle ?? '') || `${niche} ${type}`, 80);
  const summary = norm(input.productSummary ?? '');
  const shortDescription = clip(summary ? `${productTitle}: ${summary}` : `${productTitle}, ${article(type)} ${type} for ${audience}. Download it and start straight away.`, SHORT_MAX);
  const formats = input.formats?.length ? listFormats(input.formats) : '';
  const pages = typeof input.totalPages === 'number' && input.totalPages > 0 ? `${Math.round(input.totalPages)} pages` : '';
  const parts = [
    `${productTitle} is ${article(type)} ${type} made for ${audience}.`,
    summary ? (/[.!?]$/.test(summary) ? summary : `${summary}.`) : '',
    formats || pages ? `You get ${[pages, formats ? `as ${formats}` : ''].filter(Boolean).join(' ')}, ready to download as soon as you buy.` : 'You can download it as soon as you buy.',
    'Print it or use it on screen, as often as you like.',
  ].filter(Boolean);
  return { tagline, shortDescription, longDescription: clip(parts.join(' '), LONG_MAX) };
}

export function generateVisual(tone: BrandTone, input: BrandInput): VisualDirection {
  const coverStyle = pick(TONE_COVER[tone], `cover|${tone}|${norm(input.niche)}`);
  return {
    coverStyle,
    notes: [
      `Cover: a ${coverStyle} pattern in the primary colour on the background colour, with the product name in the text colour.`,
      `Mood: ${tone}. Keep layouts uncluttered with generous space around the text.`,
      'Logo: a simple wordmark set in the business name is enough to launch. No icon needed.',
      'Photos: none needed. If you add some later, use your own or properly licensed images.',
      'Pictures are not generated here. Ask for them separately when you want them.',
    ],
    imageGeneration: 'not_requested',
  };
}

export type GenerateResult = { ok: true; options: BrandOptions } | { ok: false; errors: BrandIssue[] };

/** Brand options for one selected opportunity. Pure and deterministic. */
export function generateBrandOptions(raw: BrandInput, clashDeps: ClashDeps = {}): GenerateResult {
  const early = brandInputIssues(raw);
  if (early.length) return { ok: false, errors: early };
  const input = scrubInput(raw);
  const errors = brandInputIssues(input);
  if (errors.length) return { ok: false, errors };
  const tone = chooseTone(input);
  const names = generateNames(input, 5, clashDeps);
  return { ok: true, options: { names, palette: paletteFor(tone, input), tone, font: TONE_FONT[tone], listing: generateListing(input, tone), visual: generateVisual(tone, input) } };
}

export { TONE_FONT };
