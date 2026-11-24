'use server';
// AI Team actions. The workspace is the business from the URL, checked server-side; nothing the browser sends can pick another
// workspace, publish without approval or switch on paid ads. Runs on demo storage, off wherever the demo tools are off.
import { availability, checkBusiness } from '../../../start/_server/runtime';
import { agentTeam, signedAssetPath } from '../../../start/_server/agent-team-runtime';
import type { Platform } from '../../../../lib/aimp/agents/presets';
import type { TeamView } from './view';

const ACTOR = 'owner';
function ws(business: string): string | null { return availability().available && checkBusiness(business) ? business : null; }

function view(w: string, message: string | null = null, errors: string[] = []): TeamView {
  const t = agentTeam();
  const d = t.dashboard(w);
  const src = (id: string) => {
    const signed = signedAssetPath(w, id);
    if (signed) return signed;
    const a = t.asset(w, id);
    return a?.bytes && a.kind === 'image' && a.bytes.length < 400_000 ? `data:${a.mime};base64,${Buffer.from(a.bytes).toString('base64')}` : null;
  };
  return { ...d, assets: d.assets.map((a) => ({ ...a, src: src(a.id) })), message, errors };
}

type Out = TeamView | null;
async function act(business: string, f: (w: string) => Promise<{ message?: string; errors?: string[] } | void> | { message?: string; errors?: string[] } | void): Promise<Out> {
  const w = ws(business); if (!w) return null;
  try { const r = (await f(w)) ?? {}; return view(w, r.message ?? null, r.errors ?? []); }
  catch (e) { console.error('[ai-team]', e instanceof Error ? e.name : 'error'); return view(w, 'Something went wrong. Nothing was changed.'); }
}

const WHY: Record<string, string> = {
  no_profile: 'Fill in your business first.', invalid_profile: 'A few business details need fixing.', invalid_config: 'Those settings were not saved.', agent_off: 'That agent is switched off in its settings.',
  run_limit: 'You have used this month\'s AI runs.', cost_limit: 'You have reached this month\'s AI spend limit.', image_limit: 'You have used this month\'s images.', render_limit: 'You have used this month\'s videos.',
  provider_failed: 'The service did not respond. Try again in a minute.', invalid_output: 'The AI wrote something that broke our rules, so nothing was kept. Try again.', agents_disabled: 'Agents are switched off on this site.',
  not_found: 'That item is gone.', locked: 'Scheduled or published posts cannot be edited here.', invalid_edit: 'That edit was not saved.', wrong_state: 'That post cannot be approved right now.',
  account_not_connected: 'Connect the account first.', wrong_platform: 'That account is for a different platform.', needs_media: 'Make an image or video for this post first.', claims_unchecked: 'Check the flagged claims, then tick the box.',
  approval_stale: 'The post changed after approval. Approve it again.', publishingEnabled_off: 'Publishing is switched off on this site (SOCIAL_PUBLISHING_ENABLED).', platform_not_supported: 'Publishing to that platform is not switched on yet.',
  approval_required: 'This needs your approval first.', needs_live_media: 'Live posts need real media our server can share.', account_mode_mismatch: 'Reconnect this account with Zernio.', no_template: 'Video templates are not set up yet.',
  paidAdsEnabled_off: 'Paid ads are off. Nothing was created and nothing was spent.', not_published_live: 'Only live published posts have results.',
};
const fail = (r: { ok: false; error: string; details?: string[] }) => ({ message: WHY[r.error] ?? 'That did not work. Nothing was changed.', errors: r.details ?? [] });
const s = (v: unknown, max = 100) => String(v ?? '').slice(0, max);

export async function loadTeamAction(business: string): Promise<Out> { return act(business, () => undefined); }
export async function saveProfileAction(business: string, raw: unknown): Promise<Out> {
  return act(business, (w) => { const r = agentTeam().saveProfile(w, raw, ACTOR); return r.ok ? { message: 'Business saved.' } : fail(r); });
}
export async function saveConfigAction(business: string, agent: 'marketing' | 'social', raw: unknown): Promise<Out> {
  return act(business, (w) => { if (agent !== 'marketing' && agent !== 'social') return { message: 'Unknown agent.' }; const r = agentTeam().saveConfig(w, agent, raw, ACTOR); return r.ok ? { message: `${agent === 'marketing' ? 'Marketing' : 'Social'} settings saved.` } : fail(r); });
}
export async function launchAction(business: string, days: number): Promise<Out> {
  return act(business, async (w) => {
    const r = await agentTeam().launch(w, days === 30 ? 30 : 7, ACTOR);
    if (!r.ads.ok && !r.plan.ok) return fail(r.ads);
    const parts = [r.ads.ok ? 'five ad ideas' : null, r.plan.ok ? `${r.plan.value.postIds.length} posts` : null].filter(Boolean);
    return { message: `Your team wrote ${parts.join(' and ')}. Review them below.${!r.ads.ok ? ` Ads: ${WHY[r.ads.error] ?? r.ads.error}` : ''}${!r.plan.ok ? ` Posts: ${WHY[r.plan.error] ?? r.plan.error}` : ''}` };
  });
}
export async function planAction(business: string, days: number, campaignId: string | null): Promise<Out> {
  return act(business, async (w) => { const r = await agentTeam().generatePlan(w, { days: days === 30 ? 30 : 7, campaignId: campaignId ? s(campaignId) : null }, ACTOR); return r.ok ? { message: `${r.value.postIds.length} posts drafted for ${r.value.days} days.` } : fail(r); });
}
export async function adsAction(business: string): Promise<Out> {
  return act(business, async (w) => { const r = await agentTeam().generateAds(w, ACTOR); return r.ok ? { message: 'Five ad ideas written.' } : fail(r); });
}
export async function editPostAction(business: string, postId: string, edit: { hook?: string; caption?: string; cta?: string; hashtags?: string; date?: string; time?: string }): Promise<Out> {
  return act(business, (w) => { const r = agentTeam().editPost(w, s(postId), edit, ACTOR); return r.ok ? { message: 'Saved as a new version. Approve it when ready.' } : fail(r); });
}
export async function approvePostAction(business: string, postId: string, accountId: string, confirmClaims: boolean): Promise<Out> {
  return act(business, (w) => { const r = agentTeam().approvePost(w, s(postId), { accountId: s(accountId), confirmClaims: confirmClaims === true }, ACTOR); return r.ok ? { message: 'Approved. Press Schedule to send it to your account.' } : fail(r); });
}
export async function schedulePostAction(business: string, postId: string): Promise<Out> {
  return act(business, async (w) => { const r = await agentTeam().schedulePost(w, s(postId), ACTOR); return r.ok ? { message: r.value.publish?.live ? 'Scheduled with Zernio. The status below comes from Zernio.' : 'Mock schedule recorded. Nothing was sent to any social account.' } : fail(r); });
}
export async function imageAction(business: string, target: { type: 'post' | 'angle'; id: string; campaignId?: string }): Promise<Out> {
  return act(business, async (w) => { const r = await agentTeam().generateImage(w, { type: target.type === 'angle' ? 'angle' : 'post', id: s(target.id), campaignId: target.campaignId ? s(target.campaignId) : undefined }, ACTOR); return r.ok ? { message: r.value.live ? 'Image made.' : 'Mock image made (no image key set).' } : fail(r); });
}
export async function videoAction(business: string, target: { type: 'post' | 'angle'; id: string; campaignId?: string }): Promise<Out> {
  return act(business, async (w) => { const r = await agentTeam().renderVideo(w, { type: target.type === 'angle' ? 'angle' : 'post', id: s(target.id), campaignId: target.campaignId ? s(target.campaignId) : undefined }, ACTOR); return r.ok ? { message: r.value.live ? 'Video render started. Press Refresh in a minute.' : 'Mock render started (no Creatomate key set).' } : fail(r); });
}
export async function refreshAction(business: string): Promise<Out> {
  return act(business, async (w) => {
    const t = agentTeam();
    for (const r of t.dashboard(w).renders) if (r.status !== 'completed' && r.status !== 'failed') await t.syncRender(w, r.id);
    await t.syncAccounts(w);
    return { message: 'Refreshed.' };
  });
}
export async function connectAction(business: string, platform: Platform): Promise<{ view: Out; redirect: string | null }> {
  let redirect: string | null = null;
  const v = await act(business, async (w) => {
    if (!['instagram', 'facebook', 'tiktok', 'linkedin'].includes(platform)) return { message: 'Unknown platform.' };
    const base = process.env.APP_PUBLIC_URL?.replace(/\/$/, '') ?? '';
    const r = await agentTeam().connectStart(w, platform, `${base}/app/${w}/ai-team?connected=${platform}`, ACTOR);
    if (!r.ok) return fail(r);
    redirect = r.value.url;
    return { message: r.value.account ? `Mock ${platform} account connected for testing. Nothing can reach a real account in mock mode.` : `Opening ${platform} to connect...` };
  });
  return { view: v, redirect };
}
export async function disconnectAction(business: string, accountId: string): Promise<Out> {
  return act(business, (w) => { const r = agentTeam().disconnect(w, s(accountId), ACTOR); return r.ok ? { message: 'Disconnected.' } : fail(r); });
}
