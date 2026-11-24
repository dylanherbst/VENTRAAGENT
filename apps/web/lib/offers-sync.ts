import { restoreLocalOffers } from './local-offers.ts';
import type { Profile } from './onboarding.ts';

// Service offers and pricing: the local store is a JSON array validated by the real offers restore function.
/** Throws unless raw is a valid offers list for this profile. */
export function checkOffersRaw(raw: string, profile: Profile): void {
  if (!restoreLocalOffers(raw, profile)) throw new Error('Offers are not valid for this business. Your local copy is unchanged.');
}
