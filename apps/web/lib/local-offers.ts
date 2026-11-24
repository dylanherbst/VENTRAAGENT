import type { Profile } from './onboarding.ts';

export const offerCurrencies = ['AUD', 'USD', 'GBP', 'EUR', 'NZD', 'CAD'] as const;
export type OfferCurrency = typeof offerCurrencies[number];
export type DeliveryKind = 'service' | 'education' | 'product';
export type OfferDraft = { name: string; audience: string; outcome: string; price: string; currency: OfferCurrency; kind: DeliveryKind; delivery: string };
export type LocalOffer = Omit<OfferDraft, 'price'> & { version: 1; id: string; profileId: string; amountMinor: number };
export function offerStorageKey(profileId: string) { return `launchpad.offers.v1.${profileId}`; }
export function blankOffer(profile: Profile): OfferDraft {
  return { name: '', audience: profile.audience, outcome: '', price: '', currency: 'AUD', kind: profile.primary === 'education' ? 'education' : 'service', delivery: '' };
}
// Decimal string conversion avoids rounding a floating point price. All supported currencies use two minor digits.
export function offerPriceMinor(raw: string): number {
  if (!/^\d+(\.\d{1,2})?$/.test(raw.trim())) throw new Error('Enter a price of 0 or more with at most two decimal places.');
  const [whole, fraction = ''] = raw.trim().split('.');
  const minor = Number(whole + fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(minor)) throw new Error('Price is too large.');
  return minor;
}
// Keep the full accepted safe-integer range exact when displaying or editing prices.
export function formatOfferPrice(amountMinor: number): string {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) throw new Error('Invalid minor-unit price.');
  const digits = String(amountMinor).padStart(3, '0');
  return `${digits.slice(0, -2)}.${digits.slice(-2)}`;
}
export function offerErrors(draft: OfferDraft, profile: Profile): string[] {
  const errors: string[] = [];
  for (const [field, label, limit] of [['name', 'Offer name', 160], ['audience', 'Audience', 500], ['outcome', 'Description or outcome', 3000], ['delivery', 'Delivery details', 3000]] as const) {
    if (!draft[field].trim()) errors.push(`${label} is required.`);
    else if (draft[field].length > limit) errors.push(`${label} is too long.`);
  }
  if (!(offerCurrencies as readonly string[]).includes(draft.currency)) errors.push('Choose a supported currency.');
  if (!['service', 'education', 'product'].includes(draft.kind)) errors.push('Choose a delivery type.');
  else if (!profile.pathways.includes(draft.kind === 'education' ? 'education' : 'business')) errors.push(`Activate the ${draft.kind === 'education' ? 'Education' : 'Services'} pathway before saving this type of offer.`);
  try { offerPriceMinor(draft.price); } catch (error) { errors.push((error as Error).message); }
  return errors;
}
export function saveLocalOffer(offers: readonly LocalOffer[], draft: OfferDraft, profile: Profile, id: string): LocalOffer[] {
  const errors = offerErrors(draft, profile);
  if (errors.length) throw new Error(errors.join(' '));
  if (!id.trim() || offers.some(offer => offer.profileId !== profile.id)) throw new Error('Offer profile does not match.');
  const { price, ...details } = draft;
  const offer: LocalOffer = { ...details, name: details.name.trim(), audience: details.audience.trim(), outcome: details.outcome.trim(), delivery: details.delivery.trim(), version: 1, id, profileId: profile.id, amountMinor: offerPriceMinor(price) };
  return offers.some(item => item.id === id) ? offers.map(item => item.id === id ? offer : item) : [...offers, offer];
}
export function editLocalOffer(offer: LocalOffer): OfferDraft {
  return { name: offer.name, audience: offer.audience, outcome: offer.outcome, price: formatOfferPrice(offer.amountMinor), currency: offer.currency, kind: offer.kind, delivery: offer.delivery };
}
export function restoreLocalOffers(raw: string | null, profile: Profile): LocalOffer[] | null {
  if (raw === null) return [];
  try {
    const offers: unknown = JSON.parse(raw);
    if (!Array.isArray(offers)) return null;
    const ids = new Set<string>();
    for (const value of offers) {
      if (!value || typeof value !== 'object') return null;
      const offer = value as LocalOffer;
      if (offer.version !== 1 || offer.profileId !== profile.id || typeof offer.id !== 'string' || !offer.id.trim() || ids.has(offer.id) || !Number.isSafeInteger(offer.amountMinor) || offer.amountMinor < 0) return null;
      for (const key of ['name', 'audience', 'outcome', 'delivery', 'kind', 'currency'] as const) if (typeof offer[key] !== 'string') return null;
      if (offerErrors(editLocalOffer(offer), profile).length) return null;
      ids.add(offer.id);
    }
    return offers as LocalOffer[];
  } catch { return null; }
}
