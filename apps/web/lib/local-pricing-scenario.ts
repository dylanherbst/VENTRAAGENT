import type { OfferCurrency } from './local-offers.ts';
import { formatOfferPrice, offerPriceMinor } from './local-offers.ts';
import type { LocalOffer } from './local-offers.ts';
import {
  formatOfferSnapshotLabel,
  offerSnapshotsMatch,
  snapshotFromLocalOffer,
  type OfferValidationOfferSnapshot,
} from './local-offer-validation-worksheet.ts';

export const pricingScenarioAssumptionLimit = 500;
export const pricingScenarioStorageByteLimit = 64000;
export const pricingScenarioRevisionCap = 9999;
/** 9_999.99 hours expressed in centi-hours (hundredths of an hour). */
export const pricingScenarioHoursCentiMax = 999_999;

export type PricingScenarioInput = {
  offerId: string;
  alternativePrice: string;
  directCostPerSale: string;
  hoursPerSale: string;
  targetHourlyAmount: string;
  assumptionNote: string;
};

export type PricingScenarioWorksheet = {
  version: 1;
  profileId: string;
  revision: number;
  updatedAt: string;
  offerId: string;
  offerSnapshot: OfferValidationOfferSnapshot;
  alternativePriceMinor: number;
  directCostPerSaleMinor: number;
  hoursPerSaleCenti: number;
  targetHourlyMinor?: number;
  assumptionNote?: string;
};

export type PricingScenarioLinkageWarning = {
  code: 'offer-missing' | 'offer-drift';
  message: string;
};

export type PricingScenarioEstimateProjection = {
  disclaimer: string;
  offerLabel: string;
  currency: OfferCurrency;
  savedOfferPriceLabel: string;
  alternativePriceLabel: string;
  directCostLabel: string;
  marginMinor: number;
  marginLabel: string;
  hoursPerSaleLabel: string;
  amountPerHourMinor: number | null;
  amountPerHourLabel: string | null;
  priceDifferenceMinor: number;
  priceDifferenceLabel: string;
  targetHourlyLabel: string | null;
  targetGapLabel: string | null;
  assumptionNote: string | null;
  linkageWarnings: string[];
};

export const pricingScenarioStorageKey = (profileId: string) =>
  `launchpad.pricing-scenario-worksheet.v1.${profileId}`;

const isoTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

const optionalPlainText = (value: unknown, label: string, limit: number) => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > limit) {
    throw new Error(`${label} must be ${limit} characters or fewer when provided.`);
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

function parseUpdatedAt(value: unknown): string {
  if (typeof value !== 'string' || !isoTimestampPattern.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error('Invalid saved pricing scenario worksheet. Nothing was overwritten.');
  }
  return value;
}

function parseRevision(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > pricingScenarioRevisionCap) {
    throw new Error('Invalid saved pricing scenario worksheet. Nothing was overwritten.');
  }
  return value as number;
}

function parseOfferSnapshot(value: unknown, profileId: string): OfferValidationOfferSnapshot {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid offer snapshot on saved pricing scenario worksheet.');
  }
  const snap = value as OfferValidationOfferSnapshot;
  if (typeof snap.offerId !== 'string' || !snap.offerId.trim()) {
    throw new Error('Invalid offer snapshot on saved pricing scenario worksheet.');
  }
  if (!Number.isSafeInteger(snap.amountMinor) || snap.amountMinor < 0) {
    throw new Error('Invalid offer snapshot on saved pricing scenario worksheet.');
  }
  parseUpdatedAt(snap.capturedAt);
  return snapshotFromLocalOffer(
    {
      id: snap.offerId.trim(),
      profileId,
      version: 1,
      name: typeof snap.name === 'string' ? snap.name : '',
      audience: typeof snap.audience === 'string' ? snap.audience : '',
      outcome: typeof snap.outcome === 'string' ? snap.outcome : '',
      delivery: typeof snap.delivery === 'string' ? snap.delivery : '',
      kind: snap.kind,
      currency: snap.currency,
      amountMinor: snap.amountMinor,
    },
    snap.capturedAt,
  );
}

/** Parse creator-entered hours (0–9999.99) into centi-hours without floating point. */
export function pricingScenarioHoursCenti(raw: string): number {
  const trimmed = raw.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    throw new Error('Enter estimated hours per sale as 0 or more with at most two decimal places.');
  }
  const [whole, fraction = ''] = trimmed.split('.');
  const centi = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(centi) || centi < 0) {
    throw new Error('Estimated hours per sale is invalid.');
  }
  if (centi > pricingScenarioHoursCentiMax) {
    throw new Error('Estimated hours per sale is too large.');
  }
  return centi;
}

export function formatPricingScenarioHours(centi: number): string {
  if (!Number.isSafeInteger(centi) || centi < 0 || centi > pricingScenarioHoursCentiMax) {
    throw new Error('Invalid estimated hours.');
  }
  const digits = String(centi).padStart(3, '0');
  const whole = digits.slice(0, -2);
  const frac = digits.slice(-2);
  if (frac === '00') return whole;
  if (frac.endsWith('0')) return `${whole}.${frac[0]}`;
  return `${whole}.${frac}`;
}

export function pricingScenarioMarginMinor(alternativeMinor: number, directCostMinor: number): number {
  if (
    !Number.isSafeInteger(alternativeMinor) ||
    !Number.isSafeInteger(directCostMinor) ||
    alternativeMinor < 0 ||
    directCostMinor < 0
  ) {
    throw new Error('Invalid minor-unit amounts for margin.');
  }
  const margin = alternativeMinor - directCostMinor;
  if (!Number.isSafeInteger(margin)) throw new Error('Margin calculation overflow.');
  return margin;
}

/** Estimated amount per hour in offer currency minor units; null when hours are zero. */
export function pricingScenarioAmountPerHourMinor(marginMinor: number, hoursCenti: number): number | null {
  if (hoursCenti === 0) return null;
  if (!Number.isSafeInteger(marginMinor)) throw new Error('Invalid margin for per-hour estimate.');
  const product = marginMinor * 100;
  if (!Number.isSafeInteger(product)) throw new Error('Per-hour estimate overflow.');
  const perHour = Math.round(product / hoursCenti);
  if (!Number.isSafeInteger(perHour)) throw new Error('Per-hour estimate overflow.');
  return perHour;
}

export function formatSignedPriceDifferenceMinor(diffMinor: number, currency: OfferCurrency): string {
  if (!Number.isSafeInteger(diffMinor)) throw new Error('Invalid price difference.');
  if (diffMinor === 0) return `${currency} ${formatOfferPrice(0)} (same as saved offer price)`;
  const sign = diffMinor > 0 ? '+' : '−';
  return `${sign}${currency} ${formatOfferPrice(Math.abs(diffMinor))} vs saved offer price`;
}

function buildWorksheet(
  input: PricingScenarioInput,
  profileId: string,
  offerSnapshot: OfferValidationOfferSnapshot,
  revision: number,
  updatedAt: string,
): PricingScenarioWorksheet {
  if (typeof profileId !== 'string' || !profileId.trim() || profileId.length > 160) {
    throw new Error('Profile ID is required.');
  }
  const offerId = input.offerId.trim();
  if (!offerId || offerId.length > 160) {
    throw new Error('Choose a saved offer from your local library before saving.');
  }
  if (offerId !== offerSnapshot.offerId) {
    throw new Error('Selected offer does not match the captured snapshot.');
  }
  const alternativePriceMinor = offerPriceMinor(input.alternativePrice);
  const directCostPerSaleMinor = offerPriceMinor(input.directCostPerSale);
  const hoursPerSaleCenti = pricingScenarioHoursCenti(input.hoursPerSale);
  const targetRaw = input.targetHourlyAmount.trim();
  const targetHourlyMinor = targetRaw ? offerPriceMinor(targetRaw) : undefined;
  const assumptionNote = optionalPlainText(
    input.assumptionNote,
    'Assumption note',
    pricingScenarioAssumptionLimit,
  );
  pricingScenarioMarginMinor(alternativePriceMinor, directCostPerSaleMinor);
  if (hoursPerSaleCenti > 0) {
    pricingScenarioAmountPerHourMinor(
      pricingScenarioMarginMinor(alternativePriceMinor, directCostPerSaleMinor),
      hoursPerSaleCenti,
    );
  }
  return {
    version: 1,
    profileId: profileId.trim(),
    revision,
    updatedAt: parseUpdatedAt(updatedAt),
    offerId,
    offerSnapshot,
    alternativePriceMinor,
    directCostPerSaleMinor,
    hoursPerSaleCenti,
    ...(targetHourlyMinor !== undefined ? { targetHourlyMinor } : {}),
    ...(assumptionNote ? { assumptionNote } : {}),
  };
}

export function blankPricingScenarioInput(offerId = ''): PricingScenarioInput {
  return {
    offerId,
    alternativePrice: '',
    directCostPerSale: '',
    hoursPerSale: '',
    targetHourlyAmount: '',
    assumptionNote: '',
  };
}

export function editPricingScenarioWorksheet(worksheet: PricingScenarioWorksheet): PricingScenarioInput {
  return {
    offerId: worksheet.offerId,
    alternativePrice: formatOfferPrice(worksheet.alternativePriceMinor),
    directCostPerSale: formatOfferPrice(worksheet.directCostPerSaleMinor),
    hoursPerSale: formatPricingScenarioHours(worksheet.hoursPerSaleCenti),
    targetHourlyAmount:
      worksheet.targetHourlyMinor !== undefined ? formatOfferPrice(worksheet.targetHourlyMinor) : '',
    assumptionNote: worksheet.assumptionNote ?? '',
  };
}

export function savePricingScenarioWorksheet(
  input: PricingScenarioInput,
  profileId: string,
  offerSnapshot: OfferValidationOfferSnapshot,
  prior: PricingScenarioWorksheet | null,
): PricingScenarioWorksheet {
  const revision = prior ? Math.min(prior.revision + 1, pricingScenarioRevisionCap) : 1;
  return buildWorksheet(input, profileId, offerSnapshot, revision, new Date().toISOString());
}

export function pricingScenarioWorksheetFromInput(
  input: PricingScenarioInput,
  profileId: string,
  offerSnapshot: OfferValidationOfferSnapshot,
  prior: PricingScenarioWorksheet | null,
): PricingScenarioWorksheet {
  const revision = prior?.revision ?? 1;
  return buildWorksheet(input, profileId, offerSnapshot, revision, new Date().toISOString());
}

export function restorePricingScenarioWorksheet(raw: string | null, profileId: string): PricingScenarioWorksheet | null {
  if (raw === null) return null;
  if (raw.length > pricingScenarioStorageByteLimit) {
    throw new Error('Saved pricing scenario worksheet is too large. Nothing was overwritten.');
  }
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid saved pricing scenario worksheet. Nothing was overwritten.');
  }
  const record = value as PricingScenarioWorksheet;
  if (record.version !== 1 || record.profileId !== profileId) {
    throw new Error('Invalid or mismatched pricing scenario worksheet. Nothing was overwritten.');
  }
  const revision = parseRevision(record.revision);
  const snapshot = parseOfferSnapshot(record.offerSnapshot, profileId);
  const input = editPricingScenarioWorksheet({ ...record, offerSnapshot: snapshot });
  return buildWorksheet(input, profileId, snapshot, revision, parseUpdatedAt(record.updatedAt));
}

export function persistPricingScenarioWorksheet(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  profileId: string,
  expectedRaw: string | null,
  worksheet: PricingScenarioWorksheet,
): string {
  const key = pricingScenarioStorageKey(profileId);
  if (storage.getItem(key) !== expectedRaw) {
    throw new Error(
      'Pricing scenario worksheet changed in another tab. Your unsaved changes remain; copy them before reloading the saved worksheet.',
    );
  }
  const checked = restorePricingScenarioWorksheet(JSON.stringify(worksheet), profileId);
  if (!checked) throw new Error('Invalid pricing scenario worksheet.');
  const raw = JSON.stringify(checked);
  if (raw.length > pricingScenarioStorageByteLimit) {
    throw new Error('Pricing scenario storage limit reached. Your unsaved changes remain.');
  }
  storage.setItem(key, raw);
  return raw;
}

export function pricingScenarioWorksheetAllowlistKeys(): readonly (keyof PricingScenarioWorksheet)[] {
  return [
    'version',
    'profileId',
    'revision',
    'updatedAt',
    'offerId',
    'offerSnapshot',
    'alternativePriceMinor',
    'directCostPerSaleMinor',
    'hoursPerSaleCenti',
    'targetHourlyMinor',
    'assumptionNote',
  ];
}

export function pricingScenarioEstimateAllowlistKeys(): readonly (keyof PricingScenarioEstimateProjection)[] {
  return [
    'disclaimer',
    'offerLabel',
    'currency',
    'savedOfferPriceLabel',
    'alternativePriceLabel',
    'directCostLabel',
    'marginMinor',
    'marginLabel',
    'hoursPerSaleLabel',
    'amountPerHourMinor',
    'amountPerHourLabel',
    'priceDifferenceMinor',
    'priceDifferenceLabel',
    'targetHourlyLabel',
    'targetGapLabel',
    'assumptionNote',
    'linkageWarnings',
  ];
}

export function analyzePricingScenarioLinkage(
  worksheet: PricingScenarioWorksheet,
  offers: readonly LocalOffer[],
): PricingScenarioLinkageWarning[] {
  const warnings: PricingScenarioLinkageWarning[] = [];
  const current = offers.find(offer => offer.id === worksheet.offerId);
  if (!current) {
    warnings.push({
      code: 'offer-missing',
      message:
        'The linked offer is no longer in your local offer library. Estimates use your saved snapshot; your offer price in the library is unchanged.',
    });
  } else if (
    !offerSnapshotsMatch(worksheet.offerSnapshot, snapshotFromLocalOffer(current, worksheet.offerSnapshot.capturedAt))
  ) {
    warnings.push({
      code: 'offer-drift',
      message:
        'The saved offer in your library differs from the snapshot on this worksheet. Saved offer price in your library is unchanged — review drift before comparing estimates.',
    });
  }
  return warnings;
}

export function buildPricingScenarioEstimates(
  worksheet: PricingScenarioWorksheet,
  linkageWarnings: readonly PricingScenarioLinkageWarning[],
): PricingScenarioEstimateProjection {
  const currency = worksheet.offerSnapshot.currency;
  const disclaimer =
    'Manual pricing estimates only. Figures exclude taxes, fees, refunds, overhead, and market demand. No AI recommendation or pricing advice; estimates are not a recommended price. No profitability guarantee or automatic offer price update.';
  const marginMinor = pricingScenarioMarginMinor(
    worksheet.alternativePriceMinor,
    worksheet.directCostPerSaleMinor,
  );
  const amountPerHourMinor = pricingScenarioAmountPerHourMinor(marginMinor, worksheet.hoursPerSaleCenti);
  const priceDifferenceMinor = worksheet.alternativePriceMinor - worksheet.offerSnapshot.amountMinor;
  if (!Number.isSafeInteger(priceDifferenceMinor)) {
    throw new Error('Price comparison overflow.');
  }
  let targetGapLabel: string | null = null;
  if (worksheet.targetHourlyMinor !== undefined && amountPerHourMinor !== null) {
    const gap = amountPerHourMinor - worksheet.targetHourlyMinor;
    if (!Number.isSafeInteger(gap)) throw new Error('Target hourly comparison overflow.');
    targetGapLabel = formatSignedPriceDifferenceMinor(gap, currency).replace(
      'vs saved offer price',
      'vs your target hourly amount (estimate)',
    );
  }
  return {
    disclaimer,
    offerLabel: formatOfferSnapshotLabel(worksheet.offerSnapshot),
    currency,
    savedOfferPriceLabel: `${currency} ${formatOfferPrice(worksheet.offerSnapshot.amountMinor)}`,
    alternativePriceLabel: `${currency} ${formatOfferPrice(worksheet.alternativePriceMinor)}`,
    directCostLabel: `${currency} ${formatOfferPrice(worksheet.directCostPerSaleMinor)}`,
    marginMinor,
    marginLabel: `${currency} ${formatOfferPrice(marginMinor)} (alternative price minus direct cost per sale — estimate)`,
    hoursPerSaleLabel: `${formatPricingScenarioHours(worksheet.hoursPerSaleCenti)} h per sale (your estimate)`,
    amountPerHourMinor,
    amountPerHourLabel:
      amountPerHourMinor === null
        ? null
        : `${currency} ${formatOfferPrice(amountPerHourMinor)} per hour (estimate)`,
    priceDifferenceMinor,
    priceDifferenceLabel: formatSignedPriceDifferenceMinor(priceDifferenceMinor, currency),
    targetHourlyLabel:
      worksheet.targetHourlyMinor !== undefined
        ? `${currency} ${formatOfferPrice(worksheet.targetHourlyMinor)} target hourly (optional)`
        : null,
    targetGapLabel,
    assumptionNote: worksheet.assumptionNote ?? null,
    linkageWarnings: linkageWarnings.map(w => w.message),
  };
}

export function projectPricingScenarioEstimates(
  worksheet: PricingScenarioWorksheet,
  offers: readonly LocalOffer[],
): PricingScenarioEstimateProjection {
  return buildPricingScenarioEstimates(worksheet, analyzePricingScenarioLinkage(worksheet, offers));
}
