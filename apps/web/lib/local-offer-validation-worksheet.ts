import type { Profile } from './onboarding.ts';
import type { LocalOffer } from './local-offers.ts';
import { formatOfferPrice } from './local-offers.ts';
import type { MarketEvidenceNotebook } from './local-market-evidence.ts';

export const offerValidationExperimentLimit = 3;
export const offerValidationHypothesisLimit = 3000;
export const offerValidationMethodLimit = 1500;
export const offerValidationCriterionLimit = 1500;
export const offerValidationResultLimit = 3000;
export const offerValidationStorageByteLimit = 128000;
export const offerValidationRevisionCap = 9999;

export const offerValidationDecisions = [
  { value: 'undecided' as const, label: 'Undecided' },
  { value: 'revise' as const, label: 'Revise the offer' },
  { value: 'proceed-to-planning' as const, label: 'Proceed to planning' },
  { value: 'pause' as const, label: 'Pause validation' },
] as const;

export type OfferValidationDecision = (typeof offerValidationDecisions)[number]['value'];

export type OfferValidationOfferSnapshot = {
  offerId: string;
  name: string;
  audience: string;
  outcome: string;
  delivery: string;
  kind: LocalOffer['kind'];
  currency: LocalOffer['currency'];
  amountMinor: number;
  capturedAt: string;
};

export type OfferValidationExperimentInput = {
  id: string;
  method: string;
  successCriterion: string;
  resultNotes: string;
  marketEvidenceSourceId: string;
};

export type OfferValidationWorksheetInput = {
  offerId: string;
  hypothesis: string;
  experiments: OfferValidationExperimentInput[];
  decision: OfferValidationDecision;
};

export type OfferValidationExperiment = {
  id: string;
  method: string;
  successCriterion: string;
  resultNotes?: string;
  marketEvidenceSourceId?: string;
};

export type OfferValidationWorksheet = {
  version: 1;
  profileId: string;
  revision: number;
  updatedAt: string;
  offerId: string;
  offerSnapshot: OfferValidationOfferSnapshot;
  hypothesis: string;
  experiments: OfferValidationExperiment[];
  decision: OfferValidationDecision;
};

export type OfferValidationLinkageWarning = {
  code: 'offer-missing' | 'offer-drift' | 'source-missing';
  message: string;
  experimentId?: string;
  sourceId?: string;
};

export type OfferValidationSummaryProjection = {
  disclaimer: string;
  decisionLabel: string;
  hypothesis: string;
  offerLabel: string;
  experimentSummaries: string[];
  linkageWarnings: string[];
};

export const offerValidationStorageKey = (profileId: string) =>
  `launchpad.offer-validation-worksheet.v1.${profileId}`;

const isoTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const decisionValues = new Set(offerValidationDecisions.map(d => d.value));
const deliveryKinds = new Set(['service', 'education', 'product']);
const currencies = new Set(['AUD', 'USD', 'GBP', 'EUR', 'NZD', 'CAD']);

const text = (value: unknown, label: string, limit: number) => {
  if (typeof value !== 'string' || value.length > limit || !value.trim()) {
    throw new Error(`${label} is required and must be ${limit} characters or fewer.`);
  }
  return value.trim();
};

const optionalPlainText = (value: unknown, label: string, limit: number) => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > limit) {
    throw new Error(`${label} must be ${limit} characters or fewer when provided.`);
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

const optionalId = (value: unknown, label: string) => {
  if (value === undefined || value === null || value === '') return undefined;
  return text(value, label, 160);
};

function parseUpdatedAt(value: unknown): string {
  if (typeof value !== 'string' || !isoTimestampPattern.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error('Invalid saved offer validation worksheet. Nothing was overwritten.');
  }
  return value;
}

function parseRevision(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > offerValidationRevisionCap) {
    throw new Error('Invalid saved offer validation worksheet. Nothing was overwritten.');
  }
  return value as number;
}

function parseDecision(value: unknown): OfferValidationDecision {
  if (typeof value !== 'string' || !decisionValues.has(value as OfferValidationDecision)) {
    throw new Error('Choose your creator decision: undecided, revise, proceed to planning, or pause.');
  }
  return value as OfferValidationDecision;
}

export function labelForOfferValidationDecision(value: OfferValidationDecision): string {
  return offerValidationDecisions.find(d => d.value === value)?.label ?? value;
}

export function snapshotFromLocalOffer(offer: LocalOffer, capturedAt: string): OfferValidationOfferSnapshot {
  if (!isoTimestampPattern.test(capturedAt) || Number.isNaN(Date.parse(capturedAt))) {
    throw new Error('Invalid snapshot timestamp.');
  }
  return {
    offerId: offer.id,
    name: offer.name,
    audience: offer.audience,
    outcome: offer.outcome,
    delivery: offer.delivery,
    kind: offer.kind,
    currency: offer.currency,
    amountMinor: offer.amountMinor,
    capturedAt,
  };
}

function parseOfferSnapshot(value: unknown): OfferValidationOfferSnapshot {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid offer snapshot on saved worksheet.');
  }
  const snap = value as OfferValidationOfferSnapshot;
  if (typeof snap.offerId !== 'string' || !snap.offerId.trim()) {
    throw new Error('Invalid offer snapshot on saved worksheet.');
  }
  if (!deliveryKinds.has(snap.kind) || !currencies.has(snap.currency)) {
    throw new Error('Invalid offer snapshot on saved worksheet.');
  }
  if (!Number.isSafeInteger(snap.amountMinor) || snap.amountMinor < 0) {
    throw new Error('Invalid offer snapshot on saved worksheet.');
  }
  parseUpdatedAt(snap.capturedAt);
  return {
    offerId: snap.offerId.trim(),
    name: text(snap.name, 'Snapshot offer name', 160),
    audience: text(snap.audience, 'Snapshot audience', 500),
    outcome: text(snap.outcome, 'Snapshot outcome', 3000),
    delivery: text(snap.delivery, 'Snapshot delivery', 3000),
    kind: snap.kind,
    currency: snap.currency,
    amountMinor: snap.amountMinor,
    capturedAt: snap.capturedAt,
  };
}

export function offerSnapshotsMatch(a: OfferValidationOfferSnapshot, b: OfferValidationOfferSnapshot): boolean {
  return (
    a.offerId === b.offerId &&
    a.name === b.name &&
    a.audience === b.audience &&
    a.outcome === b.outcome &&
    a.delivery === b.delivery &&
    a.kind === b.kind &&
    a.currency === b.currency &&
    a.amountMinor === b.amountMinor
  );
}

export function formatOfferSnapshotLabel(snapshot: OfferValidationOfferSnapshot): string {
  const kind =
    snapshot.kind === 'education' ? 'Education' : snapshot.kind === 'product' ? 'Product' : 'Service';
  return `${snapshot.name} (${kind}) · ${snapshot.currency} ${formatOfferPrice(snapshot.amountMinor)}`;
}

function normalizeExperiments(experiments: readonly OfferValidationExperimentInput[]): OfferValidationExperiment[] {
  if (!Array.isArray(experiments) || experiments.length < 1 || experiments.length > offerValidationExperimentLimit) {
    throw new Error(`Add between 1 and ${offerValidationExperimentLimit} validation experiments.`);
  }
  const ids = new Set<string>();
  const normalized: OfferValidationExperiment[] = [];
  for (const [index, experiment] of experiments.entries()) {
    const methodRaw = typeof experiment.method === 'string' ? experiment.method : '';
    const criterionRaw = typeof experiment.successCriterion === 'string' ? experiment.successCriterion : '';
    const resultRaw = typeof experiment.resultNotes === 'string' ? experiment.resultNotes : '';
    const hasAny = methodRaw.trim() || criterionRaw.trim() || resultRaw.trim() || experiment.marketEvidenceSourceId;
    if (!hasAny) continue;
    const method = text(methodRaw, `Experiment ${index + 1} method`, offerValidationMethodLimit);
    if (resultRaw.trim() && !criterionRaw.trim()) {
      throw new Error(
        `Experiment ${index + 1}: write the success criterion before recording results — criteria must be set ahead of observations.`,
      );
    }
    const successCriterion = text(
      criterionRaw,
      `Experiment ${index + 1} success criterion (set before results)`,
      offerValidationCriterionLimit,
    );
    const id = text(experiment.id, `Experiment ${index + 1} ID`, 160);
    if (ids.has(id)) throw new Error('Each experiment needs a unique ID.');
    ids.add(id);
    const resultNotes = optionalPlainText(resultRaw, `Experiment ${index + 1} results`, offerValidationResultLimit);
    const marketEvidenceSourceId = optionalId(
      experiment.marketEvidenceSourceId,
      `Experiment ${index + 1} evidence source ID`,
    );
    normalized.push({
      id,
      method,
      successCriterion,
      ...(resultNotes ? { resultNotes } : {}),
      ...(marketEvidenceSourceId ? { marketEvidenceSourceId } : {}),
    });
  }
  if (!normalized.length) {
    throw new Error(`Add between 1 and ${offerValidationExperimentLimit} validation experiments.`);
  }
  return normalized;
}

function buildWorksheet(
  input: OfferValidationWorksheetInput,
  profileId: string,
  offerSnapshot: OfferValidationOfferSnapshot,
  revision: number,
  updatedAt: string,
): OfferValidationWorksheet {
  const offerId = text(input.offerId, 'Offer selection', 160);
  if (offerId !== offerSnapshot.offerId) {
    throw new Error('Selected offer does not match the captured snapshot.');
  }
  const hypothesis = text(input.hypothesis, 'Testable hypothesis', offerValidationHypothesisLimit);
  const experiments = normalizeExperiments(input.experiments);
  const decision = parseDecision(input.decision);
  return {
    version: 1,
    profileId: text(profileId, 'Profile ID', 160),
    revision,
    updatedAt: parseUpdatedAt(updatedAt),
    offerId,
    offerSnapshot,
    hypothesis,
    experiments,
    decision,
  };
}

export function blankOfferValidationExperimentInput(): OfferValidationExperimentInput {
  return {
    id: '',
    method: '',
    successCriterion: '',
    resultNotes: '',
    marketEvidenceSourceId: '',
  };
}

export function blankOfferValidationWorksheetInput(offerId = ''): OfferValidationWorksheetInput {
  return {
    offerId,
    hypothesis: '',
    experiments: [],
    decision: 'undecided',
  };
}

export function editOfferValidationWorksheet(worksheet: OfferValidationWorksheet): OfferValidationWorksheetInput {
  return {
    offerId: worksheet.offerId,
    hypothesis: worksheet.hypothesis,
    decision: worksheet.decision,
    experiments: worksheet.experiments.map(experiment => ({
      id: experiment.id,
      method: experiment.method,
      successCriterion: experiment.successCriterion,
      resultNotes: experiment.resultNotes ?? '',
      marketEvidenceSourceId: experiment.marketEvidenceSourceId ?? '',
    })),
  };
}

export function saveOfferValidationWorksheet(
  input: OfferValidationWorksheetInput,
  profileId: string,
  offerSnapshot: OfferValidationOfferSnapshot,
  prior: OfferValidationWorksheet | null,
): OfferValidationWorksheet {
  const revision = prior ? Math.min(prior.revision + 1, offerValidationRevisionCap) : 1;
  return buildWorksheet(input, profileId, offerSnapshot, revision, new Date().toISOString());
}

export function offerValidationWorksheetFromInput(
  input: OfferValidationWorksheetInput,
  profileId: string,
  offerSnapshot: OfferValidationOfferSnapshot,
  prior: OfferValidationWorksheet | null,
): OfferValidationWorksheet {
  const revision = prior?.revision ?? 1;
  return buildWorksheet(input, profileId, offerSnapshot, revision, new Date().toISOString());
}

export function restoreOfferValidationWorksheet(raw: string | null, profileId: string): OfferValidationWorksheet | null {
  if (raw === null) return null;
  if (raw.length > offerValidationStorageByteLimit) {
    throw new Error('Saved offer validation worksheet is too large. Nothing was overwritten.');
  }
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid saved offer validation worksheet. Nothing was overwritten.');
  }
  const record = value as OfferValidationWorksheet;
  if (record.version !== 1 || record.profileId !== profileId) {
    throw new Error('Invalid or mismatched offer validation worksheet. Nothing was overwritten.');
  }
  const revision = parseRevision(record.revision);
  const snapshot = parseOfferSnapshot(record.offerSnapshot);
  const input = editOfferValidationWorksheet({ ...record, offerSnapshot: snapshot });
  return buildWorksheet(input, profileId, snapshot, revision, parseUpdatedAt(record.updatedAt));
}

export function persistOfferValidationWorksheet(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  profileId: string,
  expectedRaw: string | null,
  worksheet: OfferValidationWorksheet,
): string {
  const key = offerValidationStorageKey(profileId);
  if (storage.getItem(key) !== expectedRaw) {
    throw new Error(
      'Offer validation worksheet changed in another tab. Your unsaved changes remain; copy them before reloading the saved worksheet.',
    );
  }
  const checked = restoreOfferValidationWorksheet(JSON.stringify(worksheet), profileId);
  if (!checked) throw new Error('Invalid offer validation worksheet.');
  const raw = JSON.stringify(checked);
  if (raw.length > offerValidationStorageByteLimit) {
    throw new Error('Offer validation storage limit reached. Your unsaved changes remain.');
  }
  storage.setItem(key, raw);
  return raw;
}

export function offerValidationWorksheetAllowlistKeys(): readonly (keyof OfferValidationWorksheet)[] {
  return [
    'version',
    'profileId',
    'revision',
    'updatedAt',
    'offerId',
    'offerSnapshot',
    'hypothesis',
    'experiments',
    'decision',
  ];
}

export function offerValidationSummaryAllowlistKeys(): readonly (keyof OfferValidationSummaryProjection)[] {
  return ['disclaimer', 'decisionLabel', 'hypothesis', 'offerLabel', 'experimentSummaries', 'linkageWarnings'];
}

export function analyzeOfferValidationLinkage(
  worksheet: OfferValidationWorksheet,
  offers: readonly LocalOffer[],
  notebook: MarketEvidenceNotebook | null,
): OfferValidationLinkageWarning[] {
  const warnings: OfferValidationLinkageWarning[] = [];
  const current = offers.find(offer => offer.id === worksheet.offerId);
  if (!current) {
    warnings.push({
      code: 'offer-missing',
      message: 'The linked offer is no longer in your local offer library. The snapshot below is from when you saved this worksheet.',
    });
  } else if (!offerSnapshotsMatch(worksheet.offerSnapshot, snapshotFromLocalOffer(current, worksheet.offerSnapshot.capturedAt))) {
    warnings.push({
      code: 'offer-drift',
      message:
        'The saved offer in your library differs from the snapshot captured on this worksheet. Review drift before trusting the linkage.',
    });
  }
  const sourceIds = new Set(notebook?.sources.map(source => source.id) ?? []);
  for (const experiment of worksheet.experiments) {
    if (!experiment.marketEvidenceSourceId) continue;
    if (!sourceIds.has(experiment.marketEvidenceSourceId)) {
      warnings.push({
        code: 'source-missing',
        message: `Experiment references market evidence source ID “${experiment.marketEvidenceSourceId}” which is not in your saved notebook.`,
        experimentId: experiment.id,
        sourceId: experiment.marketEvidenceSourceId,
      });
    }
  }
  return warnings;
}

export function buildOfferValidationSummary(
  worksheet: OfferValidationWorksheet,
  linkageWarnings: readonly OfferValidationLinkageWarning[],
): OfferValidationSummaryProjection {
  const disclaimer =
    'Manual validation worksheet — creator decision, not verified demand. Experiments and notes are self-reported; no automatic scoring or revenue claims.';
  const experimentSummaries = worksheet.experiments.map((experiment, index) => {
    const parts = [
      `Experiment ${index + 1}: ${experiment.method}`,
      `Criterion (pre-result): ${experiment.successCriterion}`,
    ];
    if (experiment.resultNotes) parts.push(`Observation: ${experiment.resultNotes}`);
    if (experiment.marketEvidenceSourceId) {
      parts.push(`Evidence source ID: ${experiment.marketEvidenceSourceId}`);
    }
    return parts.join(' · ');
  });
  return {
    disclaimer,
    decisionLabel: labelForOfferValidationDecision(worksheet.decision),
    hypothesis: worksheet.hypothesis,
    offerLabel: formatOfferSnapshotLabel(worksheet.offerSnapshot),
    experimentSummaries,
    linkageWarnings: linkageWarnings.map(w => w.message),
  };
}

export function projectOfferValidationSummary(
  worksheet: OfferValidationWorksheet,
  offers: readonly LocalOffer[],
  notebook: MarketEvidenceNotebook | null,
): OfferValidationSummaryProjection {
  return buildOfferValidationSummary(worksheet, analyzeOfferValidationLinkage(worksheet, offers, notebook));
}

export function suggestHypothesisFromOffer(offer: LocalOffer): string | null {
  const seed = `People like ${offer.audience.trim()} might respond if we test: ${offer.outcome.trim().slice(0, 120)}`;
  if (seed.length > offerValidationHypothesisLimit) return null;
  if (!offer.audience.trim() || !offer.outcome.trim()) return null;
  return seed;
}
