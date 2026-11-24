// Where the AI Team shows up in the two-path guide. Pure data, no Next or React, so the node tests can check it.
// Rule (front-end call, 23 Nov 2026, from the backend suggestion): a new seller does not see AI Team until their first product is approved.
// It then glows once the shop is live and nothing has been approved yet, but only when the checklist's own next step is the first order
// (or everything else is done), so payments and brand keep priority. Existing sellers always have the full menu.
import type { Guide, GuideStep } from '../../../../lib/aimp/home/path';

export interface AiTeamGuideInput {
  base: string;
  productDone: boolean;
  storeLive: boolean;
  /** Id of the checklist step that is next now, or null when every step is done. */
  currentId: string | null;
  /** True once any post has been approved, scheduled or published. */
  posted: boolean;
}

export function withAiTeam(g: Guide, i: AiTeamGuideInput): Guide {
  if (g.path !== 'new' || !i.productDone) return g;
  const glow = i.storeLive && !i.posted && (i.currentId === 'first_order' || i.currentId === null);
  const step: GuideStep = { label: 'Set up your AI Team', href: `${i.base}/ai-team`, segment: 'ai-team', tone: glow ? 'next' : i.posted ? 'done' : 'later', locked: false };
  const steps = g.steps.map((s) => (glow && s.tone === 'next' ? { ...s, tone: 'later' as const, locked: false } : s));
  const at = steps.findIndex((s) => s.segment === 'marketing');
  if (at >= 0) steps.splice(at, 0, step); else steps.push(step);
  const allowed = g.allowedSegments === 'all' ? 'all' : [...new Set([...g.allowedSegments, 'ai-team'])];
  return { ...g, steps, allowedSegments: allowed, glowSegment: glow ? 'ai-team' : g.glowSegment };
}
