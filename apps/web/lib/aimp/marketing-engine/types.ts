// Marketing Engine (owner request 22 Nov 2026, from "Build your own marketing engine" + the AD_DRAFTS playbook).
// Phase 1A: Brand Brief -> 5 distinct, typed ad angles -> edit -> explicit approval. Nothing here publishes or spends money.

export const goals = ['awareness', 'leads', 'sales'] as const;
export type Goal = (typeof goals)[number];
export const channelModes = ['organic', 'paid'] as const;
export type ChannelMode = (typeof channelModes)[number];

/** The five psychologically distinct approaches from the AD_DRAFTS playbook. Each campaign uses each exactly once. */
export const approaches = ['pattern_interrupt', 'value_contrast', 'curiosity_teaching', 'identification_objection', 'specific_proof'] as const;
export type Approach = (typeof approaches)[number];
export const approachInfo: Record<Approach, { label: string; why: string; format: AdFormat }> = {
  pattern_interrupt: { label: 'Pattern interrupt', why: 'Expose a familiar but overlooked problem in the first 1 to 3 seconds.', format: 'reel_9x16' },
  value_contrast: { label: 'Value contrast', why: 'What people usually buy versus what they actually need.', format: 'static_4x5' },
  curiosity_teaching: { label: 'Curiosity + teaching', why: 'Give a useful framework and earn the click, not fear.', format: 'carousel_4x5' },
  identification_objection: { label: 'Identification + objection', why: 'Make it feel attainable for a real person with real constraints.', format: 'reel_9x16' },
  specific_proof: { label: 'Specific proof', why: 'Show the actual workflow or product so the mechanism feels concrete.', format: 'reel_9x16' },
};

export const adFormats = ['reel_9x16', 'static_4x5', 'carousel_4x5'] as const;
export type AdFormat = (typeof adFormats)[number];

export interface BrandBrief {
  businessName: string;
  niche: string;
  offer: string;
  region: string;
  audience: string;
  goal: Goal;
  channel: ChannelMode;
  tone: string;
  /** Facts the owner states as TRUE (prices, what's included, real results with a source). Only these can back a claim. */
  facts: string[];
  brandColours: string[];
}

export interface StoryboardBeat { atSeconds: number; visual: string; overlay: string; voiceover: string }
export interface Claim { text: string; status: 'verified' | 'hypothesis' }

export interface AdAngle {
  id: string;
  approach: Approach;
  format: AdFormat;
  hook: string;
  primaryCopy: string;
  headline: string;
  cta: string;
  imageBrief: string;
  storyboard: StoryboardBeat[];
  claims: Claim[];
  /** 'needs_validation' when any claim is a hypothesis: show the owner before anything goes out. */
  evidenceStatus: 'verified' | 'needs_validation';
  editedByOwner: boolean;
}

export type CampaignState = 'draft' | 'angles_ready' | 'angle_approved';
export interface Campaign {
  id: string;
  workspaceId: string;
  brief: BrandBrief;
  angles: AdAngle[];
  state: CampaignState;
  approvedAngleId: string | null;
  approvedAt: string | null;
  /** Which writer produced the angles: a model id, or 'demo' when no AI key is set (clearly labelled in the UI). */
  generatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UsageEvent { workspaceId: string; provider: string; operation: string; estimatedCostUsd: number; at: string }
