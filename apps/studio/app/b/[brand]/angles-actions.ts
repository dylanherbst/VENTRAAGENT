'use server';
// Ad angles for one brand, plus the 100-ad playbook loader. Same engine as the customer app.
import { withBrand } from '../../../lib/server';
import type { OpenBrand } from '../../../../web/lib/aimp/studio/workspace';
import type { AnglesView, Scope } from '../../../lib/views';

const brandOf = (scope: Scope): string => (scope.kind === 'business' ? scope.business : '');
const view = (b: OpenBrand, message: string | null = null, errors: string[] = []): AnglesView =>
  ({ campaigns: b.engine.list(b.ws), writer: b.engine.writerName, demo: b.engine.demo, usage: b.engine.usage(b.ws), message, errors });
const why = (r: { ok: false; error: string; details?: string[] }, msg: Record<string, string>) => ({ message: msg[r.error] ?? 'That did not work. Nothing was changed.', errors: r.details ?? [] });
async function run(scope: Scope, f: (b: OpenBrand) => Promise<{ message?: string; errors?: string[] } | void> | { message?: string; errors?: string[] } | void) {
  return withBrand(brandOf(scope), async (b) => { const r = (await f(b)) ?? {}; return view(b, r.message ?? null, r.errors ?? []); });
}

export async function loadAnglesAction(scope: Scope) { return run(scope, () => undefined); }
export async function createCampaignAction(scope: Scope, brief: unknown) {
  return run(scope, async (b) => {
    const c = b.engine.createCampaign(b.ws, brief);
    if (!c.ok) return why(c, { invalid_brief: 'A few details are missing.' });
    const g = await b.engine.generateAngles(b.ws, c.value.id);
    if (!g.ok) return why(g, { writer_failed: 'The writer could not be reached. Press "Write new angles" to try again.', invalid_output: 'The writer broke our rules, so nothing was kept. Try again.' });
    return { message: b.engine.demo ? 'Five demo angles written. Add an AI key for real ones.' : 'Five angles written. Edit any of them, then approve one.' };
  });
}
export async function importNicheAction(scope: Scope, nicheId: string) {
  return run(scope, (b) => { const r = b.engine.importNiche(b.ws, String(nicheId).slice(0, 4)); return r.ok ? { message: `Loaded the five "${r.value.brief.niche}" ads from your playbook.` } : why(r, { niche_not_found: 'That niche is not in the playbook.' }); });
}
export async function regenerateAction(scope: Scope, campaignId: string) {
  return run(scope, async (b) => { const r = await b.engine.generateAngles(b.ws, String(campaignId)); return r.ok ? { message: 'Five new angles written. Any approval was cleared.' } : why(r, { writer_failed: 'The writer could not be reached.', invalid_output: 'The writer broke our rules, so the old angles were kept.' }); });
}
export async function editAngleAction(scope: Scope, campaignId: string, angleId: string, edit: { hook?: string; headline?: string; primaryCopy?: string; cta?: string; imageBrief?: string }) {
  return run(scope, (b) => { const r = b.engine.editAngle(b.ws, String(campaignId), String(angleId), edit); return r.ok ? { message: 'Saved.' } : why(r, { invalid_edit: 'That edit was not saved.' }); });
}
export async function approveAngleAction(scope: Scope, campaignId: string, angleId: string, confirmHypotheses: boolean) {
  return run(scope, (b) => { const r = b.engine.approveAngle(b.ws, String(campaignId), String(angleId), { confirmHypotheses: confirmHypotheses === true }); return r.ok ? { message: 'Approved. Nothing has been posted.' } : why(r, { claims_unchecked: 'Check the flagged claims first, then tick the box.' }); });
}
export async function unapproveAction(scope: Scope, campaignId: string) {
  return run(scope, (b) => { const r = b.engine.unapprove(b.ws, String(campaignId)); return r.ok ? { message: 'Approval withdrawn.' } : why(r, {}); });
}
