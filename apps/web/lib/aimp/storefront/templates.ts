// Store templates (owner request, 20 Nov 2026): 15 ready-made looks for a new shop, each built on a proven conversion pattern, with only
// basic customisation (accent colour, logo). They are ORIGINAL designs made from general best practice (one clear action above the fold,
// proof next to the button, plain prices, sample before you buy, answers to the usual doubts, thumb-friendly mobile layout). They are not
// copies of any company's template. A template is DATA: a palette, a hero layout, a card style, corner radius, a font and which sections
// show. The renderer only reads these validated values, so AI output or customer input can never inject markup or styles.
import type { StoreConfig, StoreFont, StoreSection } from './schema.ts';

export const heroLayouts = ['split', 'split-rev', 'center', 'left', 'stack', 'banner', 'overlap', 'minimal'] as const;
export type HeroLayout = (typeof heroLayouts)[number];
export const cardStyles = ['soft', 'outline', 'flat', 'raised'] as const;
export type CardStyle = (typeof cardStyles)[number];
export const grids = ['three', 'two', 'four', 'list', 'mag'] as const;
export type Grid = (typeof grids)[number];
export const heads = ['left', 'center', 'bar'] as const;
export type Head = (typeof heads)[number];
/** The order the page's blocks run in. */
export const flows = ['proof', 'products', 'deal', 'story'] as const;
export type Flow = (typeof flows)[number];
export const trusts = ['cards', 'strip', 'plain'] as const;
export type Trust = (typeof trusts)[number];
export const radii = ['sharp', 'soft', 'round'] as const;
export type Radius = (typeof radii)[number];

export interface Palette { bg: string; surface: string; ink: string; muted: string; line: string; accent: string; accentInk: string; soft: string }

/** Typeface pairs. The CSS variables are defined by next/font in app/s/[store]/_ui/fonts.ts; the fallback is used until they load. */
export const TYPE_PAIRS = {
  bricolage: { display: '--stf-bricolage', body: '--stf-bricolage', fallback: 'sans' },
  fraunces: { display: '--stf-fraunces', body: '--stf-worksans', fallback: 'serif' },
  youngserif: { display: '--stf-youngserif', body: '--stf-figtree', fallback: 'serif' },
  syne: { display: '--stf-syne', body: '--stf-manrope', fallback: 'sans' },
  caslon: { display: '--stf-caslon', body: '--stf-karla', fallback: 'serif' },
  unbounded: { display: '--stf-unbounded', body: '--stf-rubik', fallback: 'sans' },
  archivo: { display: '--stf-archivo', body: '--stf-archivo', fallback: 'sans' },
  gloock: { display: '--stf-gloock', body: '--stf-schibsted', fallback: 'serif' },
  instrument: { display: '--stf-instrumentserif', body: '--stf-instrumentsans', fallback: 'serif' },
  fredoka: { display: '--stf-fredoka', body: '--stf-nunitosans', fallback: 'rounded' },
  dmserif: { display: '--stf-dmserif', body: '--stf-dmsans', fallback: 'serif' },
  nunito: { display: '--stf-nunito', body: '--stf-nunito', fallback: 'rounded' },
  cormorant: { display: '--stf-cormorant', body: '--stf-mulish', fallback: 'serif' },
  sora: { display: '--stf-sora', body: '--stf-sora', fallback: 'sans' },
  epilogue: { display: '--stf-epilogue', body: '--stf-epilogue', fallback: 'sans' },
} as const;
export type TypePair = keyof typeof TYPE_PAIRS;

/** Each template spends its boldness on ONE signature element (store-templates.css). */
export const signatures = ['big-price', 'tilted-cover', 'sticker', 'fanned-covers', 'contents', 'colour-block', 'graph-paper', 'tape', 'frame', 'tilted-cards', 'notebook', 'shelf', 'certificate', 'banner-strip', 'arch'] as const;
export type Signature = (typeof signatures)[number];

export interface StoreTemplate {
  id: string; name: string;
  /** Who it suits, in plain words. */
  bestFor: string;
  /** The conversion idea this layout is built on. */
  pattern: string;
  palette: Palette; font: StoreFont; type: TypePair; signature: Signature;
  hero: HeroLayout; grid: Grid; head: Head; flow: Flow; trust: Trust; cards: CardStyle; radius: Radius;
  sections: readonly StoreSection[];
}

const ALL: readonly StoreSection[] = ['trust', 'featured', 'bundles', 'catalogue', 'faq', 'newsletter'];
const LEAN: readonly StoreSection[] = ['trust', 'featured', 'catalogue', 'faq'];
const DEAL: readonly StoreSection[] = ['featured', 'bundles', 'trust', 'catalogue', 'faq'];
const P = (bg: string, surface: string, ink: string, muted: string, line: string, accent: string, accentInk: string, soft: string): Palette => ({ bg, surface, ink, muted, line, accent, accentInk, soft });

// Rebuilt 22 Nov 2026 with the frontend-design brief: every template has its own typeface pair, palette and one signature element, and
// avoids the generated-page defaults (cream + terracotta, black + acid accent, identical soft cards, all-caps eyebrows, gradient washes).
export const templates: readonly StoreTemplate[] = [
  { id: 'clean-launch', name: 'Clean Launch', bestFor: 'A first product with one clear message', pattern: 'The price is set huge beside the headline, so nobody has to hunt for it.',
    palette: P('#ffffff', '#ffffff', '#14161b', '#5a5f6b', '#e4e6ea', '#2346d1', '#ffffff', '#eef1fc'), font: 'sans', type: 'bricolage', signature: 'big-price',
    hero: 'left', grid: 'three', head: 'left', flow: 'proof', trust: 'plain', cards: 'flat', radius: 'soft', sections: LEAN },
  { id: 'sage-studio', name: 'Sage Studio', bestFor: 'Planners, wellness and calm organisation', pattern: 'The product cover sits large and slightly turned, like a planner left on a desk.',
    palette: P('#eef1ea', '#f8faf6', '#1d2a21', '#55635a', '#d6ddd2', '#2f5d3e', '#ffffff', '#dfe7dc'), font: 'serif', type: 'fraunces', signature: 'tilted-cover',
    hero: 'split', grid: 'two', head: 'left', flow: 'proof', trust: 'strip', cards: 'soft', radius: 'soft', sections: ALL },
  { id: 'blush-boutique', name: 'Blush Boutique', bestFor: 'Journals, gratitude pages and gift printables', pattern: 'A round "instant download" sticker answers the first question a gift buyer has.',
    palette: P('#fbeef0', '#fff9fa', '#3a1d27', '#7a5a64', '#efd5db', '#a3214a', '#ffffff', '#f6dbe1'), font: 'serif', type: 'youngserif', signature: 'sticker',
    hero: 'split-rev', grid: 'three', head: 'center', flow: 'proof', trust: 'plain', cards: 'raised', radius: 'round', sections: ALL },
  { id: 'midnight-shop', name: 'Midnight Shop', bestFor: 'Notion, spreadsheet and digital template products', pattern: 'Dark like the apps these products live in, with covers fanned out to show range.',
    palette: P('#16181d', '#1f2229', '#eef0f4', '#a3a9b6', '#2e333d', '#9fb4ff', '#121521', '#242a3a'), font: 'sans', type: 'syne', signature: 'fanned-covers',
    hero: 'left', grid: 'four', head: 'left', flow: 'products', trust: 'strip', cards: 'outline', radius: 'soft', sections: LEAN },
  { id: 'paper-and-ink', name: 'Paper & Ink', bestFor: 'Writers, teachers and long-form guides', pattern: 'Products are listed like a book\'s contents page, which suits readers who scan.',
    palette: P('#f7f7f4', '#ffffff', '#1c2540', '#59607a', '#dcdfe6', '#1f3f9a', '#ffffff', '#e7eaf3'), font: 'serif', type: 'caslon', signature: 'contents',
    hero: 'minimal', grid: 'list', head: 'center', flow: 'story', trust: 'plain', cards: 'flat', radius: 'sharp', sections: ['trust', 'featured', 'catalogue', 'faq', 'newsletter'] },
  { id: 'sunny-bundle', name: 'Sunny Bundle', bestFor: 'Several products sold as a bundle or deal', pattern: 'A bold colour block behind the products makes the bundle the first thing you see.',
    palette: P('#fff4c7', '#fffbe8', '#2a2306', '#655a2b', '#eadb9c', '#c8341b', '#ffffff', '#ffe98a'), font: 'rounded', type: 'unbounded', signature: 'colour-block',
    hero: 'split', grid: 'three', head: 'left', flow: 'deal', trust: 'cards', cards: 'raised', radius: 'round', sections: DEAL },
  { id: 'ocean-planner', name: 'Ocean Planner', bestFor: 'Budget, business and productivity trackers', pattern: 'Graph paper behind the hero says "organised" before a word is read.',
    palette: P('#eef4fb', '#ffffff', '#0f2340', '#4f6380', '#d3e0ef', '#0b5ed7', '#ffffff', '#dceafa'), font: 'sans', type: 'archivo', signature: 'graph-paper',
    hero: 'split', grid: 'mag', head: 'bar', flow: 'proof', trust: 'strip', cards: 'outline', radius: 'sharp', sections: ALL },
  { id: 'terracotta-craft', name: 'Kraft & Stamp', bestFor: 'Home, craft and DIY printables', pattern: 'Kraft paper and taped-down covers give a handmade feel, so the work feels personal.',
    palette: P('#e9dcc6', '#f6efe2', '#2b2117', '#62523f', '#d3c2a4', '#a3261c', '#ffffff', '#dfcfb3'), font: 'serif', type: 'gloock', signature: 'tape',
    hero: 'split-rev', grid: 'two', head: 'left', flow: 'products', trust: 'plain', cards: 'flat', radius: 'sharp', sections: ALL },
  { id: 'mono-minimal', name: 'Mono Minimal', bestFor: 'Premium, design-led products', pattern: 'A heavy black frame and large type: fewer things on the page, so the one button gets the attention.',
    palette: P('#ffffff', '#ffffff', '#000000', '#4d4d4d', '#000000', '#000000', '#ffffff', '#f2f2f2'), font: 'serif', type: 'instrument', signature: 'frame',
    hero: 'minimal', grid: 'four', head: 'bar', flow: 'products', trust: 'plain', cards: 'outline', radius: 'sharp', sections: ['featured', 'catalogue', 'faq'] },
  { id: 'berry-pop', name: 'Berry Pop', bestFor: 'Kids, teachers and classroom printables', pattern: 'Cards sit at playful angles like worksheets on a classroom wall, with big tap targets.',
    palette: P('#fff0f6', '#ffffff', '#2c0f22', '#6c4a5e', '#f5d3e4', '#c2187a', '#ffffff', '#ffd6ea'), font: 'rounded', type: 'fredoka', signature: 'tilted-cards',
    hero: 'stack', grid: 'two', head: 'center', flow: 'deal', trust: 'cards', cards: 'raised', radius: 'round', sections: ALL },
  { id: 'forest-study', name: 'Forest Study', bestFor: 'Study guides and student resources', pattern: 'A ruled notebook page with a margin line: instantly reads as study material.',
    palette: P('#f1f4ef', '#fbfcfa', '#13261b', '#4e6457', '#cfdcd3', '#1d5c3a', '#ffffff', '#dceadf'), font: 'serif', type: 'dmserif', signature: 'notebook',
    hero: 'left', grid: 'list', head: 'left', flow: 'story', trust: 'strip', cards: 'flat', radius: 'soft', sections: ['trust', 'featured', 'catalogue', 'faq', 'newsletter'] },
  { id: 'sky-soft', name: 'Sky Soft', bestFor: 'Habit trackers and gentle self-care', pattern: 'One product stands on a shelf above the fold, calm and uncluttered.',
    palette: P('#f2f7ff', '#ffffff', '#18243a', '#55657f', '#d9e4f4', '#3460d6', '#ffffff', '#e1ebfd'), font: 'rounded', type: 'nunito', signature: 'shelf',
    hero: 'stack', grid: 'three', head: 'center', flow: 'products', trust: 'plain', cards: 'soft', radius: 'round', sections: LEAN },
  { id: 'gold-standard', name: 'Gold Standard', bestFor: 'Finance and premium professional templates', pattern: 'A double-ruled certificate border around the offer signals care and quality.',
    palette: P('#0e1a2b', '#142338', '#f4efe2', '#b9bdc8', '#2a3d5c', '#d8b25a', '#1a1405', '#1b2c46'), font: 'serif', type: 'cormorant', signature: 'certificate',
    hero: 'center', grid: 'mag', head: 'bar', flow: 'proof', trust: 'strip', cards: 'outline', radius: 'sharp', sections: ALL },
  { id: 'lemon-fresh', name: 'Lemon Fresh', bestFor: 'Fitness, meal plans and healthy habits', pattern: 'A bold strip of reasons to buy runs straight under the hero, energetic and quick to scan.',
    palette: P('#f7fbe6', '#ffffff', '#17210a', '#55603d', '#dfe8bf', '#3b6d00', '#ffffff', '#eef7b8'), font: 'sans', type: 'sora', signature: 'banner-strip',
    hero: 'overlap', grid: 'three', head: 'left', flow: 'deal', trust: 'strip', cards: 'raised', radius: 'soft', sections: DEAL },
  { id: 'lavender-glow', name: 'Lavender Glow', bestFor: 'A soft, modern look for almost any product', pattern: 'The AiMoneyPrinter house style: the product framed in an arched window.',
    palette: P('#f6f3ff', '#ffffff', '#211a3b', '#5e5779', '#e3dcf6', '#6a47d6', '#ffffff', '#e9e2fb'), font: 'rounded', type: 'epilogue', signature: 'arch',
    hero: 'split', grid: 'mag', head: 'center', flow: 'story', trust: 'cards', cards: 'soft', radius: 'round', sections: ALL },
] as const;

export const templateIds = templates.map((t) => t.id);
export type TemplateId = (typeof templates)[number]['id'];
export const templateById = (id: unknown): StoreTemplate | null => templates.find((t) => t.id === id) ?? null;

// ---------- Colour maths (WCAG) ----------
const HEX = /^#[0-9a-fA-F]{6}$/;
export const isHex = (v: unknown): v is string => typeof v === 'string' && HEX.test(v);
const rgb = (h: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
export const luminance = (h: string): number => { const [r, g, b] = rgb(h); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
export const contrast = (a: string, b: string): number => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05); };
const mix = (a: string, b: string, t: number): string => {
  const [r1, g1, b1] = rgb(a), [r2, g2, b2] = rgb(b);
  const h = (x: number, y: number) => Math.round(x * (1 - t) + y * t).toString(16).padStart(2, '0');
  return `#${h(r1, r2)}${h(g1, g2)}${h(b1, b2)}`;
};

export interface Customisation { accent?: string; logo?: string }
export type Resolved = { ok: true; palette: Palette } | { ok: false; message: string };

/** The template's palette with the owner's accent colour on top. A colour that would be hard to read on this template's background is refused with a plain message. */
export function resolvePalette(t: StoreTemplate, accent?: string): Resolved {
  if (accent === undefined || accent === '') return { ok: true, palette: t.palette };
  if (!isHex(accent)) return { ok: false, message: 'Use a colour like #6a47d6.' };
  const a = accent.toLowerCase();
  if (contrast(a, t.palette.bg) < 3) return { ok: false, message: 'That colour is too close to the background to read. Pick a darker one.' };
  const accentInk = contrast('#ffffff', a) >= contrast('#111111', a) ? '#ffffff' : '#111111';
  return { ok: true, palette: { ...t.palette, accent: a, accentInk, soft: mix(a, t.palette.bg, 0.88) } };
}

// ---------- Logo ----------
export const LOGO_MAX_BYTES = 150 * 1024;
const MAGIC: Record<string, (b: Buffer) => boolean> = {
  'image/png': (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  'image/jpeg': (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/webp': (b) => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
};
/** A logo is a small PNG, JPEG or WebP stored as a data URL. SVG is refused (it can carry script). The bytes must match the stated type. */
export function checkLogo(v: unknown): { ok: true; logo: string } | { ok: false; message: string } {
  if (typeof v !== 'string') return { ok: false, message: 'The logo must be an image.' };
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(v);
  if (!m) return { ok: false, message: 'Use a PNG, JPEG or WebP logo.' };
  const bytes = Buffer.from(m[2]!, 'base64');
  if (bytes.length > LOGO_MAX_BYTES) return { ok: false, message: 'The logo is too big. Keep it under 150 KB.' };
  if (!MAGIC[m[1]!]!(bytes)) return { ok: false, message: 'That file is not really a ' + m[1]!.replace('image/', '').toUpperCase() + ' image.' };
  return { ok: true, logo: v };
}
export const LOGO_DATA_URL = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

/** Put a template (and optional accent/logo) on a store config. Returns a new config; the owner's text, products and policies are untouched. */
export function applyTemplate(config: StoreConfig, templateId: string, custom: Customisation = {}): { ok: true; config: StoreConfig } | { ok: false; message: string } {
  const t = templateById(templateId);
  if (!t) return { ok: false, message: 'Unknown template.' };
  const accent = custom.accent === '' ? undefined : custom.accent;
  const pal = resolvePalette(t, accent);
  if (!pal.ok) return pal;
  let logo: string | undefined = config.brand.logo;
  if (custom.logo !== undefined) { if (custom.logo === '') logo = undefined; else { const l = checkLogo(custom.logo); if (!l.ok) return l; logo = l.logo; } }
  const brand: StoreConfig['brand'] = { ...config.brand, font: t.font, template: t.id };
  if (accent) brand.accent = accent.toLowerCase(); else delete brand.accent;
  if (logo) brand.logo = logo; else delete brand.logo;
  return { ok: true, config: { ...config, brand, sections: [...t.sections] } };
}

/** The data attributes the stylesheet reads. One place, so the shop, the picker preview and the gallery always agree. */
export function layoutAttrs(t: StoreTemplate): Record<string, string> {
  return { 'data-tpl': t.id, 'data-sig': t.signature, 'data-hero': t.hero, 'data-grid': t.grid, 'data-head': t.head, 'data-flow': t.flow, 'data-trust': t.trust, 'data-cards': t.cards, 'data-radius': t.radius };
}

/** CSS font variables for a template: the next/font face first, then the plain system fallback. */
export function typeVars(t: StoreTemplate, stacks: Record<StoreFont, string>): Record<string, string> {
  const p = TYPE_PAIRS[t.type];
  return { '--st-font': `var(${p.display}), ${stacks[p.fallback]}`, '--st-body': `var(${p.body}), ${stacks[p.fallback === 'serif' ? 'sans' : p.fallback]}` };
}
