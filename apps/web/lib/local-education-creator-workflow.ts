import type { Profile } from './onboarding.ts';
import type { OfferCurrency } from './local-offers.ts';
import { offerCurrencies, offerPriceMinor } from './local-offers.ts';
import type { EducationCourseDraft, EducationCourseDraftInput } from './local-education-course.ts';
import {
  blankEducationLessonInput,
  editEducationCourseDraft,
  educationCourseLessonLimit,
  educationCourseStorageKey,
  persistEducationCourseDraft,
  restoreEducationCourseDraft,
  saveEducationCourseDraft,
  mergeImportedLessonsPreservingQuizzes,
} from './local-education-course.ts';

export const creatorWorkflowGeneratorVersion = 'manual-template-v1';
export const educationCreatorWorkflowStorageKey = (profileId: string) =>
  `launchpad.education-creator-workflow.v1.${profileId}`;

export type CreatorWorkflowPhase =
  | 'interview_draft'
  | 'offer_draft'
  | 'awaiting_offer_approval'
  | 'offer_approved'
  | 'curriculum_draft'
  | 'curriculum_reviewed';

export type CreatorInterviewInput = {
  expertiseSummary: string;
  evidenceExample: string;
  outsideCompetence: string;
  learnerProfile: string;
  prerequisites: string;
  learnerProblem: string;
  priorKnowledge: string;
  observableOutcome: string;
  proofArtifact: string;
  deliveryFormat: string;
  learnerTime: string;
  creatorSupport: string;
  accessibilityNeeds: string;
  offerTitle: string;
  offerOutcome: string;
  includedSupport: string;
  excludedSupport: string;
  proposedPrice: string;
  currency: OfferCurrency;
  assumptionsAndUnknowns: string;
};

export type CreatorProposedOffer = {
  name: string;
  audience: string;
  outcome: string;
  delivery: string;
  price: string;
  currency: OfferCurrency;
  assumptionsAndUnknowns: string;
};

export type SuggestedLesson = {
  id: string;
  title: string;
  objective: string;
  content: string;
  practiceTask: string;
  durationMinutes: string;
};

export type CreatorWorkflowRecord = {
  version: 1;
  workflowId: string;
  profileId: string;
  revision: number;
  updatedAt: string;
  phase: CreatorWorkflowPhase;
  interviewRevision: number;
  interview: CreatorInterviewInput;
  proposedOffer: CreatorProposedOffer;
  approvedOfferRevisionHash: string | null;
  approvedAt: string | null;
  suggestedOutline: SuggestedLesson[] | null;
  outlineCommandKey: string | null;
  /** Content revision for import idempotency — changes when the saved outline changes. */
  outlineContentKey: string | null;
  lastApplyCommandKey: string | null;
  lastApplyStatus: 'none' | 'completed' | 'partial' | null;
  lastError: string | null;
};

const isoTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

const text = (value: unknown, label: string, limit: number, optional = false) => {
  if (typeof value !== 'string' || value.length > limit || (!optional && !value.trim())) {
    throw new Error(`${label} is required and must be ${limit} characters or fewer.`);
  }
  return value.trim();
};

const optionalText = (value: unknown, label: string, limit: number) => {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || value.length > limit) {
    throw new Error(`${label} must be ${limit} characters or fewer when provided.`);
  }
  return value.trim();
};

function parseUpdatedAt(value: unknown): string {
  if (typeof value !== 'string' || !isoTimestampPattern.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error('Invalid saved creator workflow. Nothing was overwritten.');
  }
  return value;
}

export function blankCreatorInterview(profile: Profile): CreatorInterviewInput {
  return {
    expertiseSummary: profile.expertise.trim(),
    evidenceExample: '',
    outsideCompetence: '',
    learnerProfile: profile.audience.trim(),
    prerequisites: '',
    learnerProblem: '',
    priorKnowledge: '',
    observableOutcome: profile.goal.trim(),
    proofArtifact: '',
    deliveryFormat: profile.educationOffer.trim(),
    learnerTime: '',
    creatorSupport: '',
    accessibilityNeeds: '',
    offerTitle: profile.expertise.trim() ? `${profile.expertise.trim()} starter` : '',
    offerOutcome: profile.goal.trim(),
    includedSupport: '',
    excludedSupport: '',
    proposedPrice: '',
    currency: 'AUD',
    assumptionsAndUnknowns: 'Self-reported answers only — not market validation or independent verification.',
  };
}

export function proposedOfferFromInterview(interview: CreatorInterviewInput): CreatorProposedOffer {
  const delivery = [
    interview.deliveryFormat.trim(),
    interview.learnerTime.trim() ? `Learner time: ${interview.learnerTime.trim()}` : '',
    interview.creatorSupport.trim() ? `Support: ${interview.creatorSupport.trim()}` : '',
    interview.accessibilityNeeds.trim() ? `Accessibility/materials: ${interview.accessibilityNeeds.trim()}` : '',
    interview.includedSupport.trim() ? `Included: ${interview.includedSupport.trim()}` : '',
    interview.excludedSupport.trim() ? `Not included: ${interview.excludedSupport.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  return {
    name: interview.offerTitle.trim(),
    audience: interview.learnerProfile.trim(),
    outcome: interview.offerOutcome.trim() || interview.observableOutcome.trim(),
    delivery: delivery.slice(0, 3000),
    price: interview.proposedPrice.trim(),
    currency: interview.currency,
    assumptionsAndUnknowns: interview.assumptionsAndUnknowns.trim(),
  };
}

export function creatorInterviewErrors(interview: CreatorInterviewInput): string[] {
  const errors: string[] = [];
  const required: [keyof CreatorInterviewInput, string, number][] = [
    ['expertiseSummary', 'Expertise summary', 2000],
    ['evidenceExample', 'Teaching evidence example', 2000],
    ['outsideCompetence', 'Outside your competence', 1000],
    ['learnerProfile', 'Learner profile', 500],
    ['learnerProblem', 'Learner problem', 2000],
    ['observableOutcome', 'Observable outcome', 2000],
    ['proofArtifact', 'Proof exercise or artifact', 2000],
    ['deliveryFormat', 'Delivery format', 500],
    ['offerTitle', 'Proposed offer title', 160],
    ['offerOutcome', 'Offer outcome', 3000],
  ];
  for (const [key, label, limit] of required) {
    const value = interview[key];
    if (typeof value !== 'string' || !value.trim()) errors.push(`${label} is required.`);
    else if (value.length > limit) errors.push(`${label} is too long.`);
  }
  if (!(offerCurrencies as readonly string[]).includes(interview.currency)) errors.push('Choose a supported currency.');
  try {
    if (interview.proposedPrice.trim()) offerPriceMinor(interview.proposedPrice);
  } catch (error) {
    errors.push((error as Error).message);
  }
  return errors;
}

export function offerProposalRevisionHash(offer: CreatorProposedOffer): string {
  const canonical = JSON.stringify({
    name: offer.name,
    audience: offer.audience,
    outcome: offer.outcome,
    delivery: offer.delivery,
    price: offer.price,
    currency: offer.currency,
    assumptionsAndUnknowns: offer.assumptionsAndUnknowns,
  });
  let hash = 0;
  for (let i = 0; i < canonical.length; i++) hash = (Math.imul(31, hash) + canonical.charCodeAt(i)) | 0;
  return `offer-rev-${(hash >>> 0).toString(16)}`;
}

function normalizeInterview(interview: CreatorInterviewInput): CreatorInterviewInput {
  return {
    expertiseSummary: text(interview.expertiseSummary, 'Expertise summary', 2000),
    evidenceExample: text(interview.evidenceExample, 'Evidence example', 2000),
    outsideCompetence: text(interview.outsideCompetence, 'Outside competence', 1000),
    learnerProfile: text(interview.learnerProfile, 'Learner profile', 500),
    prerequisites: optionalText(interview.prerequisites, 'Prerequisites', 2000),
    learnerProblem: text(interview.learnerProblem, 'Learner problem', 2000),
    priorKnowledge: optionalText(interview.priorKnowledge, 'Prior knowledge', 2000),
    observableOutcome: text(interview.observableOutcome, 'Observable outcome', 2000),
    proofArtifact: text(interview.proofArtifact, 'Proof artifact', 2000),
    deliveryFormat: text(interview.deliveryFormat, 'Delivery format', 500),
    learnerTime: optionalText(interview.learnerTime, 'Learner time', 500),
    creatorSupport: optionalText(interview.creatorSupport, 'Creator support', 2000),
    accessibilityNeeds: optionalText(interview.accessibilityNeeds, 'Accessibility needs', 2000),
    offerTitle: text(interview.offerTitle, 'Offer title', 160),
    offerOutcome: text(interview.offerOutcome, 'Offer outcome', 3000),
    includedSupport: optionalText(interview.includedSupport, 'Included support', 2000),
    excludedSupport: optionalText(interview.excludedSupport, 'Excluded support', 2000),
    proposedPrice: optionalText(interview.proposedPrice, 'Proposed price', 18),
    currency: interview.currency,
    assumptionsAndUnknowns: optionalText(
      interview.assumptionsAndUnknowns,
      'Assumptions and unknowns',
      3000,
    ) || 'Self-reported answers only — not market validation or independent verification.',
  };
}

function normalizeProposedOffer(offer: CreatorProposedOffer): CreatorProposedOffer {
  if (!(offerCurrencies as readonly string[]).includes(offer.currency)) {
    throw new Error('Choose a supported currency.');
  }
  if (offer.price.trim()) offerPriceMinor(offer.price);
  return {
    name: text(offer.name, 'Offer name', 160),
    audience: text(offer.audience, 'Audience', 500),
    outcome: text(offer.outcome, 'Outcome', 3000),
    delivery: text(offer.delivery, 'Delivery details', 3000),
    price: offer.price.trim(),
    currency: offer.currency,
    assumptionsAndUnknowns: text(offer.assumptionsAndUnknowns, 'Assumptions', 3000, true),
  };
}

function normalizeSuggestedLesson(lesson: SuggestedLesson, index: number): SuggestedLesson {
  return {
    id: text(lesson.id, `Lesson ${index + 1} ID`, 160),
    title: text(lesson.title, `Lesson ${index + 1} title`, 160),
    objective: text(lesson.objective, `Lesson ${index + 1} objective`, 500),
    content: text(lesson.content, `Lesson ${index + 1} content`, 20000, true),
    practiceTask: text(lesson.practiceTask, `Lesson ${index + 1} practice`, 2000, true),
    durationMinutes: optionalText(lesson.durationMinutes, `Lesson ${index + 1} duration`, 3),
  };
}

export function blankCreatorWorkflow(profile: Profile, workflowId: string): CreatorWorkflowRecord {
  const interview = blankCreatorInterview(profile);
  const proposedOffer = proposedOfferFromInterview(interview);
  return {
    version: 1,
    workflowId: text(workflowId, 'Workflow ID', 160),
    profileId: profile.id,
    revision: 1,
    updatedAt: new Date().toISOString(),
    phase: 'interview_draft',
    interviewRevision: 1,
    interview,
    proposedOffer,
    approvedOfferRevisionHash: null,
    approvedAt: null,
    suggestedOutline: null,
    outlineCommandKey: null,
    outlineContentKey: null,
    lastApplyCommandKey: null,
    lastApplyStatus: null,
    lastError: null,
  };
}

function buildRecord(
  record: CreatorWorkflowRecord,
  updates: Partial<CreatorWorkflowRecord>,
): CreatorWorkflowRecord {
  const next: CreatorWorkflowRecord = {
    ...record,
    ...updates,
    interview: updates.interview ? normalizeInterview(updates.interview) : record.interview,
    proposedOffer: updates.proposedOffer ? normalizeProposedOffer(updates.proposedOffer) : record.proposedOffer,
    suggestedOutline:
      updates.suggestedOutline === undefined
        ? record.suggestedOutline
        : updates.suggestedOutline === null
          ? null
          : updates.suggestedOutline.map((lesson, index) => normalizeSuggestedLesson(lesson, index)),
    updatedAt: new Date().toISOString(),
    revision: record.revision + 1,
  };
  const errors = creatorInterviewErrors(next.interview);
  if (errors.length && next.phase !== 'interview_draft') {
    throw new Error(errors.join(' '));
  }
  return next;
}

export function restoreCreatorWorkflow(raw: string | null, profileId: string): CreatorWorkflowRecord | null {
  if (raw === null) return null;
  if (raw.length > 256000) throw new Error('Saved creator workflow is too large. Nothing was overwritten.');
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object') throw new Error('Invalid saved creator workflow. Nothing was overwritten.');
  const record = value as CreatorWorkflowRecord;
  if (record.version !== 1 || record.profileId !== profileId) {
    throw new Error('Invalid or mismatched creator workflow. Nothing was overwritten.');
  }
  const interview = normalizeInterview(record.interview);
  const proposedOffer = normalizeProposedOffer(record.proposedOffer);
  return {
    version: 1,
    workflowId: text(record.workflowId, 'Workflow ID', 160),
    profileId,
    revision: Number.isInteger(record.revision) && record.revision > 0 ? record.revision : 1,
    updatedAt: parseUpdatedAt(record.updatedAt),
    phase: record.phase,
    interviewRevision: Number.isInteger(record.interviewRevision) && record.interviewRevision > 0
      ? record.interviewRevision
      : 1,
    interview,
    proposedOffer,
    approvedOfferRevisionHash:
      typeof record.approvedOfferRevisionHash === 'string' ? record.approvedOfferRevisionHash : null,
    approvedAt: typeof record.approvedAt === 'string' ? parseUpdatedAt(record.approvedAt) : null,
    suggestedOutline: Array.isArray(record.suggestedOutline)
      ? record.suggestedOutline.map((lesson, index) => normalizeSuggestedLesson(lesson as SuggestedLesson, index))
      : null,
    outlineCommandKey: typeof record.outlineCommandKey === 'string' ? record.outlineCommandKey : null,
    outlineContentKey: typeof record.outlineContentKey === 'string' ? record.outlineContentKey : null,
    lastApplyCommandKey: typeof record.lastApplyCommandKey === 'string' ? record.lastApplyCommandKey : null,
    lastApplyStatus: record.lastApplyStatus ?? null,
    lastError: typeof record.lastError === 'string' ? record.lastError.slice(0, 2000) : null,
  };
}

export function persistCreatorWorkflow(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  profileId: string,
  expectedRaw: string | null,
  record: CreatorWorkflowRecord,
): string {
  const key = educationCreatorWorkflowStorageKey(profileId);
  if (storage.getItem(key) !== expectedRaw) {
    throw new Error('Creator workflow changed in another tab. Reload before saving.');
  }
  if (record.version !== 1 || record.profileId !== profileId) {
    throw new Error('Invalid creator workflow.');
  }
  const raw = JSON.stringify(record);
  if (raw.length > 256000) throw new Error('Creator workflow storage limit reached.');
  storage.setItem(key, raw);
  return raw;
}

export function syncInterviewToWorkflow(
  record: CreatorWorkflowRecord,
  interview: CreatorInterviewInput,
): CreatorWorkflowRecord {
  const normalized = normalizeInterview(interview);
  const proposedOffer = normalizeProposedOffer(proposedOfferFromInterview(normalized));
  const offerHash = offerProposalRevisionHash(proposedOffer);
  const approvalStale = record.approvedOfferRevisionHash !== null && record.approvedOfferRevisionHash !== offerHash;
  return buildRecord(record, {
    interview: normalized,
    interviewRevision: record.interviewRevision + 1,
    proposedOffer,
    phase: approvalStale ? 'awaiting_offer_approval' : record.phase === 'interview_draft' ? 'offer_draft' : record.phase,
    approvedOfferRevisionHash: approvalStale ? null : record.approvedOfferRevisionHash,
    approvedAt: approvalStale ? null : record.approvedAt,
    suggestedOutline: approvalStale ? null : record.suggestedOutline,
    outlineCommandKey: approvalStale ? null : record.outlineCommandKey,
    outlineContentKey: approvalStale ? null : record.outlineContentKey,
    lastApplyCommandKey: approvalStale ? null : record.lastApplyCommandKey,
    lastApplyStatus: approvalStale ? null : record.lastApplyStatus,
  });
}

export function updateProposedOfferOnWorkflow(
  record: CreatorWorkflowRecord,
  offer: CreatorProposedOffer,
): CreatorWorkflowRecord {
  const proposedOffer = normalizeProposedOffer(offer);
  const offerHash = offerProposalRevisionHash(proposedOffer);
  const approvalStale = record.approvedOfferRevisionHash !== null && record.approvedOfferRevisionHash !== offerHash;
  return buildRecord(record, {
    proposedOffer,
    phase: approvalStale ? 'awaiting_offer_approval' : record.phase === 'offer_draft' ? 'offer_draft' : record.phase,
    approvedOfferRevisionHash: approvalStale ? null : record.approvedOfferRevisionHash,
    approvedAt: approvalStale ? null : record.approvedAt,
    suggestedOutline: approvalStale ? null : record.suggestedOutline,
    outlineCommandKey: approvalStale ? null : record.outlineCommandKey,
    outlineContentKey: approvalStale ? null : record.outlineContentKey,
    lastApplyCommandKey: approvalStale ? null : record.lastApplyCommandKey,
    lastApplyStatus: approvalStale ? null : record.lastApplyStatus,
  });
}

export function approveOfferForCurriculumPlanning(record: CreatorWorkflowRecord): CreatorWorkflowRecord {
  const errors = creatorInterviewErrors(record.interview);
  if (errors.length) throw new Error(errors.join(' '));
  const hash = offerProposalRevisionHash(record.proposedOffer);
  return buildRecord(record, {
    phase: 'offer_approved',
    approvedOfferRevisionHash: hash,
    approvedAt: new Date().toISOString(),
    lastError: null,
  });
}

export function outlineGenerationCommandKey(record: CreatorWorkflowRecord): string {
  return `${record.workflowId}:generate:${record.approvedOfferRevisionHash}:${creatorWorkflowGeneratorVersion}`;
}

function stableLessonCount(record: CreatorWorkflowRecord): number {
  const seed = offerProposalRevisionHash(record.proposedOffer);
  const n = Number.parseInt(seed.slice(-2), 16);
  return 3 + (n % 3);
}

function lessonId(workflowId: string, index: number): string {
  return `${workflowId}-lesson-${index + 1}`;
}

export const suggestedOutlineLessonMin = 1;

function canonicalSuggestedLesson(lesson: SuggestedLesson) {
  return {
    id: lesson.id.trim(),
    title: lesson.title.trim(),
    objective: lesson.objective.trim(),
    content: lesson.content.trim(),
    practiceTask: lesson.practiceTask.trim(),
    durationMinutes: lesson.durationMinutes.trim(),
  };
}

export function suggestedOutlineRevisionHash(outline: readonly SuggestedLesson[]): string {
  const canonical = outline.map(lesson => canonicalSuggestedLesson(lesson));
  const payload = JSON.stringify(canonical);
  let hash = 0;
  for (let i = 0; i < payload.length; i++) hash = (Math.imul(31, hash) + payload.charCodeAt(i)) | 0;
  return `outline-rev-${(hash >>> 0).toString(16)}`;
}

export function effectiveOutlineContentKey(record: CreatorWorkflowRecord): string | null {
  if (record.outlineContentKey) return record.outlineContentKey;
  if (record.suggestedOutline?.length) return suggestedOutlineRevisionHash(record.suggestedOutline);
  return record.outlineCommandKey;
}

export function suggestedOutlineMatchesSaved(
  saved: readonly SuggestedLesson[] | null | undefined,
  draft: readonly SuggestedLesson[],
): boolean {
  if (!saved?.length && !draft.length) return true;
  if (!saved?.length || saved.length !== draft.length) return false;
  return suggestedOutlineRevisionHash(saved) === suggestedOutlineRevisionHash(draft);
}

function nextSuggestedLessonId(workflowId: string, lessons: readonly SuggestedLesson[]): string {
  const prefix = `${workflowId}-lesson-`;
  let max = 0;
  for (const lesson of lessons) {
    if (lesson.id.startsWith(prefix)) {
      const n = Number.parseInt(lesson.id.slice(prefix.length), 10);
      if (Number.isSafeInteger(n) && n > max) max = n;
    }
  }
  return `${workflowId}-lesson-${max + 1}`;
}

export function blankSuggestedLesson(workflowId: string, existing: readonly SuggestedLesson[]): SuggestedLesson {
  return {
    id: nextSuggestedLessonId(workflowId, existing),
    title: 'New suggested lesson',
    objective: '',
    content: '',
    practiceTask: '',
    durationMinutes: '',
  };
}

export function reorderSuggestedLessons(
  lessons: readonly SuggestedLesson[],
  index: number,
  delta: -1 | 1,
): SuggestedLesson[] {
  const target = index + delta;
  if (index < 0 || index >= lessons.length || target < 0 || target >= lessons.length) return [...lessons];
  const next = [...lessons];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function removeSuggestedLessonAt(lessons: readonly SuggestedLesson[], index: number): SuggestedLesson[] {
  if (index < 0 || index >= lessons.length) return [...lessons];
  if (lessons.length <= suggestedOutlineLessonMin) {
    throw new Error(`Keep at least ${suggestedOutlineLessonMin} suggested lesson.`);
  }
  return lessons.filter((_, i) => i !== index);
}

export function addSuggestedLesson(
  workflowId: string,
  lessons: readonly SuggestedLesson[],
): SuggestedLesson[] {
  if (lessons.length >= educationCourseLessonLimit) {
    throw new Error(`Add up to ${educationCourseLessonLimit} suggested lessons.`);
  }
  return [...lessons, blankSuggestedLesson(workflowId, lessons)];
}

export function saveSuggestedOutlineToWorkflow(
  record: CreatorWorkflowRecord,
  outline: readonly SuggestedLesson[],
): CreatorWorkflowRecord {
  if (record.phase !== 'offer_approved' && record.phase !== 'curriculum_draft' && record.phase !== 'curriculum_reviewed') {
    throw new Error('Approve the offer for curriculum planning before saving an outline.');
  }
  if (!record.approvedOfferRevisionHash) {
    throw new Error('Offer approval is missing or out of date. Review and approve again.');
  }
  if (!outline.length || outline.length > educationCourseLessonLimit) {
    throw new Error(`Save between ${suggestedOutlineLessonMin} and ${educationCourseLessonLimit} suggested lessons.`);
  }
  const normalized = outline.map((lesson, index) => normalizeSuggestedLesson(lesson, index));
  const contentKey = suggestedOutlineRevisionHash(normalized);
  const importStale =
    record.lastApplyCommandKey !== null &&
    record.outlineContentKey !== null &&
    record.outlineContentKey !== contentKey;
  return buildRecord(record, {
    phase: 'curriculum_draft',
    suggestedOutline: normalized,
    outlineContentKey: contentKey,
    lastApplyCommandKey: importStale ? null : record.lastApplyCommandKey,
    lastApplyStatus: importStale ? null : record.lastApplyStatus,
    lastError: null,
  });
}

/** Deterministic suggested outline from creator answers — labelled suggestions, not AI output. */
export function generateSuggestedOutline(record: CreatorWorkflowRecord): CreatorWorkflowRecord {
  if (record.phase !== 'offer_approved' && record.phase !== 'curriculum_draft' && record.phase !== 'curriculum_reviewed') {
    throw new Error('Approve the offer for curriculum planning before generating an outline.');
  }
  if (!record.approvedOfferRevisionHash) {
    throw new Error('Offer approval is missing or out of date. Review and approve again.');
  }
  const commandKey = outlineGenerationCommandKey(record);
  if (record.outlineCommandKey === commandKey && record.suggestedOutline?.length) {
    return record;
  }
  const interview = record.interview;
  const offer = record.proposedOffer;
  const templates = [
    {
      title: `Orient: ${offer.name}`,
      objective: `Explain who this is for (${offer.audience}) and the observable outcome.`,
      content: `Welcome learners to ${offer.name}.\n\nYou teach ${interview.expertiseSummary}.\n\nBy the end they should: ${interview.observableOutcome}.\n\nEvidence you can point to: ${interview.evidenceExample}.\n\nStay within your competence — not: ${interview.outsideCompetence}.`,
      practiceTask: `Write one sentence describing the result a learner should see after this course.`,
      durationMinutes: '10',
    },
    {
      title: 'Map the starting point',
      objective: 'Clarify prerequisites and what learners already know.',
      content: `Learner profile: ${interview.learnerProfile}.\n\nProblem to solve: ${interview.learnerProblem}.\n\nPrerequisites: ${interview.prerequisites || 'None stated'}.\n\nPrior knowledge: ${interview.priorKnowledge || 'Not specified'}.`,
      practiceTask: 'List three questions to ask a new learner before they start lesson work.',
      durationMinutes: '12',
    },
    {
      title: 'Core method',
      objective: `Practice the main skill: ${interview.expertiseSummary}.`,
      content: `Walk through your approach step by step using ${interview.evidenceExample} as the anchor example.\n\nDelivery format: ${interview.deliveryFormat}.\n\nSupport you will provide: ${interview.creatorSupport || 'As described in the offer.'}`,
      practiceTask: interview.proofArtifact || 'Complete the exercise described in your outcome section.',
      durationMinutes: '20',
    },
    {
      title: 'Apply and prove it',
      objective: `Produce evidence: ${interview.proofArtifact}.`,
      content: `Learners implement ${interview.observableOutcome}.\n\nIncluded support: ${interview.includedSupport || 'See offer delivery notes.'}\n\nNot included: ${interview.excludedSupport || 'See offer delivery notes.'}`,
      practiceTask: interview.proofArtifact,
      durationMinutes: '25',
    },
    {
      title: 'Review and next steps',
      objective: 'Reflect on progress and plan continued practice.',
      content: `Summarize wins, common mistakes, and how learners can keep practicing.\n\nAssumptions and unknowns: ${offer.assumptionsAndUnknowns}`,
      practiceTask: 'Draft a one-week practice plan with three concrete actions.',
      durationMinutes: '15',
    },
  ];
  const count = stableLessonCount(record);
  const suggestedOutline: SuggestedLesson[] = templates.slice(0, count).map((template, index) => ({
    id: lessonId(record.workflowId, index),
    title: template.title,
    objective: template.objective,
    content: template.content,
    practiceTask: template.practiceTask,
    durationMinutes: template.durationMinutes,
  }));
  const contentKey = suggestedOutlineRevisionHash(suggestedOutline);
  const regen =
    record.outlineContentKey !== null &&
    record.outlineContentKey !== contentKey &&
    record.lastApplyCommandKey !== null;
  return buildRecord(record, {
    phase: 'curriculum_draft',
    suggestedOutline,
    outlineCommandKey: commandKey,
    outlineContentKey: contentKey,
    lastApplyCommandKey: regen ? null : record.lastApplyCommandKey,
    lastApplyStatus: regen ? null : record.lastApplyStatus,
    lastError: null,
  });
}

export function courseDraftInputFromOutline(
  record: CreatorWorkflowRecord,
): EducationCourseDraftInput {
  if (!record.suggestedOutline?.length) {
    throw new Error('Generate a suggested outline before importing into the course editor.');
  }
  const offer = record.proposedOffer;
  const summary = [
    `Suggested outline from your answers (${creatorWorkflowGeneratorVersion}). Not published or hosted.`,
    offer.outcome,
    record.interview.assumptionsAndUnknowns,
  ]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 2000);
  return {
    title: offer.name.slice(0, 160),
    summary,
    lessons: record.suggestedOutline.map(lesson => ({
      ...blankEducationLessonInput(),
      id: lesson.id,
      title: lesson.title,
      content: [lesson.objective, lesson.content, lesson.practiceTask ? `Practice: ${lesson.practiceTask}` : '']
        .filter(Boolean)
        .join('\n\n'),
      durationMinutes: lesson.durationMinutes,
    })),
  };
}

export function applyOutlineImportCommandKey(record: CreatorWorkflowRecord, mode: 'replace' | 'merge'): string {
  const contentKey = effectiveOutlineContentKey(record);
  if (!contentKey) throw new Error('Save a suggested outline before importing into the course editor.');
  return `${record.workflowId}:apply:${contentKey}:${mode}`;
}

export function importOutlineToCourseStorage(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  profileId: string,
  courseExpectedRaw: string | null,
  record: CreatorWorkflowRecord,
  mode: 'replace' | 'merge',
  courseId: string,
): {
  courseRaw: string;
  workflow: CreatorWorkflowRecord;
  status: 'completed' | 'partial';
  preservedQuizLessonIds: string[];
  removedQuizLessonIds: string[];
} {
  const commandKey = applyOutlineImportCommandKey(record, mode);
  if (record.lastApplyCommandKey === commandKey && record.lastApplyStatus === 'completed') {
    const existingRaw = storage.getItem(educationCourseStorageKey(profileId));
    if (existingRaw) {
      return {
        courseRaw: existingRaw,
        workflow: record,
        status: 'completed',
        preservedQuizLessonIds: [],
        removedQuizLessonIds: [],
      };
    }
  }
  const importInput = courseDraftInputFromOutline(record);
  let merged = importInput;
  let preservedQuizLessonIds: string[] = [];
  let removedQuizLessonIds: string[] = [];
  const existing =
    courseExpectedRaw !== null ? restoreEducationCourseDraft(courseExpectedRaw, profileId) : null;
  if (mode === 'merge' && existing) {
    const base = editEducationCourseDraft(existing);
    const existingLessonIds = new Set(base.lessons.map(lesson => lesson.id));
    const lessonsToAppend = importInput.lessons.filter(lesson => !existingLessonIds.has(lesson.id));
    merged = {
      ...base,
      lessons: [...base.lessons, ...lessonsToAppend],
    };
  } else if (mode === 'replace' && existing) {
    const preserved = mergeImportedLessonsPreservingQuizzes(importInput.lessons, existing.lessons);
    merged = { ...importInput, lessons: preserved.lessons };
    preservedQuizLessonIds = preserved.preservedQuizLessonIds;
    removedQuizLessonIds = preserved.removedQuizLessonIds;
  }
  const draft = saveEducationCourseDraft(merged, { id: courseId, profileId });
  const courseRaw = persistEducationCourseDraft(storage, profileId, courseExpectedRaw, draft);
  const workflow = buildRecord(record, {
    phase: 'curriculum_reviewed',
    lastApplyCommandKey: commandKey,
    lastApplyStatus: 'completed',
    lastError: null,
  });
  const status =
    removedQuizLessonIds.length > 0 ? 'partial' : 'completed';
  return {
    courseRaw,
    workflow,
    status,
    preservedQuizLessonIds,
    removedQuizLessonIds,
  };
}
