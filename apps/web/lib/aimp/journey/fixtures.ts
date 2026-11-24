// First-journey acceptance fixtures (AMP-067): two separate test businesses, each with its own workspace, owner, buyer and
// (fixture) payout account. Everything here is a fixture: no real person, no real Stripe account, no network.
import type { Answers } from '../onboarding/model.ts';

export type JourneyKey = 'a' | 'b';

export interface JourneySeed {
  key: JourneyKey;
  label: string;
  workspaceId: string;
  ownerId: string;
  buyerEmail: string;
  /** Fixture connected-account id. Not a real Stripe account. */
  sellerAccountId: string;
  /** What the owner answers at intake: budget (cents), weekly hours, interests, skills, effort. */
  answers: Answers;
}

export const JOURNEY_SEEDS: Readonly<Record<JourneyKey, JourneySeed>> = {
  a: {
    key: 'a', label: 'Test business A', workspaceId: 'ws-journey-a', ownerId: 'owner-journey-a', buyerEmail: 'buyer-journey-a@example.test',
    sellerAccountId: 'acct_journey_ready_a',
    answers: { budgetMinor: 20000, weeklyHours: 10, interests: ['wedding', 'planning', 'budget'], skills: ['design'], effort: 'medium' },
  },
  b: {
    key: 'b', label: 'Test business B', workspaceId: 'ws-journey-b', ownerId: 'owner-journey-b', buyerEmail: 'buyer-journey-b@example.test',
    sellerAccountId: 'acct_journey_ready_b',
    answers: { budgetMinor: 20000, weeklyHours: 10, interests: ['fitness', 'training', 'home'], skills: ['writing'], effort: 'medium' },
  },
};

/** Same two businesses, but BOTH in workspace A (different owners, buyers and payout accounts). Proves business-level isolation on its own. */
export const SAME_WORKSPACE_SEEDS: Readonly<Record<JourneyKey, JourneySeed>> = {
  a: JOURNEY_SEEDS.a,
  b: { ...JOURNEY_SEEDS.b, workspaceId: JOURNEY_SEEDS.a.workspaceId },
};

export const JOURNEY_KEYS: readonly JourneyKey[] = ['a', 'b'];
/** Fixed start of the fixture clock so every run is repeatable. */
export const JOURNEY_START = Date.parse('2026-11-14T10:00:00Z');
export const JOURNEY_FILES_SECRET = 'fixture-only-journey-files-signing-secret-0000';
export const JOURNEY_DOWNLOAD_PATH = '/api/aimp/fulfilment/download';
export const JOURNEY_ROOT_DOMAIN = 'stores.example.test';
