// Versioned blueprint schema for the shared document engine (AMP-011).
// A blueprint is data: it says what a product family needs, makes, costs, checks, delivers and how it is launched.
// Validation never throws; it returns plain-English problems the owner can act on.
import { businessModels, engineFor } from '../contracts.ts';
import type { BusinessModel } from '../contracts.ts';

export const blueprintFamilies = ['planner', 'tracker', 'checklist', 'niche-kit'] as const;
export type BlueprintFamily = (typeof blueprintFamilies)[number];
export const outputFormats = ['PDF', 'ZIP'] as const;
export type OutputFormat = (typeof outputFormats)[number];

export interface InputSpec {
  key: string;
  label: string;
  type: 'text' | 'integer';
  /** Text: min/max length. Integer: min/max value. */
  min: number;
  max: number;
  /** Shown beside the field and in error messages, e.g. "whole cents". */
  unit?: string;
}

export interface OutputSection { title: string; pages: number }
export interface CostLine { label: string; amountMinor: number; note: string }
export interface LaunchContentItem { day: number; channel: string; title: string }
export interface BuildStep { title: string; ownerAction: string; hours: number }

export interface BlueprintDefinition {
  id: string;
  /** Semver, e.g. 1.0.0. */
  version: string;
  family: BlueprintFamily;
  /** All four families share the document engine. */
  engine: 'document';
  /** Existing production business model this blueprint belongs to (lib/aimp/contracts.ts). */
  businessModel: BusinessModel;
  title: string;
  summary: string;
  requiredInputs: InputSpec[];
  output: { formats: OutputFormat[]; sections: OutputSection[] };
  /** AUD, whole cents. */
  costDefaults: { currency: 'AUD'; lines: CostLine[] };
  steps: BuildStep[];
  qaChecklist: string[];
  fulfilment: { method: 'digital-download'; delivery: string; supportNote: string };
  marketing: { channels: string[]; launchContent: LaunchContentItem[] };
}

export interface ValidationResult { ok: boolean; errors: string[] }

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isSemver(v: unknown): v is string {
  return typeof v === 'string' && SEMVER.test(v);
}

/** Negative when a is older than b. Both must be valid semver. */
export function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i]! - pb[i]!;
  return 0;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
/** Finite whole number at or above min (Infinity and NaN are never accepted). */
const wholeNum = (v: unknown, min: number): v is number => typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v) && v >= min;

/** Inputs the launch plan reads; every blueprint must declare them with the right type. */
export const plannerInputKeys: Record<string, 'text' | 'integer'> = {
  niche: 'text', audience: 'text', pricePointMinor: 'integer', weeklyHours: 'integer', budgetMinor: 'integer',
};

export function validateBlueprint(input: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isObj(input)) return { ok: false, errors: ['The blueprint must be an object.'] };
  const b = input;

  if (!nonEmpty(b.id) || !ID.test(b.id)) errors.push('The blueprint id must be lower-case words joined by dashes, like "printable-planner".');
  if (!isSemver(b.version)) errors.push('The version must look like 1.0.0 (three whole numbers separated by dots).');
  if (!blueprintFamilies.includes(b.family as BlueprintFamily)) errors.push(`The family must be one of: ${blueprintFamilies.join(', ')}.`);
  if (b.engine !== 'document') errors.push('The engine must be "document"; planners, trackers, checklists and niche kits all use the document engine.');
  if (!businessModels.includes(b.businessModel as BusinessModel)) {
    errors.push(`The business model must be one of: ${businessModels.join(', ')}.`);
  } else if (b.engine === 'document' && !engineFor[b.businessModel as BusinessModel].includes('document')) {
    errors.push(`The business model "${String(b.businessModel)}" does not use the document engine.`);
  }
  if (!nonEmpty(b.title)) errors.push('The blueprint needs a title.');
  if (!nonEmpty(b.summary)) errors.push('The blueprint needs a one-line summary.');

  if (!Array.isArray(b.requiredInputs) || b.requiredInputs.length === 0) {
    errors.push('List at least one required input.');
  } else {
    const keys = new Set<string>();
    b.requiredInputs.forEach((raw, i) => {
      const n = i + 1;
      if (!isObj(raw)) { errors.push(`Required input ${n} must be an object.`); return; }
      if (!nonEmpty(raw.key)) errors.push(`Required input ${n} needs a key.`);
      else if (keys.has(raw.key)) errors.push(`The input "${raw.key}" is listed twice.`);
      else keys.add(raw.key);
      if (!nonEmpty(raw.label)) errors.push(`Required input ${n} needs a label.`);
      if (raw.type !== 'text' && raw.type !== 'integer') errors.push(`Required input ${n} must be type "text" or "integer".`);
      if (!wholeNum(raw.min, 0) || !wholeNum(raw.max, 0) || (raw.min as number) > (raw.max as number)) {
        errors.push(`Required input ${n} needs whole-number limits with min not above max.`);
      }
    });
    for (const [key, type] of Object.entries(plannerInputKeys)) {
      const spec = (b.requiredInputs as unknown[]).find((r) => isObj(r) && r.key === key) as Record<string, unknown> | undefined;
      if (!spec) errors.push(`The required inputs must include "${key}"; the launch plan needs it.`);
      else if (spec.type !== type) errors.push(`The input "${key}" must be type "${type}".`);
      else if ((key === 'pricePointMinor' || key === 'weeklyHours') && !(typeof spec.min === 'number' && spec.min >= 1)) {
        errors.push(`The input "${key}" must have a minimum of at least 1.`);
      }
    }
  }

  const out = b.output;
  if (!isObj(out)) {
    errors.push('The output spec is missing.');
  } else {
    if (!Array.isArray(out.formats) || out.formats.length === 0 || !out.formats.every((f) => outputFormats.includes(f as OutputFormat))) {
      errors.push(`Output formats must be a non-empty list of: ${outputFormats.join(', ')}.`);
    }
    if (!Array.isArray(out.sections) || out.sections.length === 0) {
      errors.push('The output needs at least one page section.');
    } else {
      out.sections.forEach((s, i) => {
        if (!isObj(s) || !nonEmpty(s.title) || !wholeNum(s.pages, 1)) errors.push(`Page section ${i + 1} needs a title and at least one page.`);
      });
    }
  }

  const cost = b.costDefaults;
  if (!isObj(cost) || cost.currency !== 'AUD' || !Array.isArray(cost.lines)) {
    errors.push('Cost defaults must be in AUD with a list of cost lines.');
  } else {
    cost.lines.forEach((l, i) => {
      if (!isObj(l) || !nonEmpty(l.label) || !wholeNum(l.amountMinor, 0) || !nonEmpty(l.note)) {
        errors.push(`Cost line ${i + 1} needs a label, a note and an amount in whole cents (zero or more).`);
      }
    });
  }

  if (!Array.isArray(b.steps) || b.steps.length === 0) {
    errors.push('List at least one build step.');
  } else {
    b.steps.forEach((s, i) => {
      if (!isObj(s) || !nonEmpty(s.title) || !nonEmpty(s.ownerAction) || typeof s.hours !== 'number' || !Number.isFinite(s.hours) || s.hours < 0) {
        errors.push(`Build step ${i + 1} needs a title, an owner action and hours of zero or more.`);
      }
    });
  }

  if (!Array.isArray(b.qaChecklist) || b.qaChecklist.length === 0 || !b.qaChecklist.every(nonEmpty)) {
    errors.push('The QA checklist needs at least one non-empty check.');
  }

  const f = b.fulfilment;
  if (!isObj(f) || f.method !== 'digital-download' || !nonEmpty(f.delivery) || !nonEmpty(f.supportNote)) {
    errors.push('Fulfilment must be a digital download with delivery and support notes.');
  }

  const m = b.marketing;
  if (!isObj(m) || !Array.isArray(m.channels) || m.channels.length === 0 || !m.channels.every(nonEmpty)) {
    errors.push('Marketing needs at least one channel.');
  } else if (!Array.isArray(m.launchContent) || m.launchContent.length === 0) {
    errors.push('Marketing needs at least one launch content item.');
  } else {
    const channels = m.channels as string[];
    m.launchContent.forEach((c, i) => {
      if (!isObj(c) || !wholeNum(c.day, 0) || !nonEmpty(c.title) || !nonEmpty(c.channel)) {
        errors.push(`Launch content ${i + 1} needs a day number (zero or more), a channel and a title.`);
      } else if (!channels.includes(c.channel as string)) {
        errors.push(`Launch content ${i + 1} uses the channel "${String(c.channel)}", which is not in the channel list.`);
      }
    });
  }

  return { ok: errors.length === 0, errors };
}
