// Claim rules for campaign copy (AMP-050). Campaign text may only say what the listing says: its title, description,
// format and price. Each rule below is explicit and tested with a rejecting example. Pure; nothing is thrown.
//
// The income / guarantee rule is NOT copied here: `brand_promise` runs the branding module's own promise filter
// (stripPromises in branding/validate.ts, the source of truth that catalogue listing text is also held to), so the campaign
// follows that rule as it changes. The rules after it add what marketing copy needs on top.
import { stripPromises } from '../branding/validate.ts';
import { formatAud } from '../catalogue/pricing.ts';
import type { CampaignIssue, CampaignListing } from './types.ts';

/** The listing facts a claim is checked against. null for text that is not about one listing (audience, pillars). */
export type ClaimListing = Pick<CampaignListing, 'priceMinor' | 'currency'> | null;

export interface ClaimRule {
  id: string;
  /** What the rule stops, in plain words. */
  label: string;
  /** Shown to the merchant when copy is refused. */
  message: string;
  /** True when the text breaks the rule. */
  broken(text: string, listing: ClaimListing): boolean;
}

const solid = (s: string): number => s.replace(/\s/g, '').length;
/** True when the branding promise filter would remove something from this text. */
export function hasBrandPromise(text: string): boolean {
  return solid(stripPromises(text)) < solid(text.replace(/^[\s,.;:!?-]+/, ''));
}

const INCOME = /\b(?:(?:earn|make|bring in)\b[^.!?]{0,30}\b(?:money|income|cash|profits?|a living)|(?:extra|more|passive|second|full[- ]time|side) income|six[- ]figures?|quit your (?:day )?job|financial freedom|pays? for itself|side hustle (?:cash|money|income))\b/i;
const GUARANTEE = /\b(?:guarantee[ds]?|promise[ds]?|proven|never fails?|always works|fool[- ]?proof|money[- ]back|results? in \d+ (?:days?|weeks?))\b|100\s*%/i;
const MEDICAL = /\b(?:cures?|heals?|treats? (?:anxiety|depression|adhd|illness|disease|pain|insomnia)|diagnos\w+|prevents? (?:illness|disease|burnout)|lose (?:weight|\d+\s*(?:kg|kilos?|lbs?|pounds))|weight[- ]loss|clinically|doctor[- ]recommended|medically|therapeutic|reduces? (?:anxiety|stress|depression|pain)|(?:anxiety|pain)[- ]free)\b/i;
const FINANCIAL = /\b(?:debt[- ]free|get out of debt|pay off (?:your |all )?(?:debts?|mortgage|loans?)|double your (?:savings|money)|build wealth|become wealthy|grow your (?:wealth|money)|beat the market|lower your tax|tax savings?|save (?:you )?(?:thousands|hundreds))\b|\bsave (?:you )?(?:A|AU|US)?\$/i;
const SCARCITY = /\b(?:only \d+ (?:left|remaining|spots?|copies|available)|limited[- ]time|limited (?:stock|spots|copies|edition|offer|run)|last chance|selling (?:fast|out)|almost (?:gone|sold out)|hurry|ends (?:tonight|today|soon|at midnight|tomorrow)|while (?:stocks?|supplies) lasts?|before (?:it'?s|they'?re) gone|don'?t miss out|today only|\d+ (?:hours?|days?) (?:left|only))\b/i;
const REVIEWS = /[★⭐]|#\s*1\b|\b(?:\d(?:\.\d)?\s*(?:\/\s*5|out of 5|stars?)|five[- ]star|top[- ]rated|best[- ]?sell(?:er|ers|ing)|number one|award[- ]winning|(?:customer|buyer|rave|glowing|verified|\d[\d,]*\+?) reviews?|reviews? (?:say|from)|testimonials?|highly rated|rated \d|loved by|trusted by|as seen (?:on|in)|\d[\d,.]*\s*k?\+?\s*(?:happy |satisfied )?(?:customers|buyers|sales|downloads|people|families|teachers|couples))\b/i;
const DISCOUNT = /\d+\s*%\s*(?:off|discount|saving)|\b(?:on sale|sale (?:ends|price|now)|flash sale|launch sale|discount(?:ed|s)?|half[- ]price|coupons?|promo(?:tional)? codes?|vouchers?|price drop|reduced (?:to|from)|special offer|introductory (?:price|offer)|bogo|buy one,? get one|save \d+\s*%)\b|\bwas\s+(?:A|AU|US)?\$/i;
const FREE = /(?<![\w-])(?:free|freebies?|no cost|costs? nothing|gratis|complimentary)(?![\w-])|(?:A|AU|US)?\$\s*0(?![\d.])/i;
const URL_LIKE = /\b(?:https?:\/\/|www\.)\S+/i;
const DOMAIN_LIKE = /\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|co|app|shop|store|info|biz|me|ly|au|uk|us|nz|ca|dev|xyz|online|site|page|link)\b/i;
const HANDLE = /(?:^|[\s([,;:])@[a-z0-9_.]{2,}/i;
const PHONE_RUN = /\+?\d[\d\s().-]{6,}\d/g;
/** A phone-like run: nine or more digits, or eight or more after a +. Dates such as 2026-11-14 (eight digits) pass. */
export function hasPhoneNumber(text: string): boolean {
  for (const m of text.matchAll(PHONE_RUN)) {
    const digits = m[0].replace(/\D/g, '').length;
    if (digits >= 9 || (m[0].startsWith('+') && digits >= 8)) return true;
  }
  return false;
}
const MONEY =/(A|AU|US|NZ|CA)?\$\s*(\d[\d,]*(?:\.\d{1,2})?)|\b(\d[\d,]*(?:\.\d{1,2})?)\s*(?:dollars?|bucks|AUD|USD)\b/gi;

/** Every money amount written in the text, in whole cents, with whether it was marked as a non-AUD currency. */
export function moneyMentions(text: string): { minor: number; foreign: boolean }[] {
  const out: { minor: number; foreign: boolean }[] = [];
  for (const m of text.matchAll(MONEY)) {
    const raw = (m[2] ?? m[3] ?? '').replace(/,/g, '');
    const prefix = (m[1] ?? '').toUpperCase();
    out.push({ minor: Math.round(Number(raw) * 100), foreign: (prefix !== '' && prefix !== 'A' && prefix !== 'AU') || /USD\b/i.test(m[0]) });
  }
  return out;
}

/** The explicit rule list. Order is the order issues are reported in. */
export const claimRules: readonly ClaimRule[] = [
  {
    id: 'brand_promise', label: 'Income promises and guarantees (the same rule as brand and listing copy)',
    message: 'cannot promise income or guaranteed results.',
    broken: (t) => hasBrandPromise(t),
  },
  {
    id: 'income', label: 'Income or earnings promises',
    message: 'cannot say or suggest the buyer will earn money.',
    broken: (t) => INCOME.test(t),
  },
  {
    id: 'guarantee', label: 'Guarantees and certain results',
    message: 'cannot guarantee or promise a result.',
    broken: (t) => GUARANTEE.test(t),
  },
  {
    id: 'medical', label: 'Medical or health outcome claims',
    message: 'cannot make a medical or health claim.',
    broken: (t) => MEDICAL.test(t),
  },
  {
    id: 'financial', label: 'Financial outcome claims',
    message: 'cannot promise a financial outcome such as savings or getting out of debt.',
    broken: (t) => FINANCIAL.test(t),
  },
  {
    id: 'scarcity', label: 'Fake scarcity or urgency',
    message: 'cannot use scarcity or deadlines. A digital download does not run out.',
    broken: (t) => SCARCITY.test(t),
  },
  {
    id: 'reviews', label: 'Invented reviews, ratings, rankings or customer numbers',
    message: 'cannot mention reviews, ratings, rankings or customer numbers. The store has none on record.',
    broken: (t) => REVIEWS.test(t),
  },
  {
    id: 'discount', label: 'Invented discounts or sales',
    message: 'cannot mention a discount or sale. The listing has one price.',
    broken: (t) => DISCOUNT.test(t),
  },
  {
    id: 'free', label: '"Free" when the listing has a price',
    message: 'cannot say "free": the listing has a price.',
    broken: (t, l) => FREE.test(t) && !(l !== null && l.priceMinor === 0),
  },
  {
    id: 'price', label: 'A price that is not the listing price',
    message: 'shows a price that is not the listing price.',
    broken: (t, l) => moneyMentions(t).some((m) => l === null || m.foreign || m.minor !== l.priceMinor),
  },
  {
    id: 'contact', label: 'Links, domains, @handles and phone numbers in copy',
    message: 'cannot contain a web address, domain, @handle or phone number. The product link is added separately.',
    broken: (t) => URL_LIKE.test(t) || DOMAIN_LIKE.test(t) || HANDLE.test(t) || hasPhoneNumber(t),
  },
];

export const claimRuleIds: readonly string[] = claimRules.map((r) => r.id);

/** Ids of the rules this text breaks. Empty means the text only says what a listing can back up. */
export function brokenClaimRules(text: string, listing: ClaimListing): string[] {
  const t = text.normalize('NFKC');
  return claimRules.filter((r) => r.broken(t, listing)).map((r) => r.id);
}

/** One issue per broken rule, naming the field. A price rule failure is reported as a price mismatch. */
export function claimIssues(text: string, field: string, label: string, listing: ClaimListing): CampaignIssue[] {
  const t = text.normalize('NFKC');
  return claimRules.filter((r) => r.broken(t, listing)).map((r) => ({
    field,
    code: r.id === 'price' ? 'price_mismatch' as const : 'claim' as const,
    message: r.id === 'price' && listing
      ? `The ${label} ${r.message} It must be ${formatAud(listing.priceMinor)}. [rule: ${r.id}]`
      : `The ${label} ${r.message} [rule: ${r.id}]`,
  }));
}
