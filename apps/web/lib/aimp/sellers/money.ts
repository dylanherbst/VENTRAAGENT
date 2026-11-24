// Revenue separation. Two different kinds of money must never be added or passed to the same function:
//  - SellerCharge: what a seller's customer pays the SELLER (on the connected account: direct or destination charge).
//  - PlatformSubscriptionCharge: what a seller pays AiMoneyPrinter for the software.
// Distinct `flow` tags and distinct brands make mixing a compile error (and a runtime refusal).

declare const sellerBrand: unique symbol;
declare const platformBrand: unique symbol;

export interface SellerCharge {
  readonly flow: 'connected_account';
  readonly [sellerBrand]: true;
  /** 'direct' = charge created on the seller's account; 'destination' = platform charge with transfer_data to it. */
  readonly kind: 'direct' | 'destination';
  readonly stripeAccountId: string;
  readonly businessId: string;
  readonly workspaceId: string;
  readonly amountMinor: number;
  /** Platform fee skimmed from a seller sale, if any. Still seller-flow money, never subscription revenue. */
  readonly applicationFeeMinor: number;
  readonly currency: 'AUD';
}

export interface PlatformSubscriptionCharge {
  readonly flow: 'platform_subscription';
  readonly [platformBrand]: true;
  readonly workspaceId: string;
  readonly planId: string;
  readonly amountMinor: number;
  readonly currency: 'AUD';
}

export function sellerCharge(input: Omit<SellerCharge, 'flow' | typeof sellerBrand>): SellerCharge {
  if (!Number.isInteger(input.amountMinor) || input.amountMinor < 0) throw new Error('amountMinor must be a non-negative integer');
  if (!Number.isInteger(input.applicationFeeMinor) || input.applicationFeeMinor < 0 || input.applicationFeeMinor > input.amountMinor) {
    throw new Error('applicationFeeMinor must be between 0 and amountMinor');
  }
  if (!input.stripeAccountId.startsWith('acct_')) throw new Error('seller charges must reference a connected account (acct_...)');
  return { ...input, flow: 'connected_account' } as SellerCharge;
}

export function platformSubscriptionCharge(input: Omit<PlatformSubscriptionCharge, 'flow' | typeof platformBrand>): PlatformSubscriptionCharge {
  if (!Number.isInteger(input.amountMinor) || input.amountMinor < 0) throw new Error('amountMinor must be a non-negative integer');
  return { ...input, flow: 'platform_subscription' } as PlatformSubscriptionCharge;
}

/** Seller revenue totals. Accepts ONLY seller charges; anything else is refused at compile time and at runtime. */
export function sellerRevenueTotals(charges: readonly SellerCharge[]): { grossMinor: number; platformFeeMinor: number; sellerNetMinor: number } {
  let gross = 0;
  let fee = 0;
  for (const c of charges) {
    if (c.flow !== 'connected_account') throw new Error('sellerRevenueTotals only accepts connected-account charges');
    gross += c.amountMinor;
    fee += c.applicationFeeMinor;
  }
  return { grossMinor: gross, platformFeeMinor: fee, sellerNetMinor: gross - fee };
}

/** AiMoneyPrinter's own software revenue. Accepts ONLY subscription charges. */
export function platformSubscriptionTotal(charges: readonly PlatformSubscriptionCharge[]): number {
  let total = 0;
  for (const c of charges) {
    if (c.flow !== 'platform_subscription') throw new Error('platformSubscriptionTotal only accepts platform subscription charges');
    total += c.amountMinor;
  }
  return total;
}
