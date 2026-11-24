'use server';
// Growth Manager actions on Home: run the next safe step (plan posts, write ads, retry a failed task). Never publishes or sends.
import { availability, checkBusiness } from '../../../start/_server/runtime';
import { agentTeam } from '../../../start/_server/agent-team-runtime';

export async function runPlanItemAction(business: string, action: 'plan_week' | 'write_ads' | 'retry', kind?: string): Promise<{ ok: boolean; message: string }> {
  if (!availability().available || !checkBusiness(business)) return { ok: false, message: 'Not available here.' };
  const t = agentTeam();
  const social = action === 'plan_week' || (action === 'retry' && (kind ?? '').startsWith('retry-social'));
  if (social) { const r = await t.generatePlan(business, { days: 7, campaignId: t.dashboard(business).campaigns[0]?.id ?? null }, 'growth-manager'); return r.ok ? { ok: true, message: `${r.value.postIds.length} posts drafted for you to review.` } : { ok: false, message: 'The Social agent could not finish. Try again shortly.' }; }
  const r = await t.generateAds(business, 'growth-manager');
  return r.ok ? { ok: true, message: 'Five ad angles written for you to review.' } : { ok: false, message: 'The Marketing agent could not finish. Try again shortly.' };
}
