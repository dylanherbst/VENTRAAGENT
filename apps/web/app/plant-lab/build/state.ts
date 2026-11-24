// Flow state shared by the server page (initial URL) and the client flow (history updates). No 'use client': pure.
import { businessModels, type BusinessModel } from '../../../lib/aimp/contracts';
import { findNiche } from '../../../lib/aimp/preview/blueprints';
import { site } from '../../../lib/aimp/site-config';

export const steps = ['choose', 'preview', 'launch'] as const;
export type Step = (typeof steps)[number];
export type PlanId = (typeof site.plans)[number]['id'];
export const recommendedPlan: PlanId = 'launch';

export interface FlowState { step: Step; model: BusinessModel | null; niche: string | null; seed: number; plan: PlanId }

type Get = (key: string) => string | null | undefined;

export function parseFlowState(get: Get): FlowState {
  const m = get('model');
  const model = businessModels.find((x) => x === m) ?? null;
  const n = get('niche');
  const niche = model && n && findNiche(model, n) ? n : null;
  const seedNum = Number(get('seed') ?? 0);
  const seed = Number.isInteger(seedNum) && seedNum >= 0 && seedNum < 1000 ? seedNum : 0;
  const s = get('step');
  const step: Step = model && niche && (s === 'preview' || s === 'launch') ? s : 'choose';
  const p = get('plan');
  const plan = site.plans.find((x) => x.id === p)?.id ?? recommendedPlan;
  return { step, model, niche, seed, plan };
}

export function flowQuery(s: FlowState): string {
  const q = new URLSearchParams();
  if (s.model) q.set('model', s.model);
  if (s.niche) q.set('niche', s.niche);
  if (s.seed > 0) q.set('seed', String(s.seed));
  if (s.step !== 'choose') q.set('step', s.step);
  if (s.step === 'launch' && s.plan !== recommendedPlan) q.set('plan', s.plan);
  const str = q.toString();
  return str ? `?${str}` : '';
}
