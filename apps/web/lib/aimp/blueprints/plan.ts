// generateLaunchPlan: validated inputs + a versioned blueprint -> one deterministic launch plan (AMP-011).
// No clock, no randomness, no network: the same blueprint id+version and the same inputs always give the same plan.
// Failures come back as a typed result with plain-English messages; nothing is thrown for flow control.
import { findNiche } from '../preview/blueprints.ts';
import { validateBlueprint } from './schema.ts';
import type { BlueprintDefinition, BlueprintFamily, CostLine, InputSpec, LaunchContentItem, OutputFormat, OutputSection } from './schema.ts';

export interface InputIssue { field: string; message: string }

export type PlanInputs = Record<string, string | number>;

export interface LaunchPlanStep {
  order: number;
  title: string;
  ownerAction: string;
  hours: number;
  /** Week of your schedule (1 = first week) in which this step finishes at your weekly hours. */
  finishesInWeek: number;
}

export interface LaunchPlan {
  blueprint: { id: string; version: string; family: BlueprintFamily; engine: 'document' };
  inputs: PlanInputs;
  product: { title: string; audience: string; formats: OutputFormat[]; totalPages: number; sections: OutputSection[] };
  steps: LaunchPlanStep[];
  schedule: { totalHours: number; weeksToLaunch: number };
  cost: {
    currency: 'AUD';
    lines: CostLine[];
    totalMinor: number;
    budgetMinor: number;
    withinBudget: boolean;
    shortfallMinor: number;
    /** Sales at the chosen price needed to cover the launch cost, before payment fees and GST. 0 when the cost is 0. */
    salesToCoverCost: number;
  };
  qa: string[];
  fulfilment: BlueprintDefinition['fulfilment'];
  marketing: {
    channels: string[];
    /** Days are counted from the launch day (day 0). */
    schedule: LaunchContentItem[];
    /** Pin ideas from the tested preview blueprint when the niche matches one of its niches. */
    pinIdeas: { title: string; board: string }[];
  };
  notes: string[];
}

export type PlanResult = { ok: true; plan: LaunchPlan } | { ok: false; errors: InputIssue[] };

function checkInput(spec: InputSpec, raw: unknown, out: PlanInputs, errors: InputIssue[]): void {
  const unit = spec.unit ? ` (${spec.unit})` : '';
  if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) {
    errors.push({ field: spec.key, message: `${spec.label} is required.` });
    return;
  }
  if (spec.type === 'text') {
    if (typeof raw !== 'string') { errors.push({ field: spec.key, message: `${spec.label} must be text.` }); return; }
    const v = raw.trim().replace(/\s+/g, ' ');
    if (v.length < spec.min || v.length > spec.max) {
      errors.push({ field: spec.key, message: `${spec.label} must be between ${spec.min} and ${spec.max} characters.` });
      return;
    }
    out[spec.key] = v;
    return;
  }
  if (typeof raw !== 'number' || !Number.isInteger(raw)) {
    errors.push({ field: spec.key, message: `${spec.label} must be a whole number${unit}.` });
    return;
  }
  if (raw < spec.min || raw > spec.max) {
    errors.push({ field: spec.key, message: `${spec.label} must be between ${spec.min} and ${spec.max}${unit}.` });
    return;
  }
  out[spec.key] = raw;
}

/** Check inputs against a blueprint's required inputs. Unknown extra keys are ignored. */
export function validatePlanInputs(blueprint: BlueprintDefinition, inputs: unknown):
  { ok: true; inputs: PlanInputs } | { ok: false; errors: InputIssue[] } {
  if (typeof inputs !== 'object' || inputs === null || Array.isArray(inputs)) {
    return { ok: false, errors: [{ field: '', message: 'The inputs must be an object with a value for each required field.' }] };
  }
  const errors: InputIssue[] = [];
  const out: PlanInputs = {};
  for (const spec of blueprint.requiredInputs) checkInput(spec, (inputs as Record<string, unknown>)[spec.key], out, errors);
  return errors.length ? { ok: false, errors } : { ok: true, inputs: out };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function generateLaunchPlan(blueprint: BlueprintDefinition, inputs: unknown): PlanResult {
  const bp = validateBlueprint(blueprint);
  if (!bp.ok) return { ok: false, errors: bp.errors.map((message) => ({ field: 'blueprint', message })) };
  const checked = validatePlanInputs(blueprint, inputs);
  if (!checked.ok) return checked;
  const v = checked.inputs;
  const niche = String(v.niche ?? '');
  const audience = String(v.audience ?? '');
  const price = Number(v.pricePointMinor);
  const weekly = Number(v.weeklyHours);
  if (!(price > 0) || !(weekly > 0)) {
    return { ok: false, errors: [{ field: 'blueprint', message: 'The price point and weekly hours must be above zero.' }] };
  }
  const budget = Number(v.budgetMinor ?? 0);

  let cumulative = 0;
  const steps: LaunchPlanStep[] = blueprint.steps.map((s, i) => {
    cumulative += s.hours;
    return { order: i + 1, title: s.title, ownerAction: s.ownerAction, hours: s.hours, finishesInWeek: Math.max(1, Math.ceil(cumulative / weekly)) };
  });

  const lines = blueprint.costDefaults.lines.map((l) => ({ ...l }));
  const totalMinor = lines.reduce((sum, l) => sum + l.amountMinor, 0);
  const sections = blueprint.output.sections.map((s) => ({ ...s }));

  const previewNiche = findNiche(blueprint.businessModel, slug(niche));
  const pinIdeas = (previewNiche?.pins ?? []).map((p) => ({ title: p.title, board: p.board }));

  const plan: LaunchPlan = {
    blueprint: { id: blueprint.id, version: blueprint.version, family: blueprint.family, engine: blueprint.engine },
    inputs: v,
    product: {
      title: `${niche} ${blueprint.title.toLowerCase()}`,
      audience,
      formats: [...blueprint.output.formats],
      totalPages: sections.reduce((sum, s) => sum + s.pages, 0),
      sections,
    },
    steps,
    schedule: { totalHours: cumulative, weeksToLaunch: steps.length ? steps[steps.length - 1]!.finishesInWeek : 0 },
    cost: {
      currency: 'AUD',
      lines,
      totalMinor,
      budgetMinor: budget,
      withinBudget: totalMinor <= budget,
      shortfallMinor: Math.max(0, totalMinor - budget),
      salesToCoverCost: totalMinor === 0 ? 0 : Math.ceil(totalMinor / price),
    },
    qa: [...blueprint.qaChecklist],
    fulfilment: { ...blueprint.fulfilment },
    marketing: {
      channels: [...blueprint.marketing.channels],
      schedule: blueprint.marketing.launchContent.map((c) => ({ ...c })).sort((a, b) => a.day - b.day || a.title.localeCompare(b.title)),
      pinIdeas,
    },
    notes: [
      'This plan is a checklist and an estimate. It does not promise sales or income.',
      'Nothing is published, sent or charged until you approve it.',
      ...(pinIdeas.length === 0 ? ['No tested pin ideas for this niche yet; write your own pins and check them before posting.'] : []),
    ],
  };
  return { ok: true, plan };
}
