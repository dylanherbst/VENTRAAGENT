'use server';
// Ad angles (Marketing Engine Phase 1A). Scope is either one business's workspace or the owner's standalone studio. Both run on demo
// storage and are off wherever the demo tools are off.
import { availability, checkBusiness } from '../../../../start/_server/runtime';
import { marketingEngine, STUDIO_WORKSPACE } from '../../../../start/_server/marketing-engine-runtime';
import type { AnglesView, Scope } from './view';

const MAX_CAMPAIGNS = 30;

function ws(scope: Scope): string | null {
  if (!availability().available) return null;
  if (scope.kind === 'studio') return STUDIO_WORKSPACE;
  return checkBusiness(scope.business) ? scope.business : null;
}

function view(w: string, message: string | null = null, errors: string[] = []): AnglesView {
  const e = marketingEngine();
  return { campaigns: e.list(w), writer: e.writerName, demo: e.demo, usage: e.usage(w), message, errors };
}

type Out = AnglesView | null;
const run = async (scope: Scope, f: (w: string) => Promise<{ message?: string; errors?: string[] } | void> | { message?: string; errors?: string[] } | void): Promise<Out> => {
  const w = ws(scope);
  if (!w) return null;
  const r = (await f(w)) ?? {};
  return view(w, r.message ?? null, r.errors ?? []);
};
const why = (r: { ok: false; error: string; details?: string[] }, msg: Record<string, string>) => ({ message: msg[r.error] ?? 'That did not work. Nothing was changed.', errors: r.details ?? [] });

export async function loadAnglesAction(scope: Scope): Promise<Out> { return run(scope, () => undefined); }

export async function createCampaignAction(scope: Scope, brief: unknown): Promise<Out> {
  return run(scope, async (w) => {
    const e = marketingEngine();
    if (e.list(w).length >= MAX_CAMPAIGNS) return { message: `You have ${MAX_CAMPAIGNS} campaigns, the most this test storage keeps.` };
    const c = e.createCampaign(w, brief);
    if (!c.ok) return why(c, { invalid_brief: 'A few details are missing.' });
    const g = await e.generateAngles(w, c.value.id);
    if (!g.ok) return why(g, { writer_failed: 'The writer could not be reached. Your brief is saved: press "Write new angles" to try again.', invalid_output: 'The writer returned angles that broke our rules, so none were kept. Try again.' });
    return { message: e.demo ? 'Five demo angles written from your brief. Add an AI key for real ones.' : 'Five angles written. Edit any of them, then approve one.' };
  });
}

export async function importNicheAction(nicheId: string): Promise<Out> {
  return run({ kind: 'studio' }, (w) => {
    const e = marketingEngine();
    if (e.list(w).length >= MAX_CAMPAIGNS) return { message: `You have ${MAX_CAMPAIGNS} campaigns, the most this test storage keeps.` };
    const r = e.importNiche(w, String(nicheId).slice(0, 4));
    return r.ok ? { message: `Loaded the five "${r.value.brief.niche}" ads from your playbook.` } : why(r, { niche_not_found: 'That niche is not in the playbook.' });
  });
}

export async function regenerateAction(scope: Scope, campaignId: string): Promise<Out> {
  return run(scope, async (w) => {
    const r = await marketingEngine().generateAngles(w, String(campaignId));
    return r.ok ? { message: 'Five new angles written. Any approval was cleared.' } : why(r, { not_found: 'That campaign is gone.', writer_failed: 'The writer could not be reached. Nothing was changed.', invalid_output: 'The writer returned angles that broke our rules, so the old ones were kept.' });
  });
}

export async function editAngleAction(scope: Scope, campaignId: string, angleId: string, edit: { hook?: string; headline?: string; primaryCopy?: string; cta?: string; imageBrief?: string }): Promise<Out> {
  return run(scope, (w) => {
    const r = marketingEngine().editAngle(w, String(campaignId), String(angleId), edit);
    return r.ok ? { message: 'Saved.' } : why(r, { invalid_edit: 'That edit was not saved.' });
  });
}

export async function approveAngleAction(scope: Scope, campaignId: string, angleId: string, confirmHypotheses: boolean): Promise<Out> {
  return run(scope, (w) => {
    const r = marketingEngine().approveAngle(w, String(campaignId), String(angleId), { confirmHypotheses: confirmHypotheses === true });
    return r.ok ? { message: 'Approved. Nothing has been posted: images, video and scheduling come next and each needs your OK.' } : why(r, { claims_unchecked: 'Check the flagged claims first, then tick the box.' });
  });
}

export async function unapproveAction(scope: Scope, campaignId: string): Promise<Out> {
  return run(scope, (w) => { const r = marketingEngine().unapprove(w, String(campaignId)); return r.ok ? { message: 'Approval withdrawn.' } : why(r, {}); });
}
