// Price suggestion and fee/margin estimate (AMP-023). Pure, deterministic and explainable. All money is whole cents (AUD);
// every rate is an integer number of basis points (1 bp = 0.01%) so nothing drifts through floating point.
//
// EVERYTHING HERE IS AN ESTIMATE. Real fees come from Stripe at payment time; the platform fee is set by the owner's plan.
import type { BlueprintDefinition, BlueprintFamily } from '../blueprints/index.ts';
import { cardFee } from '../preview/generate.ts';

export const PRICE_MIN_MINOR = 300;    // A$3, the blueprint price-point minimum
export const PRICE_MAX_MINOR = 10000;  // A$100, the blueprint price-point maximum
export const PRICE_STEP_MINOR = 50;    // suggestions round to 50c

/** Stripe standard Australian domestic card rate, from preview/generate.ts (1.65% + 30c), as integer basis points. ESTIMATE. */
export const STRIPE_FEE_BP = Math.round(cardFee.percent * 100);
export const STRIPE_FEE_FIXED_MINOR = cardFee.fixedMinor;
/** Platform application fee on a seller sale, in basis points. ESTIMATE: 0 until the owner sets a transaction fee. AiMoneyPrinter
 *  currently earns from the monthly plan (preview/profit.ts), not a cut of sales. Override per call with `platformFeeBp`. */
export const PLATFORM_FEE_BP = 0;
/** One-off blueprint costs (cover images, promotion) are spread over this many expected sales. ESTIMATE, not a sales forecast. */
export const COST_SPREAD_SALES = 50;
/** The smallest margin per sale (after fees and the cost share) a suggested price must leave. */
export const MIN_MARGIN_MINOR = 100;

export interface FeeOptions {
  /** Defaults to PLATFORM_FEE_BP. */
  platformFeeBp?: number;
  /** Registered sellers remit 1/11 of a GST-inclusive sale. Default false. */
  gstRegistered?: boolean;
  /** The seller's one-off costs spread per sale. Default 0. */
  costPerSaleMinor?: number;
}

export interface FeeEstimate {
  isEstimate: true;
  currency: 'AUD';
  priceMinor: number;
  stripeFeeMinor: number;
  platformFeeMinor: number;
  /** What the seller receives from Stripe after both fees, before GST, cost share and tax. */
  sellerNetMinor: number;
  gstMinor: number;
  costPerSaleMinor: number;
  /** Seller net minus GST and the cost share: what one sale really leaves. May be negative. */
  marginMinor: number;
  /** Margin as a share of price in basis points (rounded half away from zero); 0 for a zero price. */
  marginBp: number;
  rates: { stripeBp: number; stripeFixedMinor: number; platformBp: number };
  notes: string[];
}

const isCents = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;
/** amount * bp / 10000 rounded half up, in integers only. */
const ofBp = (amount: number, bp: number): number => Math.floor((amount * bp + 5000) / 10000);
/** Integer division rounded half away from zero. */
const divRound = (n: number, d: number): number => (n < 0 ? -Math.floor((2 * -n + d) / (2 * d)) : Math.floor((2 * n + d) / (2 * d)));

export function estimateFees(priceMinor: number, opts: FeeOptions = {}): FeeEstimate {
  if (!isCents(priceMinor)) throw new RangeError('The price must be a whole number of cents, zero or more.');
  const platformBp = opts.platformFeeBp ?? PLATFORM_FEE_BP;
  if (!Number.isInteger(platformBp) || platformBp < 0 || platformBp > 10000) throw new RangeError('The platform fee must be whole basis points from 0 to 10000.');
  const cost = opts.costPerSaleMinor ?? 0;
  if (!isCents(cost)) throw new RangeError('The cost per sale must be a whole number of cents, zero or more.');
  const stripeFeeMinor = priceMinor > 0 ? ofBp(priceMinor, STRIPE_FEE_BP) + STRIPE_FEE_FIXED_MINOR : 0;
  const platformFeeMinor = ofBp(priceMinor, platformBp);
  const sellerNetMinor = priceMinor - stripeFeeMinor - platformFeeMinor;
  // round(price / 11) in integers
  const gstMinor = opts.gstRegistered ? Math.floor((2 * priceMinor + 11) / 22) : 0;
  const marginMinor = sellerNetMinor - gstMinor - cost;
  return {
    isEstimate: true, currency: 'AUD', priceMinor, stripeFeeMinor, platformFeeMinor, sellerNetMinor, gstMinor,
    costPerSaleMinor: cost, marginMinor,
    marginBp: priceMinor > 0 ? divRound(marginMinor * 10000, priceMinor) : 0,
    rates: { stripeBp: STRIPE_FEE_BP, stripeFixedMinor: STRIPE_FEE_FIXED_MINOR, platformBp },
    notes: [
      'ESTIMATE: Stripe card fees are about 1.65% + 30c for standard Australian cards; international and premium cards cost more.',
      platformBp === 0 ? 'ESTIMATE: no platform fee on sales is assumed.' : `ESTIMATE: a platform fee of ${platformBp / 100}% of each sale is assumed.`,
      opts.gstRegistered ? 'GST of one eleventh of the price is set aside because the seller is GST registered.' : 'GST and income tax are not deducted.',
    ],
  };
}

/** Starting price bands by product family, used only when no comparable prices are supplied. ASSUMPTIONS, not market data. */
export const FAMILY_PRICE_DEFAULTS: Record<BlueprintFamily, { lowMinor: number; anchorMinor: number; highMinor: number }> = {
  checklist: { lowMinor: 400, anchorMinor: 700, highMinor: 1000 },
  tracker: { lowMinor: 600, anchorMinor: 900, highMinor: 1400 },
  planner: { lowMinor: 1000, anchorMinor: 1400, highMinor: 2200 },
  'niche-kit': { lowMinor: 1200, anchorMinor: 1800, highMinor: 2800 },
};

export interface PriceSuggestion {
  isEstimate: true;
  currency: 'AUD';
  suggestedMinor: number;
  lowMinor: number;
  highMinor: number;
  /** The lowest price that still leaves MIN_MARGIN_MINOR per sale after fees and the cost share. */
  floorMinor: number;
  /** False when no price in range leaves MIN_MARGIN_MINOR; then floorMinor is the maximum price, not a real floor. */
  profitable: boolean;
  costShareMinor: number;
  basis: 'comparables' | 'family_default';
  comparablesUsed: number;
  reasons: string[];
  fees: FeeEstimate;
}

export interface SuggestInput {
  blueprint: Pick<BlueprintDefinition, 'id' | 'family' | 'costDefaults'>;
  /** Prices of similar products, whole cents (for example from opportunity evidence). Three or more are used as a band. */
  comparablePricesMinor?: readonly number[];
  fees?: Omit<FeeOptions, 'costPerSaleMinor'>;
}

/** Whole cents as text: A$15 or A$15.50. */
export const formatAud = (minor: number): string => {
  const abs = Math.abs(minor);
  return `${minor < 0 ? '-' : ''}A$${abs % 100 === 0 ? String(abs / 100) : (abs / 100).toFixed(2)}`;
};
const aud = formatAud;
const roundStep = (n: number) => Math.floor((n + PRICE_STEP_MINOR / 2) / PRICE_STEP_MINOR) * PRICE_STEP_MINOR;
const ceilStep = (n: number) => Math.ceil(n / PRICE_STEP_MINOR) * PRICE_STEP_MINOR;
const clamp = (n: number) => Math.min(PRICE_MAX_MINOR, Math.max(PRICE_MIN_MINOR, n));

/** Whole-number comparables inside the sane price range, sorted ascending. Anything else is ignored. */
export function usableComparables(prices: readonly unknown[] | undefined): number[] {
  return (prices ?? []).filter((p): p is number => isCents(p) && p >= PRICE_MIN_MINOR && p <= PRICE_MAX_MINOR).sort((a, b) => a - b);
}

export function suggestPrice(input: SuggestInput): PriceSuggestion {
  const reasons: string[] = [];
  const costTotal = input.blueprint.costDefaults.lines.reduce((s, l) => s + l.amountMinor, 0);
  const costShareMinor = Math.ceil(costTotal / COST_SPREAD_SALES);
  const feeOpts: FeeOptions = { ...input.fees, costPerSaleMinor: costShareMinor };

  let floorMinor = PRICE_MAX_MINOR;
  let profitable = false;
  for (let p = PRICE_MIN_MINOR; p <= PRICE_MAX_MINOR; p += 1) {
    if (estimateFees(p, feeOpts).marginMinor >= MIN_MARGIN_MINOR) { floorMinor = p; profitable = true; break; }
  }
  reasons.push(`Setup costs from the blueprint add up to ${aud(costTotal)}. Spread over ${COST_SPREAD_SALES} sales that is ${aud(costShareMinor)} per sale (an assumption, not a sales forecast).`);
  reasons.push(profitable
    ? `After card fees${feeOpts.platformFeeBp ? ' and the platform fee' : ''} and that cost share, ${aud(floorMinor)} is the lowest price that still leaves at least ${aud(MIN_MARGIN_MINOR)} per sale.`
    : `No profitable price exists in the allowed range (${aud(PRICE_MIN_MINOR)} to ${aud(PRICE_MAX_MINOR)}): fees and costs leave less than ${aud(MIN_MARGIN_MINOR)} per sale even at the top price. The suggestion is the maximum price and will still lose money or break even; lower the fees or the setup costs.`);

  const comps = usableComparables(input.comparablePricesMinor);
  let anchor: number;
  let bandLow: number;
  let bandHigh: number;
  let basis: PriceSuggestion['basis'];
  if (comps.length >= 3) {
    basis = 'comparables';
    anchor = comps[Math.floor((comps.length - 1) / 2)]!;
    bandLow = comps[Math.floor((comps.length - 1) * 0.25)]!;
    bandHigh = comps[Math.ceil((comps.length - 1) * 0.75)]!;
    reasons.push(`${comps.length} comparable prices were supplied. Their middle price is ${aud(anchor)} and most sit between ${aud(bandLow)} and ${aud(bandHigh)}.`);
  } else {
    basis = 'family_default';
    const d = FAMILY_PRICE_DEFAULTS[input.blueprint.family];
    anchor = d.anchorMinor; bandLow = d.lowMinor; bandHigh = d.highMinor;
    reasons.push(comps.length === 0
      ? `No comparable prices were supplied, so this uses a starting assumption for a ${input.blueprint.family}: ${aud(bandLow)} to ${aud(bandHigh)}. It is not market data.`
      : `Only ${comps.length} comparable price${comps.length === 1 ? ' was' : 's were'} usable and at least 3 are needed, so this uses a starting assumption for a ${input.blueprint.family}: ${aud(bandLow)} to ${aud(bandHigh)}. It is not market data.`);
  }

  const floorStep = ceilStep(floorMinor);
  // Fee rounding can wobble by a cent, so step up until the margin really holds.
  const holds = (p: number) => estimateFees(p, feeOpts).marginMinor >= MIN_MARGIN_MINOR;
  const lift = (p: number) => { let x = clamp(p); while (x < PRICE_MAX_MINOR && !holds(x)) x = clamp(x + PRICE_STEP_MINOR); return x; };
  const suggestedMinor = lift(Math.max(roundStep(anchor), floorStep));
  const lowMinor = Math.min(suggestedMinor, lift(Math.max(ceilStep(bandLow), floorStep)));
  const highMinor = Math.max(suggestedMinor, clamp(roundStep(bandHigh)));
  if (profitable && suggestedMinor > roundStep(anchor)) reasons.push(`The usual price was below the ${aud(floorMinor)} floor, so the suggestion was raised to keep each sale profitable.`);
  reasons.push(`Suggested price ${aud(suggestedMinor)}, with a sensible range of ${aud(lowMinor)} to ${aud(highMinor)}. You can set any price from ${aud(PRICE_MIN_MINOR)} to ${aud(PRICE_MAX_MINOR)}.`);

  return {
    isEstimate: true, currency: 'AUD', suggestedMinor, lowMinor, highMinor, floorMinor, profitable, costShareMinor, basis,
    comparablesUsed: comps.length, reasons, fees: estimateFees(suggestedMinor, feeOpts),
  };
}
