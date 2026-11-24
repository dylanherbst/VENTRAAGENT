'use server';
// The AI Team for one of the owner's brands (same agents as the customer app). Names match the shared TeamClient component;
// its "business" argument is the brand id here. Every action checks the owner session and saves the brand afterwards.
import { withBrand } from '../../../lib/server';
import type { OpenBrand } from '../../../../web/lib/aimp/studio/workspace';
import type { Platform } from '../../../../web/lib/aimp/agents/presets';
import type { TeamView } from '../../../lib/views';

const ACTOR = 'owner';
const WHY: Record<string, string> = {
  no_profile: 'Fill in the business first.', invalid_profile: 'A few business details need fixing.', invalid_config: 'Those settings were not saved.', agent_off: 'That agent is switched off in its settings.',
  run_limit: 'This month\'s AI runs are used up (raise it in Agent settings).', cost_limit: 'This month\'s AI spend limit is reached (raise it in Agent settings).', image_limit: 'This month\'s images are used up.', render_limit: 'This month\'s videos are used up.',
  provider_failed: 'The service did not respond. Try again in a minute.', invalid_output: 'The AI wrote something that broke our rules, so nothing was kept. Try again.', agents_disabled: 'Agents are switched off (AGENTS_ENABLED).',
  not_found: 'That item is gone.', locked: 'Scheduled or published posts cannot be edited here.', invalid_edit: 'That edit was not saved.', wrong_state: 'That post cannot be approved right now.',
  account_not_connected: 'Connect the account first.', wrong_platform: 'That account is for a different platform.', needs_media: 'Make an image or video for this post first.', claims_unchecked: 'Check the flagged claims, then tick the box.',
  approval_stale: 'The post changed after approval. Approve it again.', publishingEnabled_off: 'Real publishing is switched off (SOCIAL_PUBLISHING_ENABLED).', platform_not_supported: 'Publishing to that platform is not switched on yet.',
  approval_required: 'This needs your approval first.', needs_live_media: 'Live posts need real media our server can share.', account_mode_mismatch: 'Reconnect this account with Zernio.', no_template: 'Video templates are not set up yet.',
};
const fail = (r: { ok: false; error: string; details?: string[] }) => ({ message: WHY[r.error] ?? 'That did not work. Nothing was changed.', errors: r.details ?? [] });
const s = (v: unknown, max = 100) => String(v ?? '').slice(0, max);
type R = { message?: string; errors?: string[] } | void;

function view(b: OpenBrand, message: string | null = null, errors: string[] = []): TeamView {
  const d = b.team.dashboard(b.ws);
  return { ...d, assets: d.assets.map((a) => ({ ...a, src: a.kind === 'image' ? `/api/media/${b.ws}/${a.id}` : null })), message, errors };
}
async function act(brand: string, f: (b: OpenBrand) => Promise<R> | R): Promise<TeamView | null> {
  return withBrand(brand, async (b) => {
    try { const r = (await f(b)) ?? {}; return view(b, r.message ?? null, r.errors ?? []); }
    catch (e) { console.error('[studio team]', e instanceof Error ? e.name : 'error'); return view(b, 'Something went wrong. Nothing was changed.'); }
  });
}

export async function loadTeamAction(brand: string) { return act(brand, () => undefined); }
export async function saveProfileAction(brand: string, raw: unknown) { return act(brand, (b) => { const r = b.team.saveProfile(b.ws, raw, ACTOR); return r.ok ? { message: 'Business saved.' } : fail(r); }); }
export async function saveConfigAction(brand: string, agent: 'marketing' | 'social', raw: unknown) {
  return act(brand, (b) => { if (agent !== 'marketing' && agent !== 'social') return { message: 'Unknown agent.' }; const r = b.team.saveConfig(b.ws, agent, raw, ACTOR); return r.ok ? { message: 'Settings saved.' } : fail(r); });
}
export async function launchAction(brand: string, days: number) {
  return act(brand, async (b) => {
    const r = await b.team.launch(b.ws, days === 30 ? 30 : 7, ACTOR);
    if (!r.ads.ok && !r.plan.ok) return fail(r.ads);
    const parts = [r.ads.ok ? 'five ad ideas' : null, r.plan.ok ? `${r.plan.value.postIds.length} posts` : null].filter(Boolean);
    return { message: `Your team wrote ${parts.join(' and ')}.${!r.ads.ok ? ` Ads: ${WHY[r.ads.error] ?? r.ads.error}` : ''}${!r.plan.ok ? ` Posts: ${WHY[r.plan.error] ?? r.plan.error}` : ''}` };
  });
}
export async function planAction(brand: string, days: number, campaignId: string | null) {
  return act(brand, async (b) => { const r = await b.team.generatePlan(b.ws, { days: days === 30 ? 30 : 7, campaignId: campaignId ? s(campaignId) : null }, ACTOR); return r.ok ? { message: `${r.value.postIds.length} posts drafted for ${r.value.days} days.` } : fail(r); });
}
export async function adsAction(brand: string) { return act(brand, async (b) => { const r = await b.team.generateAds(b.ws, ACTOR); return r.ok ? { message: 'Five ad ideas written.' } : fail(r); }); }
export async function editPostAction(brand: string, postId: string, edit: { hook?: string; caption?: string; cta?: string; hashtags?: string; date?: string; time?: string }) {
  return act(brand, (b) => { const r = b.team.editPost(b.ws, s(postId), edit, ACTOR); return r.ok ? { message: 'Saved as a new version. Approve it when ready.' } : fail(r); });
}
export async function approvePostAction(brand: string, postId: string, accountId: string, confirmClaims: boolean) {
  return act(brand, (b) => { const r = b.team.approvePost(b.ws, s(postId), { accountId: s(accountId), confirmClaims: confirmClaims === true }, ACTOR); return r.ok ? { message: 'Approved. Press Schedule to send it.' } : fail(r); });
}
export async function schedulePostAction(brand: string, postId: string) {
  return act(brand, async (b) => { const r = await b.team.schedulePost(b.ws, s(postId), ACTOR); return r.ok ? { message: r.value.publish?.live ? 'Scheduled with Zernio.' : 'Mock schedule recorded. Nothing was sent to any social account.' } : fail(r); });
}
const target = (t: { type: 'post' | 'angle'; id: string; campaignId?: string }) => ({ type: t.type === 'angle' ? 'angle' as const : 'post' as const, id: s(t.id), campaignId: t.campaignId ? s(t.campaignId) : undefined });
export async function imageAction(brand: string, t: { type: 'post' | 'angle'; id: string; campaignId?: string }) {
  return act(brand, async (b) => { const r = await b.team.generateImage(b.ws, target(t), ACTOR); return r.ok ? { message: r.value.live ? 'Image made.' : 'Mock image made (no image key set).' } : fail(r); });
}
export async function videoAction(brand: string, t: { type: 'post' | 'angle'; id: string; campaignId?: string }) {
  return act(brand, async (b) => { const r = await b.team.renderVideo(b.ws, target(t), ACTOR); return r.ok ? { message: r.value.live ? 'Video render started. Press Refresh in a minute.' : 'Mock render started (no Creatomate key set).' } : fail(r); });
}
export async function refreshAction(brand: string) {
  return act(brand, async (b) => { for (const r of b.team.dashboard(b.ws).renders) if (r.status !== 'completed' && r.status !== 'failed') await b.team.syncRender(b.ws, r.id); await b.team.syncAccounts(b.ws); return { message: 'Refreshed.' }; });
}
export async function connectAction(brand: string, platform: Platform): Promise<{ view: TeamView | null; redirect: string | null }> {
  let redirect: string | null = null;
  const v = await act(brand, async (b) => {
    if (!['instagram', 'facebook', 'tiktok', 'linkedin'].includes(platform)) return { message: 'Unknown platform.' };
    const base = process.env.STUDIO_PUBLIC_URL?.replace(/\/$/, '') ?? '';
    const r = await b.team.connectStart(b.ws, platform, `${base}/b/${b.ws}?connected=${platform}`, ACTOR);
    if (!r.ok) return fail(r);
    redirect = r.value.url;
    return { message: r.value.account ? `Mock ${platform} account connected for testing. Nothing can reach a real account in mock mode.` : `Opening ${platform} to connect...` };
  });
  return { view: v, redirect };
}
export async function disconnectAction(brand: string, accountId: string) { return act(brand, (b) => { const r = b.team.disconnect(b.ws, s(accountId), ACTOR); return r.ok ? { message: 'Disconnected.' } : fail(r); }); }
