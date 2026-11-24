import type { Profile } from './onboarding.ts';

export const marketEvidenceSourceLimit = 10;
export const marketEvidenceTitleLimit = 200;
export const marketEvidenceObservationLimit = 2000;
export const marketEvidenceRelevanceLimit = 1500;
export const marketEvidenceHypothesisLimit = 3000;
export const marketEvidenceQuestionsLimit = 3000;
export const marketEvidenceUrlLimit = 2048;
export const marketEvidenceStorageByteLimit = 128000;
export const marketEvidenceRevisionCap = 9999;

export const marketEvidenceVerificationStatuses = [
  { value: 'needs-verification' as const, label: 'Needs verification' },
  { value: 'reviewed-by-creator' as const, label: 'Reviewed by creator' },
] as const;

export type MarketEvidenceVerificationStatus =
  (typeof marketEvidenceVerificationStatuses)[number]['value'];

export type MarketEvidenceSourceInput = {
  id: string;
  title: string;
  sourceUrl: string;
  observation: string;
  sourceDate: string;
  sourceDateUnknown: boolean;
  relevance: string;
  verificationStatus: MarketEvidenceVerificationStatus;
};

export type MarketEvidenceNotebookInput = {
  marketHypothesis: string;
  unansweredQuestions: string;
  sources: MarketEvidenceSourceInput[];
};

export type MarketEvidenceSource = {
  id: string;
  title: string;
  sourceUrl?: string;
  observation: string;
  sourceDate: string | 'unknown';
  relevance: string;
  verificationStatus: MarketEvidenceVerificationStatus;
};

export type MarketEvidenceNotebook = {
  version: 1;
  profileId: string;
  revision: number;
  updatedAt: string;
  marketHypothesis: string;
  unansweredQuestions: string;
  sources: MarketEvidenceSource[];
};

export type MarketEvidenceCreatorStatementProjection = {
  sourceTitle: string;
  observation: string;
  verificationLabel: string;
};

export type MarketEvidenceExternalLinkProjection = {
  sourceTitle: string;
  url: string;
};

export type MarketEvidenceSummaryProjection = {
  disclaimer: string;
  sourceCount: number;
  creatorStatements: MarketEvidenceCreatorStatementProjection[];
  externalLinks: MarketEvidenceExternalLinkProjection[];
  unverifiedSourceTitles: string[];
  reviewedSourceCount: number;
  marketHypothesis: string | null;
  unansweredQuestions: string | null;
};

export const marketEvidenceStorageKey = (profileId: string) =>
  `launchpad.market-evidence-notebook.v1.${profileId}`;

const isoTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const verificationValues = new Set(marketEvidenceVerificationStatuses.map(s => s.value));

const text = (value: unknown, label: string, limit: number) => {
  if (typeof value !== 'string' || value.length > limit || !value.trim()) {
    throw new Error(`${label} is required and must be ${limit} characters or fewer.`);
  }
  return value.trim();
};

const plainTextField = (value: unknown, label: string, limit: number) => {
  if (typeof value !== 'string' || value.length > limit) {
    throw new Error(`${label} must be ${limit} characters or fewer.`);
  }
  return value.trim();
};

function parseUpdatedAt(value: unknown): string {
  if (typeof value !== 'string' || !isoTimestampPattern.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error('Invalid saved market evidence notebook. Nothing was overwritten.');
  }
  return value;
}

function parseRevision(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > marketEvidenceRevisionCap) {
    throw new Error('Invalid saved market evidence notebook. Nothing was overwritten.');
  }
  return value as number;
}

export function isAllowedMarketEvidenceUrl(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return true;
  if (trimmed.length > marketEvidenceUrlLimit) return false;
  try {
    const u = new URL(trimmed);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function parseOptionalHttpUrl(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > marketEvidenceUrlLimit) {
    throw new Error(`${label} must be ${marketEvidenceUrlLimit} characters or fewer when provided.`);
  }
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!isAllowedMarketEvidenceUrl(trimmed)) {
    throw new Error('Source URL must be a full http:// or https:// address, or left blank.');
  }
  return trimmed;
}

function parseVerificationStatus(value: unknown): MarketEvidenceVerificationStatus {
  if (typeof value !== 'string' || !verificationValues.has(value as MarketEvidenceVerificationStatus)) {
    throw new Error('Choose whether the source needs verification or was reviewed by you.');
  }
  return value as MarketEvidenceVerificationStatus;
}

function parseSourceDate(
  dateRaw: unknown,
  unknownFlag: unknown,
  label: string,
): string | 'unknown' {
  if (unknownFlag === true) return 'unknown';
  if (typeof dateRaw !== 'string') return 'unknown';
  const trimmed = dateRaw.trim();
  if (!trimmed) return 'unknown';
  if (!isoDatePattern.test(trimmed) || Number.isNaN(Date.parse(`${trimmed}T12:00:00Z`))) {
    throw new Error(`${label} must be YYYY-MM-DD or marked as unknown.`);
  }
  return trimmed;
}

export function labelForVerificationStatus(value: MarketEvidenceVerificationStatus): string {
  return marketEvidenceVerificationStatuses.find(s => s.value === value)?.label ?? value;
}

export function blankMarketEvidenceSourceInput(): MarketEvidenceSourceInput {
  return {
    id: '',
    title: '',
    sourceUrl: '',
    observation: '',
    sourceDate: '',
    sourceDateUnknown: true,
    relevance: '',
    verificationStatus: 'needs-verification',
  };
}

export function blankMarketEvidenceNotebookInput(): MarketEvidenceNotebookInput {
  return {
    marketHypothesis: '',
    unansweredQuestions: '',
    sources: [],
  };
}

export function editMarketEvidenceNotebook(notebook: MarketEvidenceNotebook): MarketEvidenceNotebookInput {
  return {
    marketHypothesis: notebook.marketHypothesis,
    unansweredQuestions: notebook.unansweredQuestions,
    sources: notebook.sources.map(source => ({
      id: source.id,
      title: source.title,
      sourceUrl: source.sourceUrl ?? '',
      observation: source.observation,
      sourceDate: source.sourceDate === 'unknown' ? '' : source.sourceDate,
      sourceDateUnknown: source.sourceDate === 'unknown',
      relevance: source.relevance,
      verificationStatus: source.verificationStatus,
    })),
  };
}

function normalizeSources(sources: readonly MarketEvidenceSourceInput[]): MarketEvidenceSource[] {
  if (!Array.isArray(sources) || sources.length > marketEvidenceSourceLimit) {
    throw new Error(`Add up to ${marketEvidenceSourceLimit} evidence sources.`);
  }
  const ids = new Set<string>();
  const normalized: MarketEvidenceSource[] = [];
  for (const [index, source] of sources.entries()) {
    const titleRaw = typeof source.title === 'string' ? source.title.trim() : '';
    const observationRaw = typeof source.observation === 'string' ? source.observation : '';
    const relevanceRaw = typeof source.relevance === 'string' ? source.relevance : '';
    const urlRaw = typeof source.sourceUrl === 'string' ? source.sourceUrl : '';
    const hasAny =
      titleRaw ||
      observationRaw.trim() ||
      relevanceRaw.trim() ||
      urlRaw.trim() ||
      (typeof source.sourceDate === 'string' && source.sourceDate.trim() && !source.sourceDateUnknown);
    if (!hasAny) continue;
    if (!titleRaw) {
      throw new Error(`Source ${index + 1} needs a title when other fields are filled.`);
    }
    if (!observationRaw.trim()) {
      throw new Error(`Source ${index + 1} needs your observation in your own words.`);
    }
    const id = text(source.id, `Source ${index + 1} ID`, 160);
    if (ids.has(id)) throw new Error('Each source needs a unique ID.');
    ids.add(id);
    const sourceUrl = parseOptionalHttpUrl(source.sourceUrl, `Source ${index + 1} URL`);
    normalized.push({
      id,
      title: text(titleRaw, `Source ${index + 1} title`, marketEvidenceTitleLimit),
      observation: text(observationRaw, `Source ${index + 1} observation`, marketEvidenceObservationLimit),
      relevance: text(relevanceRaw, `Source ${index + 1} relevance`, marketEvidenceRelevanceLimit),
      sourceDate: parseSourceDate(source.sourceDate, source.sourceDateUnknown, `Source ${index + 1} date`),
      verificationStatus: parseVerificationStatus(source.verificationStatus),
      ...(sourceUrl ? { sourceUrl } : {}),
    });
  }
  return normalized;
}

function assertNotebookHasContent(
  hypothesis: string,
  questions: string,
  sources: MarketEvidenceSource[],
) {
  if (sources.length || hypothesis || questions) return;
  throw new Error(
    'Add at least one evidence source, a market hypothesis, or unanswered questions before saving.',
  );
}

function buildNotebook(
  input: MarketEvidenceNotebookInput,
  profileId: string,
  revision: number,
  updatedAt: string,
): MarketEvidenceNotebook {
  const marketHypothesis = plainTextField(
    input.marketHypothesis,
    'Market hypothesis',
    marketEvidenceHypothesisLimit,
  );
  const unansweredQuestions = plainTextField(
    input.unansweredQuestions,
    'Unanswered questions',
    marketEvidenceQuestionsLimit,
  );
  const sources = normalizeSources(input.sources);
  assertNotebookHasContent(marketHypothesis, unansweredQuestions, sources);
  return {
    version: 1,
    profileId: text(profileId, 'Profile ID', 160),
    revision,
    updatedAt: parseUpdatedAt(updatedAt),
    marketHypothesis,
    unansweredQuestions,
    sources,
  };
}

export function saveMarketEvidenceNotebook(
  input: MarketEvidenceNotebookInput,
  profileId: string,
  prior: MarketEvidenceNotebook | null,
): MarketEvidenceNotebook {
  const revision = prior ? Math.min(prior.revision + 1, marketEvidenceRevisionCap) : 1;
  return buildNotebook(input, profileId, revision, new Date().toISOString());
}

export function marketEvidenceNotebookFromInput(
  input: MarketEvidenceNotebookInput,
  profileId: string,
  prior: MarketEvidenceNotebook | null,
): MarketEvidenceNotebook {
  const revision = prior?.revision ?? 1;
  return buildNotebook(input, profileId, revision, new Date().toISOString());
}

export function restoreMarketEvidenceNotebook(raw: string | null, profileId: string): MarketEvidenceNotebook | null {
  if (raw === null) return null;
  if (raw.length > marketEvidenceStorageByteLimit) {
    throw new Error('Saved market evidence notebook is too large. Nothing was overwritten.');
  }
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid saved market evidence notebook. Nothing was overwritten.');
  }
  const record = value as MarketEvidenceNotebook;
  if (record.version !== 1 || record.profileId !== profileId) {
    throw new Error('Invalid or mismatched market evidence notebook. Nothing was overwritten.');
  }
  const revision = parseRevision(record.revision);
  return buildNotebook(editMarketEvidenceNotebook(record), profileId, revision, parseUpdatedAt(record.updatedAt));
}

export function persistMarketEvidenceNotebook(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  profileId: string,
  expectedRaw: string | null,
  notebook: MarketEvidenceNotebook,
): string {
  const key = marketEvidenceStorageKey(profileId);
  if (storage.getItem(key) !== expectedRaw) {
    throw new Error(
      'Market evidence notebook changed in another tab. Your unsaved changes remain; copy them before reloading the saved notebook.',
    );
  }
  const checked = restoreMarketEvidenceNotebook(JSON.stringify(notebook), profileId);
  if (!checked) throw new Error('Invalid market evidence notebook.');
  const raw = JSON.stringify(checked);
  if (raw.length > marketEvidenceStorageByteLimit) {
    throw new Error('Market evidence storage limit reached. Your unsaved changes remain.');
  }
  storage.setItem(key, raw);
  return raw;
}

export function marketEvidenceNotebookAllowlistKeys(): readonly (keyof MarketEvidenceNotebook)[] {
  return [
    'version',
    'profileId',
    'revision',
    'updatedAt',
    'marketHypothesis',
    'unansweredQuestions',
    'sources',
  ];
}

export function marketEvidenceSummaryAllowlistKeys(): readonly (keyof MarketEvidenceSummaryProjection)[] {
  return [
    'disclaimer',
    'sourceCount',
    'creatorStatements',
    'externalLinks',
    'unverifiedSourceTitles',
    'reviewedSourceCount',
    'marketHypothesis',
    'unansweredQuestions',
  ];
}

export function marketEvidenceCreatorStatementAllowlistKeys(): readonly (keyof MarketEvidenceCreatorStatementProjection)[] {
  return ['sourceTitle', 'observation', 'verificationLabel'];
}

export function marketEvidenceExternalLinkAllowlistKeys(): readonly (keyof MarketEvidenceExternalLinkProjection)[] {
  return ['sourceTitle', 'url'];
}

export function suggestHypothesisSeedFromProfile(
  profile: Pick<Profile, 'audience' | 'goal' | 'name'>,
): string | null {
  const audience = profile.audience.trim();
  const goal = profile.goal.trim();
  if (!audience && !goal) return null;
  const parts: string[] = [];
  if (audience) parts.push(audience);
  if (goal) parts.push(`may care about: ${goal}`);
  const seed = parts.join(' — ');
  if (seed.length > marketEvidenceHypothesisLimit) return null;
  return seed;
}

export function buildMarketEvidenceSummary(notebook: MarketEvidenceNotebook): MarketEvidenceSummaryProjection {
  const disclaimer =
    'Manual notes only — creator-written observations and optional links. This does not verify sources, estimate market size, confirm demand, or validate competitors.';
  const creatorStatements: MarketEvidenceCreatorStatementProjection[] = notebook.sources.map(source => ({
    sourceTitle: source.title,
    observation: source.observation,
    verificationLabel: labelForVerificationStatus(source.verificationStatus),
  }));
  const externalLinks: MarketEvidenceExternalLinkProjection[] = notebook.sources
    .filter(source => source.sourceUrl)
    .map(source => ({ sourceTitle: source.title, url: source.sourceUrl! }));
  const unverifiedSourceTitles = notebook.sources
    .filter(source => source.verificationStatus === 'needs-verification')
    .map(source => source.title);
  const reviewedSourceCount = notebook.sources.filter(
    source => source.verificationStatus === 'reviewed-by-creator',
  ).length;

  return {
    disclaimer,
    sourceCount: notebook.sources.length,
    creatorStatements,
    externalLinks,
    unverifiedSourceTitles,
    reviewedSourceCount,
    marketHypothesis: notebook.marketHypothesis ? notebook.marketHypothesis : null,
    unansweredQuestions: notebook.unansweredQuestions ? notebook.unansweredQuestions : null,
  };
}

export function projectMarketEvidenceSummary(notebook: MarketEvidenceNotebook): MarketEvidenceSummaryProjection {
  return buildMarketEvidenceSummary(notebook);
}
