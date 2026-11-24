export const communitySpaceNameLimit = 120;
export const communitySpaceDescriptionLimit = 2000;
export const communityRulesLimit = 4000;
export const communityTopicNameLimit = 80;
export const communityTopicDescriptionLimit = 500;
export const communityTopicLimit = 24;

export type CommunityTopicInput = {
  id: string;
  name: string;
  description: string;
};

export type CommunitySpaceDraftInput = {
  name: string;
  description: string;
  rules: string;
  topics: CommunityTopicInput[];
};

export type CommunityTopic = {
  id: string;
  name: string;
  description?: string;
};

export type CommunitySpaceDraft = {
  version: 1;
  id: string;
  profileId: string;
  updatedAt: string;
  name: string;
  description: string;
  rules: string;
  topics: CommunityTopic[];
};

export type CommunityMemberTopicProjection = {
  id: string;
  name: string;
  description?: string;
};

export type CommunityMemberSpaceProjection = {
  name: string;
  description: string;
  rules: string;
  topics: CommunityMemberTopicProjection[];
};

export const communitySpaceStorageKey = (profileId: string) => `launchpad.community-space-draft.v1.${profileId}`;

const isoTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

const text = (value: unknown, label: string, limit: number, optional = false) => {
  if (typeof value !== 'string' || value.length > limit || (!optional && !value.trim())) {
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
    throw new Error('Invalid saved community draft. Nothing was overwritten.');
  }
  return value;
}

function normalizeTopics(topics: readonly CommunityTopicInput[]): CommunityTopic[] {
  if (!Array.isArray(topics) || topics.length > communityTopicLimit) {
    throw new Error(`Add up to ${communityTopicLimit} topics, or leave topics empty.`);
  }
  const ids = new Set<string>();
  const normalized: CommunityTopic[] = [];
  for (const [index, topic] of topics.entries()) {
    const name = typeof topic.name === 'string' ? topic.name.trim() : '';
    const descriptionRaw = typeof topic.description === 'string' ? topic.description.trim() : '';
    if (!name && !descriptionRaw) continue;
    if (!name) {
      throw new Error(`Topic ${index + 1} needs a name when a description is provided.`);
    }
    const id = text(topic.id, `Topic ${index + 1} ID`, 160);
    if (ids.has(id)) throw new Error('Each topic needs a unique ID.');
    ids.add(id);
    const description = optionalPlainText(descriptionRaw, `Topic ${index + 1} description`, communityTopicDescriptionLimit);
    normalized.push(description ? { id, name: text(name, `Topic ${index + 1} name`, communityTopicNameLimit), description } : { id, name: text(name, `Topic ${index + 1} name`, communityTopicNameLimit) });
  }
  return normalized;
}

export function blankCommunitySpaceDraftInput(): CommunitySpaceDraftInput {
  return { name: '', description: '', rules: '', topics: [] };
}

export function blankCommunityTopicInput(): CommunityTopicInput {
  return { id: '', name: '', description: '' };
}

export function editCommunitySpaceDraft(draft: CommunitySpaceDraft): CommunitySpaceDraftInput {
  return {
    name: draft.name,
    description: draft.description,
    rules: draft.rules,
    topics: draft.topics.map(topic => ({
      id: topic.id,
      name: topic.name,
      description: topic.description ?? '',
    })),
  };
}

function buildDraft(
  input: CommunitySpaceDraftInput,
  identity: Pick<CommunitySpaceDraft, 'id' | 'profileId'>,
  updatedAt: string,
): CommunitySpaceDraft {
  return {
    version: 1,
    id: text(identity.id, 'Space ID', 160),
    profileId: text(identity.profileId, 'Profile ID', 160),
    updatedAt,
    name: text(input.name, 'Community name', communitySpaceNameLimit),
    description: text(input.description, 'Community description', communitySpaceDescriptionLimit),
    rules: text(input.rules, 'Community rules', communityRulesLimit),
    topics: normalizeTopics(input.topics),
  };
}

export function saveCommunitySpaceDraft(
  input: CommunitySpaceDraftInput,
  identity: Pick<CommunitySpaceDraft, 'id' | 'profileId'>,
): CommunitySpaceDraft {
  return buildDraft(input, identity, new Date().toISOString());
}

export function communitySpaceDraftFromInput(
  input: CommunitySpaceDraftInput,
  identity: Pick<CommunitySpaceDraft, 'id' | 'profileId'>,
): CommunitySpaceDraft {
  return buildDraft(input, identity, new Date().toISOString());
}

export function restoreCommunitySpaceDraft(raw: string | null, profileId: string): CommunitySpaceDraft | null {
  if (raw === null) return null;
  if (raw.length > 128000) throw new Error('Saved community draft is too large. Nothing was overwritten.');
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object') throw new Error('Invalid saved community draft. Nothing was overwritten.');
  const record = value as CommunitySpaceDraft;
  if (record.version !== 1 || record.profileId !== profileId) {
    throw new Error('Invalid or mismatched community draft. Nothing was overwritten.');
  }
  return buildDraft(editCommunitySpaceDraft(record), record, parseUpdatedAt(record.updatedAt));
}

export function persistCommunitySpaceDraft(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  profileId: string,
  expectedRaw: string | null,
  draft: CommunitySpaceDraft,
): string {
  const key = communitySpaceStorageKey(profileId);
  if (storage.getItem(key) !== expectedRaw) {
    throw new Error('Community draft changed in another tab. Your unsaved changes remain; copy them before reloading the saved draft.');
  }
  const checked = restoreCommunitySpaceDraft(JSON.stringify(draft), profileId);
  if (!checked) throw new Error('Invalid community draft.');
  const raw = JSON.stringify(checked);
  if (raw.length > 128000) throw new Error('Community draft storage limit reached. Your unsaved changes remain.');
  storage.setItem(key, raw);
  return raw;
}

export function reorderTopicInputs(topics: CommunityTopicInput[], index: number, delta: -1 | 1): CommunityTopicInput[] {
  const target = index + delta;
  if (index < 0 || index >= topics.length || target < 0 || target >= topics.length) return topics;
  const next = [...topics];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function communitySpaceDraftAllowlistKeys(): readonly (keyof CommunitySpaceDraft)[] {
  return ['version', 'id', 'profileId', 'updatedAt', 'name', 'description', 'rules', 'topics'];
}

export function communityMemberTopicAllowlistKeys(): readonly (keyof CommunityMemberTopicProjection)[] {
  return ['id', 'name', 'description'];
}

export function projectCommunityForMemberPreview(draft: CommunitySpaceDraft): CommunityMemberSpaceProjection {
  return {
    name: draft.name,
    description: draft.description,
    rules: draft.rules,
    topics: draft.topics.map(topic => ({
      id: topic.id,
      name: topic.name,
      ...(topic.description ? { description: topic.description } : {}),
    })),
  };
}
