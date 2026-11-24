// Limits and claim checks for asset content (AMP-051). Pure. Nothing is truncated or fixed here: a failure is reported as a
// flag on the asset, and an asset with flags cannot be approved until it is edited or regenerated.
import { claimRules } from '../campaigns/claims.ts';
import type { ClaimListing } from '../campaigns/claims.ts';
import { LIMITS, PIN_IMAGE } from './types.ts';
import type { AssetContent, AssetKind, ClaimFlag, ContentByKind, LimitIssue } from './types.ts';

export interface ContentCheck { limitIssues: LimitIssue[]; claimFlags: ClaimFlag[] }

const isStr = (v: unknown): v is string => typeof v === 'string';
const isDate = (v: unknown): boolean => isStr(v) && /^\d{4}-\d{2}-\d{2}$/.test(v);

function text(out: LimitIssue[], field: string, v: unknown, max: number, label: string, min = 1): void {
  if (!isStr(v) || v.trim().length === 0) { if (min > 0) out.push({ field, code: 'missing', message: `${label} is empty.` }); return; }
  if (v.length > max) out.push({ field, code: 'too_long', message: `${label} is ${v.length} characters; the limit is ${max}.` });
}
function list(out: LimitIssue[], field: string, v: unknown, min: number, max: number, itemMax: number, label: string): void {
  if (!Array.isArray(v) || !v.every(isStr)) { out.push({ field, code: 'bad_value', message: `${label} must be a list of text.` }); return; }
  if (v.length < min) out.push({ field, code: 'too_short', message: `${label} needs at least ${min} item${min === 1 ? '' : 's'}.` });
  if (v.length > max) out.push({ field, code: 'too_long', message: `${label} has ${v.length} items; the limit is ${max}.` });
  v.forEach((s, i) => text(out, `${field}[${i}]`, s, itemMax, `${label} item ${i + 1}`));
}

/** Every piece of text a reader will see (or a person will use), with its field name, for the claim rules. */
export function textsOf(kind: AssetKind, c: AssetContent): { field: string; text: string }[] {
  const out: { field: string; text: string }[] = [];
  const add = (field: string, v: unknown) => { if (isStr(v)) out.push({ field, text: v }); };
  const addAll = (field: string, v: unknown) => { if (Array.isArray(v)) v.forEach((s, i) => add(`${field}[${i}]`, s)); };
  if (kind === 'pin') {
    const p = c as ContentByKind['pin'];
    add('title', p.title); add('description', p.description); add('altText', p.altText); add('board', p.board); add('imageBrief', p.imageBrief);
    add('imageSpec.textOverlay', p.imageSpec?.textOverlay); addAll('keywords', p.keywords);
  } else if (kind === 'caption') {
    addAll('variants', (c as ContentByKind['caption']).variants);
  } else if (kind === 'video_script') {
    const v = c as ContentByKind['video_script'];
    add('hook', v.hook); addAll('beats', v.beats); add('callToAction', v.callToAction); addAll('onScreenText', v.onScreenText);
  } else {
    const s = c as ContentByKind['seo'];
    add('pageTitle', s.pageTitle); add('metaDescription', s.metaDescription); addAll('keywords', s.keywords);
  }
  return out;
}

export function limitIssuesFor(kind: AssetKind, c: AssetContent): LimitIssue[] {
  const out: LimitIssue[] = [];
  if (!c || typeof c !== 'object') return [{ field: 'content', code: 'bad_value', message: 'The content is missing.' }];
  if (kind === 'pin') {
    const p = c as ContentByKind['pin'];
    text(out, 'title', p.title, LIMITS.pinTitle, 'The Pin title');
    text(out, 'description', p.description, LIMITS.pinDescription, 'The Pin description');
    text(out, 'altText', p.altText, LIMITS.pinAltText, 'The alt text');
    text(out, 'board', p.board, LIMITS.pinBoard, 'The board suggestion');
    text(out, 'imageBrief', p.imageBrief, LIMITS.imageBrief, 'The image brief');
    text(out, 'destinationUrl', p.destinationUrl, 2048, 'The destination link');
    if (p.imageSpec?.width !== PIN_IMAGE.width || p.imageSpec?.height !== PIN_IMAGE.height) out.push({ field: 'imageSpec', code: 'bad_value', message: `The image must be ${PIN_IMAGE.width}x${PIN_IMAGE.height}.` });
    if (!isDate(p.publishDate)) out.push({ field: 'publishDate', code: 'bad_value', message: 'The publish date must be YYYY-MM-DD.' });
    list(out, 'keywords', p.keywords, 1, LIMITS.keywordsMax, LIMITS.keywordMax, 'Keywords');
  } else if (kind === 'caption') {
    const c2 = c as ContentByKind['caption'];
    list(out, 'variants', c2.variants, LIMITS.captionVariantsMin, LIMITS.captionVariantsMax, LIMITS.captionMax, 'Caption variants');
    text(out, 'destinationUrl', c2.destinationUrl, 2048, 'The destination link');
  } else if (kind === 'video_script') {
    const v = c as ContentByKind['video_script'];
    text(out, 'hook', v.hook, LIMITS.videoHook, 'The hook');
    list(out, 'beats', v.beats, LIMITS.videoBeatsMin, LIMITS.videoBeatsMax, LIMITS.videoBeat, 'Beats');
    text(out, 'callToAction', v.callToAction, LIMITS.videoCta, 'The call to action');
    list(out, 'onScreenText', v.onScreenText, 1, LIMITS.onScreenMax, LIMITS.onScreenLine, 'On-screen text');
    if (!Number.isInteger(v.targetLengthSeconds) || v.targetLengthSeconds < LIMITS.videoSecondsMin || v.targetLengthSeconds > LIMITS.videoSecondsMax) {
      out.push({ field: 'targetLengthSeconds', code: 'bad_value', message: `The target length must be ${LIMITS.videoSecondsMin} to ${LIMITS.videoSecondsMax} seconds.` });
    }
    text(out, 'destinationUrl', v.destinationUrl, 2048, 'The destination link');
  } else {
    const s = c as ContentByKind['seo'];
    text(out, 'pageTitle', s.pageTitle, LIMITS.seoTitle, 'The page title');
    text(out, 'metaDescription', s.metaDescription, LIMITS.seoDescription, 'The meta description');
    list(out, 'keywords', s.keywords, 1, LIMITS.keywordsMax, LIMITS.keywordMax, 'Keywords');
    text(out, 'url', s.url, 2048, 'The page link');
  }
  return out;
}

/** The campaign claim rules (income, guarantees, invented reviews and so on), run over every text of the asset. */
export function claimFlagsFor(kind: AssetKind, c: AssetContent, listing: ClaimListing): ClaimFlag[] {
  const flags: ClaimFlag[] = [];
  for (const { field, text: t } of textsOf(kind, c)) {
    const norm = t.normalize('NFKC');
    for (const r of claimRules) {
      if (r.broken(norm, listing)) flags.push({ field, ruleId: r.id, message: `This text ${r.message}` });
    }
  }
  return flags;
}

export function checkContent(kind: AssetKind, c: AssetContent, listing: ClaimListing): ContentCheck {
  return { limitIssues: limitIssuesFor(kind, c), claimFlags: claimFlagsFor(kind, c, listing) };
}

/** The destination link of an asset, whichever field holds it. */
export function linkOf(kind: AssetKind, c: AssetContent): string {
  return kind === 'seo' ? (c as ContentByKind['seo']).url : (c as ContentByKind['pin']).destinationUrl;
}
