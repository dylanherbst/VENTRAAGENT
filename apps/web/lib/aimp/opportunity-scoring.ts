// Deterministic opportunity scoring (plan §B02). A ranking heuristic, never a probability of making money.
import { scoringFactors, type Confidence, type Opportunity, type ScoringFactor } from './contracts.ts';

export const rubricVersion = 1;
/** Initial weights; must sum to 1. Versioned so outcomes can re-weight later without rewriting history. */
export const weights: Record<ScoringFactor, number> = {
  demand: 0.25, automation: 0.25, lowStartupCost: 0.2, lowOngoingWorkload: 0.15, differentiation: 0.1, repeatPurchases: 0.05,
};
const confidenceRank: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

export interface ScoredOpportunity { opportunity: Opportunity; score: number; confidence: Confidence; excludedReason?: string }

/** Score 0–100. Factor scores must be 0–10. Opportunities with no evidence on demand are excluded, not guessed. */
export function scoreOpportunity(o: Opportunity): ScoredOpportunity {
  let total = 0;
  let minConfidence: Confidence = 'high';
  for (const f of scoringFactors) {
    const factor = o.factors[f];
    if (!factor || !Number.isFinite(factor.score) || factor.score < 0 || factor.score > 10) {
      return { opportunity: o, score: 0, confidence: 'low', excludedReason: `Invalid ${f} score` };
    }
    total += factor.score * 10 * weights[f];
    if (confidenceRank[factor.confidence] < confidenceRank[minConfidence]) minConfidence = factor.confidence;
  }
  if (o.factors.demand.evidence.length === 0) {
    return { opportunity: o, score: 0, confidence: 'low', excludedReason: 'No demand evidence' };
  }
  return { opportunity: o, score: Math.round(total * 10) / 10, confidence: minConfidence };
}

/** Rank and return the top N eligible opportunities (default five). Stable order for ties: niche name. */
export function shortlist(opportunities: Opportunity[], n = 5): ScoredOpportunity[] {
  return opportunities
    .map(scoreOpportunity)
    .filter((s) => !s.excludedReason)
    .sort((a, b) => b.score - a.score || a.opportunity.niche.localeCompare(b.opportunity.niche))
    .slice(0, n);
}
