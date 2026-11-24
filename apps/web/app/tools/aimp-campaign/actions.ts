'use server';
import { notFound, redirect } from 'next/navigation';
import { campaignRuntime } from '../../../lib/aimp/campaigns/demo.ts';
import type { CampaignDemo } from '../../../lib/aimp/campaigns/demo.ts';
import { approveCampaign, regenerateCampaign } from '../../../lib/aimp/campaigns/service.ts';
import { demoCtx } from '../../../lib/aimp/catalogue/demo.ts';

const back = (msg?: string): never => redirect(msg ? `/tools/aimp-campaign?msg=${encodeURIComponent(msg)}` : '/tools/aimp-campaign');
const field = (f: FormData, k: string) => (typeof f.get(k) === 'string' ? String(f.get(k)) : '');

/** Every action runs this first: 404 in production unless AIMP_TOOLS_ENABLED=1. */
async function guard(): Promise<CampaignDemo> {
  const p = campaignRuntime();
  if (!p) notFound();
  return p;
}

/** Plan (or re-plan) the campaign with the real generator and save it as the draft. */
export async function regenerate(f: FormData): Promise<void> {
  const rt = await guard();
  const startDate = field(f, 'startDate').trim();
  const r = await regenerateCampaign(
    { store: rt.campaigns, now: () => new Date(), llm: field(f, 'useLlm') === '1' ? rt.registry.llm.adapter : null },
    { ...(await rt.context()), ...(startDate ? { startDate } : {}) },
  );
  if (!r.ok) return back(`Not planned: ${r.errors.map((e) => e.message).join(' ')}`);
  const e = r.campaign.enrichment;
  back(`Draft version ${r.campaign.version} planned. ${e.status === 'applied' ? `AI copy applied (${e.model}).` : e.status === 'fallback' ? `AI copy not used: ${e.reason} The built-in plan was kept.` : 'Built-in plan (no AI call).'}`);
}

/** Approve the draft after re-checking it against the brand, listings and store as they are now. */
export async function approve(f: FormData): Promise<void> {
  const rt = await guard();
  const expected = Number(field(f, 'version'));
  if (!Number.isInteger(expected) || expected <= 0) return back('Not approved: the campaign version was missing or unreadable. Reload the page and approve again.');
  const r = await approveCampaign({ store: rt.campaigns, now: () => new Date() }, await rt.context(), demoCtx.actorUserId, { expectedVersion: expected });
  back(r.ok ? `Version ${r.campaign.version} approved. Nothing is posted from here.` : `Not approved: ${r.errors.map((e) => e.message).join(' ')}`);
}
