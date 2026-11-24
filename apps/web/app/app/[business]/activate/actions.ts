'use server';
// Existing-business onboarding, steps 2 to 6. Everything is saved to the ONE shared business profile (then copied to the Sales
// agent), so the three agents start from the same facts. AI suggestions are drafts the owner reviews; nothing is invented as fact.
import { availability, checkBusiness } from '../../../start/_server/runtime';
import { agentTeam, agentTextModel } from '../../../start/_server/agent-team-runtime';
import { sandbox, live } from '../../../start/_server/setter-runtime';
import { syncKnowledge } from '../../../start/_server/knowledge-sync';
import { readPublicSite } from '../../../../lib/aimp/growth/site-reader';
import { parseJson } from '../../../../lib/aimp/agents/llm';
import type { BusinessProfile } from '../../../../lib/aimp/agents/team';

export interface ActivateView { profile: BusinessProfile | null; aiLive: boolean; accounts: { id: string; platform: string; username: string | null; live: boolean }[]; publishingLive: boolean; setterMode: string; message: string | null; errors: string[] }
export interface Suggestion { description?: string; location?: string; products?: string[]; audience?: string; painPoints?: string[]; usps?: string[]; source: string }

const ok = (b: string) => availability().available && checkBusiness(b);
function view(b: string, message: string | null = null, errors: string[] = []): ActivateView {
  const t = agentTeam(), d = t.dashboard(b);
  const sb = sandbox(b);
  return { profile: t.profile(b), aiLive: d.providers.text !== 'demo', accounts: d.accounts.filter((a) => a.state === 'connected').map((a) => ({ id: a.id, platform: a.platform, username: a.username, live: a.live })),
    publishingLive: d.providers.publishing === 'live', setterMode: sb?.store.config(sb.ws)?.mode ?? 'draft_only', message, errors };
}

export async function loadActivateAction(business: string): Promise<ActivateView | null> { return ok(business) ? view(business) : null; }

export async function saveKnowledgeAction(business: string, patch: Record<string, unknown>): Promise<ActivateView | null> {
  if (!ok(business)) return null;
  const t = agentTeam(), cur = t.profile(business);
  if (!cur) return view(business, 'Start with step 1 first.');
  const r = t.saveProfile(business, { ...cur, ...patch }, 'owner');
  if (!r.ok) return view(business, 'A few details need fixing.', r.details ?? []);
  syncKnowledge(business);
  return view(business, 'Saved. All three agents use it.');
}

const SCHEMA = { type: 'object', additionalProperties: false, required: ['description', 'location', 'products', 'audience', 'painPoints', 'usps'], properties: {
  description: { type: 'string' }, location: { type: 'string' }, products: { type: 'array', items: { type: 'string' } }, audience: { type: 'string' },
  painPoints: { type: 'array', items: { type: 'string' } }, usps: { type: 'array', items: { type: 'string' } } } } as const;

const clean = (raw: unknown): Omit<Suggestion, 'source'> => {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const s = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  const l = (v: unknown, n: number, len: number) => (Array.isArray(v) ? v : []).map((x) => s(x, len)).filter(Boolean).slice(0, n);
  return { description: s(o.description, 600), location: s(o.location, 120), products: l(o.products, 10, 160), audience: s(o.audience, 300), painPoints: l(o.painPoints, 6, 200), usps: l(o.usps, 6, 200) };
};

/** Reads the business's public website (and/or the step 1 answers) and drafts the profile. The owner reviews every line. */
export async function suggestAction(business: string, useWebsite: boolean): Promise<{ view: ActivateView | null; suggestion: Suggestion | null; message: string }> {
  if (!ok(business)) return { view: null, suggestion: null, message: 'Not available here.' };
  const p = agentTeam().profile(business);
  if (!p) return { view: view(business), suggestion: null, message: 'Start with step 1 first.' };
  let siteText = '', source = 'your answers';
  if (useWebsite && p.website) {
    const r = await readPublicSite(p.website);
    if (r.ok) { siteText = [r.site.title, r.site.description, r.site.headings.join(' | '), r.site.text].join('\n').slice(0, 6000); source = `your website (${new URL(r.site.url).hostname})`; }
    else return { view: view(business), suggestion: null, message: `We could not read your website: ${r.reason} Fill the fields in yourself.` };
  }
  const model = agentTextModel();
  if (!model) {
    // No AI key: use what the website says directly, never made-up content.
    const r = siteText ? { description: siteText.split('\n')[1] || siteText.split('\n')[0] || '' } : {};
    return { view: view(business), suggestion: { ...r, source: `${source} (no AI key: only the page description was copied)` }, message: 'Check and complete the fields below.' };
  }
  try {
    const out = await model.complete({
      schemaName: 'business_profile', schema: SCHEMA, maxTokens: 1500,
      system: 'You help a small business owner fill in their business profile. Use ONLY the information given. Do not invent prices, numbers, awards, reviews, locations or claims. Leave a field empty ("" or []) when the information is not there. Pain points are the customer problems this business solves, phrased as the customer would say them. Plain Australian English.',
      user: `BUSINESS: ${p.businessName}\nINDUSTRY: ${p.industry}\nTHEY SELL: ${p.offer}\nCUSTOMERS: ${p.audience}\n${siteText ? `WEBSITE TEXT:\n${siteText}` : ''}`,
    });
    return { view: view(business), suggestion: { ...clean(parseJson(out.text)), source }, message: `Drafted from ${source}. Check every line, change anything that is not right, then save.` };
  } catch { return { view: view(business), suggestion: null, message: 'The AI could not draft this right now. Fill the fields in yourself, or try again.' }; }
}

/** Step 5: who decides what. Approval stays on for posting; the Sales agent drafts unless the owner turns on automatic replies. */
export async function saveAutomationAction(business: string, a: { postApproval: 'manual' | 'draft_only'; salesMode: 'draft_only' | 'auto'; confirmAuto: boolean; botQuestion: 'honest' | 'handoff'; aiUsdPerMonth: number; adBudgetMonthlyAud: number }): Promise<ActivateView | null> {
  if (!ok(business)) return null;
  const t = agentTeam();
  if (a.salesMode === 'auto' && a.confirmAuto !== true) return view(business, 'Tick the box to confirm automatic replies.');
  const usd = Math.max(0, Math.min(20, Math.round(Number(a.aiUsdPerMonth) || 5)));
  for (const agent of ['social', 'marketing'] as const) {
    const r = t.saveConfig(business, agent, { approvalMode: a.postApproval === 'draft_only' ? 'draft_only' : 'manual', limits: { ...t.config(business, agent)!.limits, aiUsdPerMonth: usd } }, 'owner');
    if (!r.ok) return view(business, 'Those settings were not saved.', r.details ?? []);
  }
  const p = t.profile(business);
  if (p) t.saveProfile(business, { ...p, adBudgetMonthlyAud: a.adBudgetMonthlyAud }, 'owner');
  for (const s of [sandbox(business), live()]) {
    if (!s) continue;
    const ws = 'ws' in s ? s.ws : business, cur = s.store.config(ws);
    if (cur) s.store.saveConfig({ ...cur, mode: a.salesMode === 'auto' ? 'auto' : 'draft_only', botQuestion: a.botQuestion === 'handoff' ? 'handoff' : 'honest', updatedAt: new Date().toISOString() });
  }
  return view(business, 'Saved.');
}
