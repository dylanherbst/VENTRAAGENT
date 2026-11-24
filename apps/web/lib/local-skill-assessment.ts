import type { Profile } from './onboarding.ts';

export const skillAssessmentSkillLimit = 8;
export const skillNameLimit = 120;
export const skillEvidenceLimit = 1000;
export const skillAssessmentStorageByteLimit = 128000;
export const skillAssessmentRevisionCap = 9999;

export const skillConfidenceLevels = [
  { value: 1, label: 'Exploring', detail: 'I am still learning the basics.' },
  { value: 2, label: 'Familiar', detail: 'I can follow guidance but would not lead alone.' },
  { value: 3, label: 'Comfortable', detail: 'I handle typical situations without constant help.' },
  { value: 4, label: 'Confident', detail: 'I can guide others through common scenarios.' },
  { value: 5, label: 'Deep practice', detail: 'I have repeated, deliberate practice in this area.' },
] as const;

export const skillExperienceLevels = [
  { value: 1, label: 'No client use yet', detail: 'Practice or study only so far.' },
  { value: 2, label: 'Informal use', detail: 'Friends, volunteering or personal projects.' },
  { value: 3, label: 'Some real-world use', detail: 'Paid or accountable work in a few situations.' },
  { value: 4, label: 'Regular use', detail: 'Ongoing professional or teaching application.' },
  { value: 5, label: 'Extensive use', detail: 'Many projects, clients or cohorts over time.' },
] as const;

export const skillIntentOptions = [
  { value: 'teach' as const, label: 'Teach it', detail: 'Education, coaching or training pathway.' },
  { value: 'offer-service' as const, label: 'Offer as a service', detail: 'Services or productized delivery.' },
  { value: 'both' as const, label: 'Teach and offer', detail: 'Both Education and Services pathways.' },
] as const;

export type SkillConfidence = (typeof skillConfidenceLevels)[number]['value'];
export type SkillExperience = (typeof skillExperienceLevels)[number]['value'];
export type SkillIntent = (typeof skillIntentOptions)[number]['value'];

export type SkillAssessmentSkillInput = {
  id: string;
  name: string;
  confidence: SkillConfidence;
  experience: SkillExperience;
  evidenceExample: string;
  intent: SkillIntent;
};

export type SkillAssessmentDraftInput = {
  skills: SkillAssessmentSkillInput[];
};

export type SkillAssessmentSkill = {
  id: string;
  name: string;
  confidence: SkillConfidence;
  experience: SkillExperience;
  evidenceExample?: string;
  intent: SkillIntent;
};

export type SkillAssessmentDraft = {
  version: 1;
  profileId: string;
  revision: number;
  updatedAt: string;
  skills: SkillAssessmentSkill[];
};

export type SkillAssessmentStrengthProjection = {
  name: string;
  confidenceLabel: string;
  experienceLabel: string;
  compositeScore: number;
};

export type SkillAssessmentNextStepProjection = {
  title: string;
  detail: string;
  anchor: string;
};

export type SkillAssessmentSummaryProjection = {
  disclaimer: string;
  skillCount: number;
  strengths: SkillAssessmentStrengthProjection[];
  developing: string[];
  evidenceGaps: string[];
  nextSteps: SkillAssessmentNextStepProjection[];
};

export const skillAssessmentStorageKey = (profileId: string) =>
  `launchpad.skill-assessment-draft.v1.${profileId}`;

const isoTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const intentValues = new Set(skillIntentOptions.map(option => option.value));
const confidenceValues = new Set(skillConfidenceLevels.map(level => level.value));
const experienceValues = new Set(skillExperienceLevels.map(level => level.value));

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

function parseUpdatedAt(value: unknown): string {
  if (typeof value !== 'string' || !isoTimestampPattern.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error('Invalid saved skill assessment. Nothing was overwritten.');
  }
  return value;
}

function parseRevision(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > skillAssessmentRevisionCap) {
    throw new Error('Invalid saved skill assessment. Nothing was overwritten.');
  }
  return value as number;
}

function parseIntent(value: unknown): SkillIntent {
  if (typeof value !== 'string' || !intentValues.has(value as SkillIntent)) {
    throw new Error('Choose whether you want to teach, offer as a service, or both.');
  }
  return value as SkillIntent;
}

function parseRating(value: unknown, allowed: Set<number>, label: string): number {
  if (!Number.isInteger(value) || !allowed.has(value as number)) {
    throw new Error(`${label} must use the labelled scale (1–5).`);
  }
  return value as number;
}

export function skillCompositeScore(confidence: SkillConfidence, experience: SkillExperience): number {
  return confidence + experience;
}

export function labelForConfidence(value: SkillConfidence): string {
  return skillConfidenceLevels.find(level => level.value === value)?.label ?? String(value);
}

export function labelForExperience(value: SkillExperience): string {
  return skillExperienceLevels.find(level => level.value === value)?.label ?? String(value);
}

export function blankSkillAssessmentSkillInput(): SkillAssessmentSkillInput {
  return {
    id: '',
    name: '',
    confidence: 3,
    experience: 3,
    evidenceExample: '',
    intent: 'teach',
  };
}

export function blankSkillAssessmentDraftInput(): SkillAssessmentDraftInput {
  return { skills: [] };
}

export function editSkillAssessmentDraft(draft: SkillAssessmentDraft): SkillAssessmentDraftInput {
  return {
    skills: draft.skills.map(skill => ({
      id: skill.id,
      name: skill.name,
      confidence: skill.confidence,
      experience: skill.experience,
      evidenceExample: skill.evidenceExample ?? '',
      intent: skill.intent,
    })),
  };
}

function normalizeSkills(skills: readonly SkillAssessmentSkillInput[]): SkillAssessmentSkill[] {
  if (!Array.isArray(skills) || skills.length > skillAssessmentSkillLimit) {
    throw new Error(`Add up to ${skillAssessmentSkillLimit} skills.`);
  }
  const ids = new Set<string>();
  const normalized: SkillAssessmentSkill[] = [];
  for (const [index, skill] of skills.entries()) {
    const name = typeof skill.name === 'string' ? skill.name.trim() : '';
    const evidenceRaw = typeof skill.evidenceExample === 'string' ? skill.evidenceExample : '';
    if (!name && !evidenceRaw.trim()) continue;
    if (!name) {
      throw new Error(`Skill ${index + 1} needs a name when other fields are filled.`);
    }
    const id = text(skill.id, `Skill ${index + 1} ID`, 160);
    if (ids.has(id)) throw new Error('Each skill needs a unique ID.');
    ids.add(id);
    const evidenceExample = optionalPlainText(evidenceRaw, `Skill ${index + 1} evidence`, skillEvidenceLimit);
    normalized.push({
      id,
      name: text(name, `Skill ${index + 1} name`, skillNameLimit),
      confidence: parseRating(skill.confidence, confidenceValues, `Skill ${index + 1} confidence`) as SkillConfidence,
      experience: parseRating(skill.experience, experienceValues, `Skill ${index + 1} experience`) as SkillExperience,
      intent: parseIntent(skill.intent),
      ...(evidenceExample ? { evidenceExample } : {}),
    });
  }
  if (!normalized.length) {
    throw new Error('Add at least one skill with a name and ratings before saving.');
  }
  return normalized;
}

function buildDraft(
  input: SkillAssessmentDraftInput,
  profileId: string,
  revision: number,
  updatedAt: string,
): SkillAssessmentDraft {
  return {
    version: 1,
    profileId: text(profileId, 'Profile ID', 160),
    revision,
    updatedAt: parseUpdatedAt(updatedAt),
    skills: normalizeSkills(input.skills),
  };
}

export function saveSkillAssessmentDraft(
  input: SkillAssessmentDraftInput,
  profileId: string,
  prior: SkillAssessmentDraft | null,
): SkillAssessmentDraft {
  const revision = prior ? Math.min(prior.revision + 1, skillAssessmentRevisionCap) : 1;
  return buildDraft(input, profileId, revision, new Date().toISOString());
}

export function skillAssessmentDraftFromInput(
  input: SkillAssessmentDraftInput,
  profileId: string,
  prior: SkillAssessmentDraft | null,
): SkillAssessmentDraft {
  const revision = prior?.revision ?? 1;
  return buildDraft(input, profileId, revision, new Date().toISOString());
}

export function restoreSkillAssessmentDraft(raw: string | null, profileId: string): SkillAssessmentDraft | null {
  if (raw === null) return null;
  if (raw.length > skillAssessmentStorageByteLimit) {
    throw new Error('Saved skill assessment is too large. Nothing was overwritten.');
  }
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object') throw new Error('Invalid saved skill assessment. Nothing was overwritten.');
  const record = value as SkillAssessmentDraft;
  if (record.version !== 1 || record.profileId !== profileId) {
    throw new Error('Invalid or mismatched skill assessment. Nothing was overwritten.');
  }
  const revision = parseRevision(record.revision);
  return buildDraft(editSkillAssessmentDraft(record), profileId, revision, parseUpdatedAt(record.updatedAt));
}

export function persistSkillAssessmentDraft(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  profileId: string,
  expectedRaw: string | null,
  draft: SkillAssessmentDraft,
): string {
  const key = skillAssessmentStorageKey(profileId);
  if (storage.getItem(key) !== expectedRaw) {
    throw new Error(
      'Skill assessment changed in another tab. Your unsaved changes remain; copy them before reloading the saved assessment.',
    );
  }
  const checked = restoreSkillAssessmentDraft(JSON.stringify(draft), profileId);
  if (!checked) throw new Error('Invalid skill assessment.');
  const raw = JSON.stringify(checked);
  if (raw.length > skillAssessmentStorageByteLimit) {
    throw new Error('Skill assessment storage limit reached. Your unsaved changes remain.');
  }
  storage.setItem(key, raw);
  return raw;
}

export function skillAssessmentSummaryAllowlistKeys(): readonly (keyof SkillAssessmentSummaryProjection)[] {
  return ['disclaimer', 'skillCount', 'strengths', 'developing', 'evidenceGaps', 'nextSteps'];
}

export function skillAssessmentDraftAllowlistKeys(): readonly (keyof SkillAssessmentDraft)[] {
  return ['version', 'profileId', 'revision', 'updatedAt', 'skills'];
}

export function skillAssessmentStrengthAllowlistKeys(): readonly (keyof SkillAssessmentStrengthProjection)[] {
  return ['name', 'confidenceLabel', 'experienceLabel', 'compositeScore'];
}

export function suggestSkillNameFromProfile(profile: Pick<Profile, 'expertise'>): string | null {
  const trimmed = profile.expertise.trim();
  if (!trimmed || trimmed.length > skillNameLimit) return null;
  return trimmed;
}

export function buildSkillAssessmentSummary(
  draft: SkillAssessmentDraft,
  profile: Pick<Profile, 'pathways' | 'audience' | 'name'>,
): SkillAssessmentSummaryProjection {
  const disclaimer =
    'Self-reported reflection only — not AI scoring, credential verification, market demand or a promise of business results.';
  const scored = draft.skills.map(skill => ({
    skill,
    composite: skillCompositeScore(skill.confidence, skill.experience),
  }));
  scored.sort((a, b) => b.composite - a.composite || a.skill.name.localeCompare(b.skill.name));

  const strengths: SkillAssessmentStrengthProjection[] = [];
  const developing: string[] = [];
  for (const { skill, composite } of scored) {
    const isStrength = composite >= 8 || (skill.confidence >= 4 && skill.experience >= 4);
    if (isStrength) {
      strengths.push({
        name: skill.name,
        confidenceLabel: labelForConfidence(skill.confidence),
        experienceLabel: labelForExperience(skill.experience),
        compositeScore: composite,
      });
    } else if (composite >= 5) {
      developing.push(skill.name);
    }
  }

  const evidenceGaps = draft.skills.filter(skill => !skill.evidenceExample).map(skill => skill.name);

  const wantsTeach = draft.skills.some(skill => skill.intent === 'teach' || skill.intent === 'both');
  const wantsService = draft.skills.some(skill => skill.intent === 'offer-service' || skill.intent === 'both');
  const nextSteps: SkillAssessmentNextStepProjection[] = [];

  if (wantsTeach && profile.pathways.includes('education')) {
    nextSteps.push({
      title: 'Shape an Education offer',
      detail: `Draft a ${profile.audience ? `program for ${profile.audience}` : 'learning offer'} from the skills you marked for teaching — use Your offers and the Education creator workflow below.`,
      anchor: '#offer-builder-title',
    });
    nextSteps.push({
      title: 'Plan curriculum from your interview',
      detail: 'Run the structured expertise interview when you are ready to outline lessons — it does not auto-import this assessment.',
      anchor: '#education-creator-workflow-title',
    });
  } else if (wantsTeach) {
    nextSteps.push({
      title: 'Activate Education pathway',
      detail: 'Enable Education in your business profile if you want to teach these skills.',
      anchor: '#launch-content',
    });
  }

  if (wantsService && profile.pathways.includes('business')) {
    nextSteps.push({
      title: 'Draft a service package',
      detail: `Turn self-reported service skills into a local service offer for ${profile.audience || 'your audience'} — no booking or checkout is created.`,
      anchor: '#offer-builder-title',
    });
    nextSteps.push({
      title: 'Prepare a service proposal',
      detail: 'When an offer exists, draft a proposal snapshot for scoped client work.',
      anchor: '#service-proposals-title',
    });
  } else if (wantsService) {
    nextSteps.push({
      title: 'Activate Services pathway',
      detail: 'Enable Services in your business profile if you want to offer these skills as a package.',
      anchor: '#launch-content',
    });
  }

  if (evidenceGaps.length) {
    nextSteps.push({
      title: 'Add concrete evidence examples',
      detail: 'Optional one-line examples help you remember what to cite later — they are not verified credentials.',
      anchor: '#skill-assessment-title',
    });
  }

  if (!nextSteps.length) {
    nextSteps.push({
      title: 'Review your launch plan',
      detail: 'Mark checklist steps as reviewed when you have planned the work — nothing runs automatically.',
      anchor: '#plan-title',
    });
  }

  const filteredSteps = nextSteps.filter(step => {
    if (step.anchor === '#skill-assessment-title' || step.anchor === '#plan-title' || step.anchor === '#launch-content') {
      return true;
    }
    if (step.anchor === '#offer-builder-title') return wantsTeach || wantsService;
    if (step.anchor === '#education-creator-workflow-title') {
      return wantsTeach && profile.pathways.includes('education');
    }
    if (step.anchor === '#service-proposals-title') {
      return wantsService && profile.pathways.includes('business');
    }
    return true;
  });

  return {
    disclaimer,
    skillCount: draft.skills.length,
    strengths,
    developing,
    evidenceGaps,
    nextSteps: filteredSteps,
  };
}

export function projectSkillAssessmentSummary(draft: SkillAssessmentDraft, profile: Pick<Profile, 'pathways' | 'audience' | 'name'>): SkillAssessmentSummaryProjection {
  return buildSkillAssessmentSummary(draft, profile);
}
