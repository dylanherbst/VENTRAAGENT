export const campaignKinds = ['one-off', 'nurture'] as const;
export type CampaignKind = (typeof campaignKinds)[number];
export const campaignStatuses = ['draft', 'ready', 'archived'] as const;
export type CampaignStatus = (typeof campaignStatuses)[number];

export const campaignLimit = 30;
export const stepLimit = 12;
export const campaignNameLimit = 120;
export const audienceNoteLimit = 500;
export const subjectLimit = 150;
export const preheaderLimit = 150;
export const bodyLimit = 8000;
export const maxWaitDays = 60;
const storageByteLimit = 900000;

export type CampaignStep = { id: string; subject: string; preheader?: string; body: string; waitDays: number };
export type EmailCampaign = { id: string; name: string; kind: CampaignKind; audienceNote: string; status: CampaignStatus; steps: CampaignStep[] };

export const emailCampaignsStorageKey = (profileId: string) => `launchpad.email-campaigns.v1.${profileId}`;

export function blankStep(id: string, waitDays = 0): CampaignStep {
  return { id, subject: '', body: '', waitDays };
}
export function blankCampaign(id: string, stepId = `${id}-s1`): EmailCampaign {
  return { id, name: '', kind: 'one-off', audienceNote: '', status: 'draft', steps: [blankStep(stepId)] };
}

const unsubscribePattern = /unsubscribe|opt[\s-]?out|stop receiving|stop these emails|remove (me|you) from/i;
const consentPattern = /consent|opted[\s-]?in|opt[\s-]?in|permission|subscribed|agreed to (receive|hear)/i;
export const hasUnsubscribeLine = (body: string) => unsubscribePattern.test(body);
export const mentionsConsent = (note: string) => consentPattern.test(note);

function stepProblems(step: CampaignStep, n: number): string[] {
  const p: string[] = [];
  if (!step || typeof step !== 'object') return [`Step ${n} is not valid.`];
  if (typeof step.id !== 'string' || !step.id || step.id.length > 80) p.push(`Step ${n} needs an id.`);
  if (typeof step.subject !== 'string' || !step.subject.trim()) p.push(`Step ${n} needs a subject.`);
  else if (step.subject.length > subjectLimit) p.push(`Step ${n} subject must be ${subjectLimit} characters or fewer.`);
  if (step.preheader !== undefined && (typeof step.preheader !== 'string' || step.preheader.length > preheaderLimit)) p.push(`Step ${n} preheader must be ${preheaderLimit} characters or fewer.`);
  if (typeof step.body !== 'string' || !step.body.trim()) p.push(`Step ${n} needs a body.`);
  else if (step.body.length > bodyLimit) p.push(`Step ${n} body must be ${bodyLimit} characters or fewer.`);
  if (!Number.isInteger(step.waitDays) || step.waitDays < 0 || step.waitDays > maxWaitDays) p.push(`Step ${n} wait must be a whole number of days from 0 to ${maxWaitDays}.`);
  return p;
}

export type CampaignCheck = { problems: string[]; warnings: string[] };

/** Problems block saving. Warnings never block; real sending would legally need an opt-out line and consent. */
export function validateCampaign(campaign: EmailCampaign): CampaignCheck {
  const problems: string[] = [];
  const warnings: string[] = [];
  if (!campaign || typeof campaign !== 'object') return { problems: ['Campaign is not valid.'], warnings };
  if (typeof campaign.id !== 'string' || !campaign.id || campaign.id.length > 80) problems.push('Campaign needs an id.');
  if (typeof campaign.name !== 'string' || !campaign.name.trim()) problems.push('Name is required.');
  else if (campaign.name.length > campaignNameLimit) problems.push(`Name must be ${campaignNameLimit} characters or fewer.`);
  if (!(campaignKinds as readonly string[]).includes(campaign.kind)) problems.push('Choose a campaign type.');
  if (!(campaignStatuses as readonly string[]).includes(campaign.status)) problems.push('Choose a status from the list.');
  if (typeof campaign.audienceNote !== 'string') problems.push('Audience note must be text.');
  else if (campaign.audienceNote.length > audienceNoteLimit) problems.push(`Audience note must be ${audienceNoteLimit} characters or fewer.`);
  if (!Array.isArray(campaign.steps) || campaign.steps.length < 1) problems.push('Add at least one email.');
  else if (campaign.steps.length > stepLimit) problems.push(`A campaign can have up to ${stepLimit} emails.`);
  else {
    const ids = new Set<string>();
    campaign.steps.forEach((s, i) => {
      problems.push(...stepProblems(s, i + 1));
      if (s && ids.has(s.id)) problems.push('Email steps need unique ids.');
      if (s) ids.add(s.id);
      if (s && typeof s.body === 'string' && s.body.trim() && !hasUnsubscribeLine(s.body)) warnings.push(`Email ${i + 1} has no unsubscribe or opt-out sentence. Real sending would legally need one.`);
    });
  }
  if (typeof campaign.audienceNote === 'string' && !mentionsConsent(campaign.audienceNote)) warnings.push('The audience note does not mention consent. Only people who agreed to hear from you should ever receive these emails.');
  return { problems, warnings };
}

function clean(c: EmailCampaign): EmailCampaign {
  return {
    id: c.id, name: c.name.trim(), kind: c.kind, audienceNote: c.audienceNote, status: c.status,
    steps: c.steps.map((s, i) => {
      const out: CampaignStep = { id: s.id, subject: s.subject.trim(), body: s.body, waitDays: i === 0 ? 0 : s.waitDays };
      if (s.preheader) out.preheader = s.preheader;
      return out;
    }),
  };
}

export function saveCampaign(campaigns: readonly EmailCampaign[], campaign: EmailCampaign): EmailCampaign[] {
  const { problems } = validateCampaign(campaign);
  if (problems.length) throw new Error(problems[0]);
  const next = clean(campaign);
  const exists = campaigns.some(c => c.id === next.id);
  if (!exists && campaigns.length >= campaignLimit) throw new Error(`This browser supports up to ${campaignLimit} campaigns.`);
  return exists ? campaigns.map(c => (c.id === next.id ? next : c)) : [...campaigns, next];
}
export function removeCampaign(campaigns: readonly EmailCampaign[], id: string): EmailCampaign[] {
  return campaigns.filter(c => c.id !== id);
}

export type TimelineEntry = { step: CampaignStep; dayOffset: number };
/** Cumulative day for each email. Step 1 is always day 0. */
export function sequenceTimeline(campaign: Pick<EmailCampaign, 'steps'>): TimelineEntry[] {
  let day = 0;
  return campaign.steps.map((step, i) => { if (i > 0) day += step.waitDays; return { step, dayOffset: day }; });
}
export const timelineLabel = (campaign: Pick<EmailCampaign, 'steps'>) => sequenceTimeline(campaign).map(t => `Day ${t.dayOffset}`).join(', ');

export function countsByStatus(campaigns: readonly EmailCampaign[]): Record<CampaignStatus, number> {
  const counts: Record<CampaignStatus, number> = { draft: 0, ready: 0, archived: 0 };
  for (const c of campaigns) counts[c.status] += 1;
  return counts;
}

export function restoreEmailCampaigns(raw: string | null, profileId: string): EmailCampaign[] {
  if (!profileId) throw new Error('Profile is required.');
  if (raw === null) return [];
  if (raw.length > storageByteLimit) throw new Error('Saved email campaigns are too large. Nothing was overwritten.');
  let values: unknown;
  try { values = JSON.parse(raw); } catch { throw new Error('Saved email campaigns are not valid. Nothing was overwritten.'); }
  if (!Array.isArray(values) || values.length > campaignLimit) throw new Error('Invalid saved email campaigns. Nothing was overwritten.');
  const ids = new Set<string>();
  return values.map(value => {
    const c = value as EmailCampaign;
    if (!c || typeof c !== 'object' || Array.isArray(c) || validateCampaign(c).problems.length) throw new Error('Invalid saved campaign. Nothing was overwritten.');
    if (ids.has(c.id)) throw new Error('Duplicate campaign IDs. Nothing was overwritten.');
    ids.add(c.id);
    return clean(c);
  });
}

/** Writes the full list only if browser storage still holds exactly what this editor last read. */
export function persistEmailCampaigns(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  profileId: string,
  expectedRaw: string | null,
  campaigns: readonly EmailCampaign[],
): string {
  const key = emailCampaignsStorageKey(profileId);
  if (storage.getItem(key) !== expectedRaw) throw new Error('Email campaigns changed in another tab. Your unsaved changes remain; copy them before reloading.');
  const checked = restoreEmailCampaigns(JSON.stringify(campaigns), profileId);
  const raw = JSON.stringify(checked);
  if (raw.length > storageByteLimit) throw new Error('Email campaign storage limit reached. Your unsaved changes remain.');
  storage.setItem(key, raw);
  return raw;
}
