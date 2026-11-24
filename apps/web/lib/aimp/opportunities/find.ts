// findOpportunities (AMP-012): ranks candidate ideas for a profile using the existing deterministic rubric
// (lib/aimp/opportunity-scoring.ts). Pure and offline: no network, no randomness, time is injected.
// Evidence is never invented: a factor without evidence gets a neutral placeholder and is listed in missingEvidence.
import { scoringFactors, type Confidence, type Opportunity, type OpportunityFactor, type ScoringFactor } from '../contracts.ts';
import { blueprintRegistry, type BlueprintRegistry } from '../blueprints/index.ts';
import { rubricVersion, scoreOpportunity, shortlist, weights } from '../opportunity-scoring.ts';
import { demoCandidates, FIXTURE_CONFIDENCE_CAP, type Candidate, type Signal, type SignalKey } from './candidates.ts';
import { validateProfile } from './profile.ts';
import {
  FIT_NOTICE, type ExcludedCandidate, type FactorBreakdown, type FinderEvidence, type FinderMode, type FinderProfile,
  type FinderResult, type OpportunityIdea,
} from './types.ts';

/** A signal from a real source; only used in live mode, supplied by the caller. */
export type LiveSignal = Signal & { url: string };

export interface FinderDeps {
  /** Injected clock; used for every retrievedAt. */
  now: () => Date;
  /** Default "fixture". In fixture mode all evidence is labelled demo/fixture. */
  mode?: FinderMode;
  blueprints?: BlueprintRegistry;
  candidates?: readonly Candidate[];
  /** Live mode only. With none supplied, live mode has no market evidence and every such factor is missing. */
  liveSignals?: (c: Candidate) => Partial<Record<SignalKey, LiveSignal>>;
}

const PLACEHOLDER = 5;
const EFFORT_SHARE = { low: 0.4, medium: 0.7, high: 1 } as const;
const clamp10 = (n: number) => Math.min(10, Math.max(0, Math.round(n * 10) / 10));
const aud = (minor: number) => `$${(minor / 100).toFixed(2)}`;
const words = (list: string[]) => new Set(list.flatMap((t) => t.toLowerCase().split(/[^a-z0-9]+/)).filter(Boolean));

function evidenceFrom(mode: FinderMode, at: string, source: string, url: string | undefined, note: string, confidence: Confidence, internal = false): FinderEvidence {
  if (mode === 'fixture') return { source, url: 'fixture', note: `Demo data: ${note}`, retrievedAt: at, confidence: FIXTURE_CONFIDENCE_CAP, label: 'demo/fixture' };
  if (internal) return { source, url: url ?? source, note: `${note} (blueprint default, not market data)`, retrievedAt: at, confidence, label: 'internal' };
  return { source, url: url ?? source, note, retrievedAt: at, confidence, label: 'live' };
}

interface Built { candidate: Candidate; opportunity: Opportunity; breakdown: Record<ScoringFactor, FactorBreakdown>; costMinor: number; version: string; hoursKnown: boolean; firstBuyerChannel: string; ownerWork: { action: string; hours: number }[] }

export function findOpportunities(profileInput: unknown, deps: FinderDeps): FinderResult {
  const profile = validateProfile(profileInput);
  const mode = deps.mode ?? 'fixture';
  const nowDate = deps.now();
  if (!(nowDate instanceof Date) || Number.isNaN(nowDate.getTime())) throw new TypeError('deps.now must return a valid Date');
  const at = nowDate.toISOString();
  const registry = deps.blueprints ?? blueprintRegistry;
  const candidates = deps.candidates ?? demoCandidates;

  const excluded: ExcludedCandidate[] = [];
  const built: Built[] = [];
  for (const c of candidates) {
    const b = build(c, profile, mode, at, registry, deps, excluded);
    if (b) built.push(b);
  }

  // Reuse the rubric: ineligible ideas (for example no demand evidence) are reported, never guessed.
  const eligible: Built[] = [];
  for (const b of built) {
    const scored = scoreOpportunity(b.opportunity);
    if (scored.excludedReason) excluded.push({ niche: b.candidate.niche, reason: scored.excludedReason === 'No demand evidence' ? 'No demand evidence found, so it is not ranked' : scored.excludedReason });
    else eligible.push(b);
  }
  const top = shortlist(eligible.map((b) => b.opportunity), 5);
  // Opportunity objects carry no id, so map each one back to its candidate id (niche names need not be unique).
  const idOf = new Map(eligible.map((b) => [b.opportunity, b.candidate.id]));
  const byId = new Map(eligible.map((b) => [b.candidate.id, b]));
  const ideas: OpportunityIdea[] = top.map((s, i) => {
    const b = byId.get(idOf.get(s.opportunity) as string) as Built;
    const missing = scoringFactors.filter((f) => b.breakdown[f].missingEvidence);
    return {
      rank: i + 1,
      niche: b.candidate.niche,
      whatToSell: b.candidate.whatToSell,
      whoToSellTo: b.candidate.whoToSellTo,
      whyItFits: whyItFits(b, profile),
      blueprint: { id: b.opportunity.blueprintId, version: b.version },
      factors: b.breakdown,
      fitScore: s.score,
      fitScoreLabel: 'fit score',
      confidence: s.confidence,
      missingEvidence: missing,
      estimatedStartupCostMinor: b.costMinor,
      weeklyHours: b.candidate.ongoingHoursPerWeek,
      firstBuyerChannel: b.firstBuyerChannel,
      ownerWork: b.ownerWork,
      notice: FIT_NOTICE,
    };
  });

  excluded.sort((a, b) => a.niche.localeCompare(b.niche));
  const result: FinderResult = { mode, requested: 5, ideas, rubricVersion, generatedAt: at };
  if (ideas.length < 5) {
    const why = excluded.length
      ? `Only ${ideas.length} of 5 ideas qualified. ${excluded.length} candidate${excluded.length === 1 ? ' was' : 's were'} left out (budget, hours or missing demand evidence). See the list of left-out ideas for each reason.`
      : `Only ${ideas.length} of 5 ideas qualified: there are not enough candidates.`;
    result.shortfall = { returned: ideas.length, reason: why, excluded };
  }
  return result;
}

function build(c: Candidate, profile: FinderProfile, mode: FinderMode, at: string, registry: BlueprintRegistry, deps: FinderDeps, excluded: ExcludedCandidate[]): Built | null {
  const bp = registry.find(c.blueprintId);
  if (!bp) { excluded.push({ niche: c.niche, reason: `Blueprint ${c.blueprintId} not found` }); return null; }
  const costMinor = bp.costDefaults.lines.reduce((n, l) => n + l.amountMinor, 0);
  if (costMinor > profile.budgetMinor) {
    excluded.push({ niche: c.niche, reason: `Needs about ${aud(costMinor)} to start, over the ${aud(profile.budgetMinor)} budget` });
    return null;
  }
  const signals: Partial<Record<SignalKey, Signal & { url?: string }>> = mode === 'fixture' ? c.signals : (deps.liveSignals?.(c) ?? {});
  const hoursKnown = signals.workload !== undefined;
  if (hoursKnown && c.ongoingHoursPerWeek > profile.weeklyHours) {
    excluded.push({ niche: c.niche, reason: `Needs about ${c.ongoingHoursPerWeek} hours a week, over the ${profile.weeklyHours} available` });
    return null;
  }

  const breakdown = {} as Record<ScoringFactor, FactorBreakdown>;
  const fromSignal = (f: ScoringFactor, key: SignalKey, score?: number) => {
    const sig = signals[key];
    if (!sig) return missing(f);
    const ev = evidenceFrom(mode, at, sig.source, sig.url, sig.note, sig.confidence);
    return { factor: f, score: clamp10(score ?? sig.score), weight: weights[f], confidence: sig.confidence, evidence: [ev], missingEvidence: false } as FactorBreakdown;
  };
  const missing = (f: ScoringFactor): FactorBreakdown => ({
    factor: f, score: PLACEHOLDER, weight: weights[f], confidence: 'low', evidence: [], missingEvidence: true,
    assumption: 'No evidence found. A neutral placeholder of 5 is used so the idea can be compared; it is not a finding.',
  });
  for (const f of scoringFactors) breakdown[f] = missing(f);
  breakdown.demand = fromSignal('demand', 'demand');
  breakdown.automation = fromSignal('automation', 'automation');
  breakdown.differentiation = fromSignal('differentiation', 'differentiation');
  breakdown.repeatPurchases = fromSignal('repeatPurchases', 'repeatPurchases');
  const allowed = profile.weeklyHours * EFFORT_SHARE[profile.preferredEffort];
  breakdown.lowOngoingWorkload = fromSignal('lowOngoingWorkload', 'workload', hoursKnown ? 10 * (1 - c.ongoingHoursPerWeek / allowed) : undefined);
  if (hoursKnown) breakdown.lowOngoingWorkload.assumption = `Score compares about ${c.ongoingHoursPerWeek} hours a week with ${allowed.toFixed(1)} hours at ${profile.preferredEffort} effort.`;
  // Startup cost comes from the versioned blueprint cost lines, which are real defaults rather than market findings.
  breakdown.lowStartupCost = {
    factor: 'lowStartupCost', weight: weights.lowStartupCost, confidence: mode === 'fixture' ? FIXTURE_CONFIDENCE_CAP : 'medium', missingEvidence: false,
    score: clamp10(profile.budgetMinor === 0 ? 10 : 10 * (1 - costMinor / profile.budgetMinor)),
    evidence: [evidenceFrom(mode, at, `Blueprint ${bp.id}@${bp.version} cost defaults`, `internal:blueprint/${bp.id}@${bp.version}`, `Setup costs add up to ${aud(costMinor)} (design, images and an optional promotion).`, 'medium', true)],
  };

  const factors = {} as Record<ScoringFactor, OpportunityFactor>;
  for (const f of scoringFactors) {
    const b = breakdown[f];
    factors[f] = { score: b.score, confidence: b.confidence, evidence: b.evidence.map((e) => ({ source: e.source, url: e.url, note: e.note, retrievedAt: e.retrievedAt })), ...(b.assumption ? { assumption: b.assumption } : {}) };
  }
  const major = Number.parseInt(bp.version.split('.')[0] ?? '1', 10);
  const opportunity: Opportunity = {
    blueprintId: bp.id, blueprintVersion: major, niche: c.niche, model: bp.businessModel, factors,
    estimatedStartupCostMinor: costMinor, estimatedMonthlyCostMinor: 0, weeklyHours: c.ongoingHoursPerWeek,
    channels: [...bp.marketing.channels], uncertainty: scoringFactors.filter((f) => breakdown[f].missingEvidence).map((f) => `No evidence for ${f}`),
  };
  const ownerWork = bp.steps.filter((st) => st.ownerAction.trim()).map((st) => ({ action: st.ownerAction, hours: st.hours }));
  return { candidate: c, opportunity, breakdown, costMinor, version: bp.version, hoursKnown, firstBuyerChannel: bp.marketing.channels[0] ?? 'Email', ownerWork };
}

function whyItFits(b: Built, profile: FinderProfile): string[] {
  const out: string[] = [];
  const tags = new Set(b.candidate.tags);
  const hitI = [...words(profile.interests)].filter((w) => tags.has(w));
  const hitS = [...words(profile.skills)].filter((w) => tags.has(w));
  if (hitI.length) out.push(`Matches your interest in ${hitI.join(', ')}.`);
  if (hitS.length) out.push(`Your ${hitS.join(', ')} skills are useful here.`);
  if (!hitI.length && !hitS.length) out.push('No direct match with your interests or skills; it is included because it suits your budget and hours.');
  out.push(`Setup is about ${aud(b.costMinor)} of your ${aud(profile.budgetMinor)} budget.`);
  out.push(b.hoursKnown
    ? `Upkeep is about ${b.candidate.ongoingHoursPerWeek} hours a week against your ${profile.weeklyHours}, at ${profile.preferredEffort} effort.`
    : 'Weekly upkeep is not yet backed by evidence.');
  return out;
}
