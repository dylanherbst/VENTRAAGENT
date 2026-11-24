import { restoreGrowthPlan } from './local-growth-plan.ts';

/** The growth plan is stored as one JSON object; the account copy is the same object. Throws if it is invalid or belongs to another business. */
export function checkGrowthPlanRaw(raw: string, profileId: string): void {
  if (!restoreGrowthPlan(raw, profileId)) throw new Error('Growth plan is not valid. Your local copy is unchanged.');
}
