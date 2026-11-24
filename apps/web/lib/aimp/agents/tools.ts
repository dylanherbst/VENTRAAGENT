// Tool registry: the only actions agents can trigger, each with a permission level. The model never calls providers; the backend
// checks the tool is on this agent's allowlist, the level is allowed, and (for EXTERNAL) that approval + server flags permit it.
import { blueprints, type AgentType } from './presets.ts';

export type ToolLevel = 'read' | 'draft' | 'external';
export interface ToolDef { name: string; level: ToolLevel; description: string; flag?: keyof Flags }
export interface Flags { agentsEnabled: boolean; paidAdsEnabled: boolean; autoSendMessagesEnabled: boolean; publishingEnabled: boolean }

export const tools: Record<string, ToolDef> = {
  'brand.read': { name: 'brand.read', level: 'read', description: 'Read the workspace brand profile and settings.' },
  'metrics.read': { name: 'metrics.read', level: 'read', description: 'Read real, provider-returned metrics.' },
  'marketing.draft_angles': { name: 'marketing.draft_angles', level: 'draft', description: 'Draft five ad angles.' },
  'social.draft_plan': { name: 'social.draft_plan', level: 'draft', description: 'Draft a 7 or 30-day content plan.' },
  'media.generate_image': { name: 'media.generate_image', level: 'draft', description: 'Generate an image for a draft.' },
  'media.render_video': { name: 'media.render_video', level: 'draft', description: 'Render a branded video from a template.' },
  'social.schedule_post': { name: 'social.schedule_post', level: 'external', description: 'Schedule one approved post revision.', flag: 'publishingEnabled' },
  'paid.create_campaign': { name: 'paid.create_campaign', level: 'external', description: 'Create a paid ad campaign (Phase 6, off).', flag: 'paidAdsEnabled' },
  'messages.send': { name: 'messages.send', level: 'external', description: 'Send a message to a customer (off).', flag: 'autoSendMessagesEnabled' },
};

export type ToolDecision = { allowed: true } | { allowed: false; reason: string };

export function authorizeTool(agent: AgentType, tool: string, flags: Flags, ctx: { approved?: boolean } = {}): ToolDecision {
  const t = tools[tool];
  if (!t) return { allowed: false, reason: 'unknown_tool' };
  if (!flags.agentsEnabled) return { allowed: false, reason: 'agents_disabled' };
  if (!blueprints[agent].tools.includes(tool)) return { allowed: false, reason: 'not_on_allowlist' };
  if (t.flag && !flags[t.flag]) return { allowed: false, reason: `${t.flag}_off` };
  if (t.level === 'external' && !ctx.approved) return { allowed: false, reason: 'approval_required' };
  return { allowed: true };
}

export function flagsFromEnv(env: Record<string, string | undefined>): Flags {
  return {
    agentsEnabled: env.AGENTS_ENABLED !== 'false',
    paidAdsEnabled: false, // Phase 6. Ignored even if PAID_META_ADS_ENABLED=true until the paid flow (budget approval, ad account) exists.
    autoSendMessagesEnabled: false,
    publishingEnabled: env.SOCIAL_PUBLISHING_ENABLED === 'true',
  };
}
