// Hand-off of the visitor's /plant-lab/build choices to /start sign-up. Pure functions only (no browser or
// server-only APIs beyond btoa/atob, which Node and every browser provide) so /start can import decodeHandoff.
// The payload holds only what the build flow keeps in state (model, niche, seed, plan). The brand name is not
// stored: it is a deterministic result of model + niche + seed, so the reader can regenerate it.
import { businessModels, type BusinessModel } from '../contracts.ts';
import { findNiche } from '../preview/blueprints.ts';
import { site } from '../site-config.ts';

export const HANDOFF_VERSION = 1;
/** Longest accepted encoded value. A real payload is about 100 characters. */
export const HANDOFF_MAX_LENGTH = 300;
const MAX_ID_LENGTH = 48;
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type HandoffPlan = (typeof site.plans)[number]['id'];

export interface HandoffChoices {
  model: BusinessModel;
  niche: string;
  /** Name-variant number from "another name"; 0 to 999. */
  seed: number;
  plan: HandoffPlan;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function cleanId(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s.length > 0 && s.length <= MAX_ID_LENGTH && ID_PATTERN.test(s) ? s : null;
}

/** Validates choices against the real model, niche and plan lists. Returns a clean copy or null. */
export function normaliseChoices(input: unknown): HandoffChoices | null {
  if (!isRecord(input)) return null;
  const model = businessModels.find((m) => m === cleanId(input.model));
  const niche = cleanId(input.niche);
  const plan = site.plans.find((p) => p.id === cleanId(input.plan))?.id;
  const seed = input.seed;
  if (!model || !niche || !plan || !findNiche(model, niche)) return null;
  if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0 || seed > 999) return null;
  return { model, niche, seed, plan };
}

const toBase64Url = (text: string): string => btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function fromBase64Url(value: string): string {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/');
  return atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
}

/** Compact URL-safe value (base64url of a short JSON object), or null when the choices are not valid. */
export function encodeHandoff(choices: HandoffChoices): string | null {
  const c = normaliseChoices(choices);
  if (!c) return null;
  const value = toBase64Url(JSON.stringify({ v: HANDOFF_VERSION, m: c.model, n: c.niche, s: c.seed, p: c.plan }));
  return value.length <= HANDOFF_MAX_LENGTH ? value : null;
}

/** Returns the choices, or null for anything malformed, oversized, wrong version or invalid. Unknown fields are dropped. */
export function decodeHandoff(value: unknown): HandoffChoices | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > HANDOFF_MAX_LENGTH) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBase64Url(value));
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed.v !== HANDOFF_VERSION) return null;
  return normaliseChoices({ model: parsed.m, niche: parsed.n, seed: parsed.s, plan: parsed.p });
}

/** Sign-up link for the launch step: /start with the preview carried in the query. Falls back to a plain /start link. */
export function signupHref(choices: HandoffChoices): string {
  const value = encodeHandoff(choices);
  return value ? `/start?from=build&preview=${value}` : '/start?from=build';
}
