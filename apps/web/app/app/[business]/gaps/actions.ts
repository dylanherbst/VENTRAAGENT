'use server';
// Competitor gaps actions. The workspace is a server constant; nothing here sends or spends. Input is cleaned before it is stored.
import { EXAMPLE_COMPETITORS, STEPS, sanitizeCompetitor, safeUrl } from '../../../../lib/aimp/gaps/analyse';
import type { Coverage, Competitor, Step } from '../../../../lib/aimp/gaps/analyse';
import { availability, checkBusiness } from '../../../start/_server/runtime';
import { listCompetitors, removeCompetitor, replaceCompetitors, saveCompetitor } from './_server/store';

export type GapReply = { ok: true } | { ok: false; message: string };
export interface CompetitorInput { name: string; price: string; ratings: Partial<Record<Step, Coverage>>; sourceUrl: string; friction: string }

const guard = (business: string): GapReply | null => {
  if (!availability().available) return { ok: false, message: 'This page is not switched on here.' };
  if (!checkBusiness(business)) return { ok: false, message: 'That shop was not found.' };
  return null;
};

export async function addCompetitorAction(business: string, input: CompetitorInput): Promise<GapReply> {
  const blocked = guard(business); if (blocked) return blocked;
  const url = safeUrl(input.sourceUrl);
  if (input.sourceUrl.trim() && !url) return { ok: false, message: 'The source link must start with http:// or https://.' };
  const steps: Competitor['steps'] = {};
  for (const s of STEPS) {
    const coverage = input.ratings?.[s] ?? 'unknown';
    steps[s] = { coverage, evidenceUrl: coverage === 'partial' || coverage === 'not_offered' ? url : undefined };
  }
  const c = sanitizeCompetitor({ name: input.name, price: input.price, steps, frictions: input.friction.trim() ? [{ text: input.friction, url }] : [] });
  if (!c) return { ok: false, message: 'Enter the competitor name.' };
  return saveCompetitor(business, c);
}
export async function removeCompetitorAction(business: string, id: string): Promise<GapReply> {
  const blocked = guard(business); if (blocked) return blocked;
  removeCompetitor(business, String(id).slice(0, 40)); return { ok: true };
}
export async function loadExampleAction(business: string): Promise<GapReply> {
  const blocked = guard(business); if (blocked) return blocked;
  if (listCompetitors(business).length) return { ok: false, message: 'Remove your competitors first to load the example.' };
  replaceCompetitors(business, EXAMPLE_COMPETITORS); return { ok: true };
}
