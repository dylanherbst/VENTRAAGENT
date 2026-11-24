// First headline A/B test, as data plus a pure assignment function.
// The control headline is NOT defined here: the page passes its current wording in (that wording is an open owner
// decision, AMP-068-D). Only the variant text lives here, and it must pass the claims rules in the tests.
// The experiment is OFF until the owner flips HEADLINE_EXPERIMENT_ENABLED and decides the control wording.

/** Master switch. OFF by default: when false everyone sees the control and nothing is assigned or recorded. */
export const HEADLINE_EXPERIMENT_ENABLED = false;

export const HEADLINE_EXPERIMENT_ID = 'hero-headline-1';
/** Variant headline, taken from the owner's website brief. No earnings promise, no figures, no urgency. */
export const HEADLINE_VARIANT_TEXT = 'The AI boom is here. Build a business from it.';

export type HeadlineVariant = 'control' | 'variant';

/** 32-bit finaliser (murmur3 fmix) over an FNV-1a hash, so every input bit affects the low bit. */
function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) { h ^= input.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Same key and experiment always give the same answer; keys split about 50/50. */
export function assignVariant(visitorKey: string, experimentId: string = HEADLINE_EXPERIMENT_ID): HeadlineVariant {
  return hash32(`${experimentId}:${visitorKey}`) % 2 === 0 ? 'control' : 'variant';
}

/** Headline text for a variant. The control text is supplied by the caller (the current page wording). */
export function headlineFor(variant: HeadlineVariant, controlText: string): string {
  return variant === 'variant' ? HEADLINE_VARIANT_TEXT : controlText;
}

export const VISITOR_KEY_STORAGE = 'aimp_vk';

/** A random id with no link to a person. Used only as the experiment bucket key; kept in localStorage, never a cookie. */
export function newVisitorKey(random: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < 16; i++) s += Math.floor(random() * 36).toString(36);
  return s;
}
