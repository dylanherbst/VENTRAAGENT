// Small shared pieces for the AI Team screens: labels, the settings form shape and the payload the save action wants.
import type { TeamView } from './view';

export const PLATFORMS = ['instagram', 'facebook', 'tiktok', 'linkedin'] as const;
export type PlatformId = (typeof PLATFORMS)[number];
export const CATS = ['educational', 'promotional', 'problem_solution', 'product_showcase', 'short_video', 'engagement', 'announcement', 'testimonial', 'local'] as const;
export const label = (s: string): string => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
export const toggle = <T,>(list: T[], x: T): T[] => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x]);

type Config = TeamView['configs']['social'];
export interface ConfigForm {
  enabled: boolean; presetId: string; goals: string; brandVoice: string; avoidPhrases: string; platforms: string[];
  reel: number; image: number; carousel: number; text: number; categories: string[]; customCategories: { name: string; description: string; category: string }[];
  creativeStyle: string; customInstructions: string; approvalMode: 'manual' | 'draft_only'; hashtags: string; location: string; faq: string;
  imagesPerMonth: number; rendersPerMonth: number; aiUsdPerMonth: number;
}

/** The settings form for an agent, from its saved config (or sensible empties when there is none yet). */
export function formOf(x: Config | undefined | null): ConfigForm {
  return {
    enabled: x?.enabled ?? true, presetId: x?.presetId ?? 'fitness', goals: (x?.goals ?? []).join('\n'), brandVoice: x?.brandVoice ?? '', avoidPhrases: (x?.avoidPhrases ?? []).join('\n'),
    platforms: x?.platforms ?? ['instagram'], reel: x?.cadence.reel ?? 0, image: x?.cadence.image ?? 0, carousel: x?.cadence.carousel ?? 0, text: x?.cadence.text ?? 0,
    categories: x?.categories ?? [], customCategories: (x?.customCategories ?? []) as ConfigForm['customCategories'], creativeStyle: x?.creativeStyle ?? '', customInstructions: x?.customInstructions ?? '',
    approvalMode: x?.approvalMode ?? 'manual', hashtags: x?.workflow.find((w) => w.kind === 'add_hashtags')?.value ?? '5', location: x?.workflow.find((w) => w.kind === 'mention_location')?.value ?? '',
    faq: x?.workflow.find((w) => w.kind === 'include_faq')?.value ?? '', imagesPerMonth: x?.limits.imagesPerMonth ?? 60, rendersPerMonth: x?.limits.rendersPerMonth ?? 20, aiUsdPerMonth: x?.limits.aiUsdPerMonth ?? 5,
  };
}

/** What saveConfigAction takes, from the form. */
export function payloadOf(cf: ConfigForm) {
  return {
    enabled: cf.enabled, presetId: cf.presetId, goals: cf.goals, brandVoice: cf.brandVoice, avoidPhrases: cf.avoidPhrases, platforms: cf.platforms,
    cadence: { reel: +cf.reel, image: +cf.image, carousel: +cf.carousel, text: +cf.text },
    categories: cf.categories, customCategories: cf.customCategories, creativeStyle: cf.creativeStyle, customInstructions: cf.customInstructions, approvalMode: cf.approvalMode,
    workflow: [{ kind: 'add_hashtags', value: String(cf.hashtags) }, ...(cf.location ? [{ kind: 'mention_location', value: cf.location }] : []), ...(cf.faq ? [{ kind: 'include_faq', value: cf.faq }] : [])],
    limits: { aiRunsPerMonth: 300, imagesPerMonth: +cf.imagesPerMonth, rendersPerMonth: +cf.rendersPerMonth, aiUsdPerMonth: +cf.aiUsdPerMonth },
  };
}
