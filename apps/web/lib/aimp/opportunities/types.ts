// Opportunity Finder types (AMP-012). The score is a FIT score: how well an idea matches the profile and the
// evidence found. It is never a prediction of earnings.
import type { Confidence, ScoringFactor } from '../contracts.ts';

export const preferredEfforts = ['low', 'medium', 'high'] as const;
export type PreferredEffort = (typeof preferredEfforts)[number];

export interface FinderProfile {
  /** Launch budget, whole cents AUD. */
  budgetMinor: number;
  weeklyHours: number;
  interests: string[];
  skills: string[];
  preferredEffort: PreferredEffort;
}

export interface ProfileIssue { field: keyof FinderProfile | 'profile'; message: string }

/** Thrown by validateProfile / findOpportunities for a bad profile. Never thrown for "no ideas qualify". */
export class InvalidProfileError extends Error {
  readonly code = 'invalid_profile' as const;
  readonly issues: ProfileIssue[];
  constructor(issues: ProfileIssue[]) {
    super(`Invalid profile: ${issues.map((i) => `${i.field}: ${i.message}`).join('; ')}`);
    this.name = 'InvalidProfileError';
    this.issues = issues;
  }
}

export type FinderMode = 'fixture' | 'live';

export interface FinderEvidence {
  source: string;
  /** A real URL, or the literal "fixture" for demo data. */
  url: string;
  note: string;
  /** ISO date-time; comes from the injected clock. */
  retrievedAt: string;
  confidence: Confidence;
  /** "demo/fixture" for every entry in fixture mode; "live" for market sources; "internal" for blueprint defaults in live mode. */
  label: 'demo/fixture' | 'live' | 'internal';
}

export interface FactorBreakdown {
  factor: ScoringFactor;
  /** 0-10. When evidence is missing this is a neutral placeholder (5), not a finding. */
  score: number;
  weight: number;
  confidence: Confidence;
  evidence: FinderEvidence[];
  missingEvidence: boolean;
  /** Present when the score is a placeholder or derived rather than found. */
  assumption?: string;
}

export interface OpportunityIdea {
  rank: number;
  niche: string;
  whatToSell: string;
  whoToSellTo: string;
  /** Reasons tied to the profile. */
  whyItFits: string[];
  blueprint: { id: string; version: string };
  factors: Record<ScoringFactor, FactorBreakdown>;
  fitScore: number;
  fitScoreLabel: 'fit score';
  confidence: Confidence;
  missingEvidence: ScoringFactor[];
  estimatedStartupCostMinor: number;
  weeklyHours: number;
  /** Where the first buyers are most likely to come from (the blueprint's lead marketing channel). */
  firstBuyerChannel: string;
  /** What the owner still has to do before launch, from the blueprint's build steps. */
  ownerWork: { action: string; hours: number }[];
  /** Always present: the score is not an earnings forecast. */
  notice: string;
}

export interface ExcludedCandidate { niche: string; reason: string }

export interface FinderResult {
  mode: FinderMode;
  requested: 5;
  ideas: OpportunityIdea[];
  /** Present only when fewer than five ideas qualify; says why. */
  shortfall?: { returned: number; reason: string; excluded: ExcludedCandidate[] };
  rubricVersion: number;
  generatedAt: string;
}

export const FIT_NOTICE = 'This is a fit score: how well the idea matches your profile and the evidence found. It is not a prediction of earnings.';
