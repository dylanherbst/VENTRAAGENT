import { restoreProfile } from './onboarding.ts';
import { editLocalOffer, offerErrors, restoreLocalOffers } from './local-offers.ts';
import type { Profile } from './onboarding.ts';
import type { LocalOffer } from './local-offers.ts';
export function checkedProfile(value: unknown): Profile {
  const raw = JSON.stringify(value);
  const p = restoreProfile(raw);
  if (!p || raw.length > 32000) throw new Error('Complete a valid business profile (maximum 32 KB).');
  for (const field of ['name', 'industry', 'location', 'audience', 'goal', 'expertise', 'website', 'channels'] as const) {
    if (p[field].length > 500) throw new Error('Business fields must be 500 characters or fewer.');
  }
  // Project only known fields; never persist arbitrary payload keys.
  return Object.fromEntries(Object.keys({ version: 0, id: 0, name: 0, primary: 0, pathways: 0, stage: 0, industry: 0, location: 0, audience: 0, goal: 0, expertise: 0, educationOffer: 0, businessType: 0, website: 0, channels: 0, completed: 0, toolNotes: 0 }).map(k => [k, p[k as keyof Profile]])) as Profile;
}
export function checkedOffer(value: unknown, profile: Profile): LocalOffer {
  const offers = restoreLocalOffers(JSON.stringify([value]), profile);
  if (!offers?.length) throw new Error('Offer is invalid or belongs to another profile.');
  const offer = offers[0];
  if (offer.id.length > 160 || offerErrors(editLocalOffer(offer), profile).length) throw new Error('Offer is invalid.');
  return { version: 1, id: offer.id, profileId: profile.id, name: offer.name, audience: offer.audience, outcome: offer.outcome, delivery: offer.delivery, kind: offer.kind, currency: offer.currency, amountMinor: offer.amountMinor };
}
export function checkedImport(value: unknown) {
  if (!value || typeof value !== 'object') throw new Error('Import is invalid.');
  const input = value as { profile?: unknown; offers?: unknown };
  const profile = checkedProfile(input.profile);
  if (!Array.isArray(input.offers) || input.offers.length > 100) throw new Error('Import up to 100 offers at a time.');
  const offers = input.offers.map(o => checkedOffer(o, profile));
  if (new Set(offers.map(o => o.id)).size !== offers.length) throw new Error('Duplicate local offer IDs.');
  return { profile, offers };
}
export function uuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new Error('Choose a valid workspace or offer.');
  return value;
}
