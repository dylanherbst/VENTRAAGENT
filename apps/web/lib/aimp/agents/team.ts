// The Agent Orchestrator: ONE entry point for both agents. It resolves workspace context (profile + config + preset), checks tools,
// limits and approvals, runs the agent, validates output, stores drafts, records every run (status, attempts, usage, cost, errors)
// and the audit trail. Agents DECIDE and DRAFT; this module and the provider adapters EXECUTE. Every method takes the workspace id
// resolved by the server from the signed-in membership; records from another workspace look exactly like missing ones.
import { createHash, randomUUID } from 'node:crypto';
import type { Engine } from '../marketing-engine/engine.ts';
import { bannedClaim, claimsIn } from '../marketing-engine/validate.ts';
import { compileInstructions, defaultConfig, validateConfig, type AgentConfig } from './config.ts';
import { parseJson, ProviderError, type JsonModel, type LlmUsage } from './llm.ts';
import { blueprints, CORE_POLICY, CORE_POLICY_VERSION, findPreset, industryPresets, type AgentType, type Platform, type PostFormat } from './presets.ts';
import type { ImageProvider, RenderProvider, RenderStatus } from './providers/media.ts';
import { mapZernioPost, verifyZernio, type SocialPublisher } from './providers/zernio.ts';
import { demoPosts, planSlots, platformRules, postsSchema, socialUserPrompt, validatePosts, type Slot } from './social.ts';
import { authorizeTool, type Flags } from './tools.ts';

export interface BusinessProfile { workspaceId: string; businessName: string; industry: string; offer: string; audience: string; region: string; timezone: string; website: string; facts: string[]; updatedAt: string }
export type RunStatus = 'running' | 'succeeded' | 'failed' | 'blocked';
export interface AgentRun { id: string; workspaceId: string; agent: AgentType | 'orchestrator'; kind: string; status: RunStatus; attempts: number; presetId: string | null; presetVersion: number | null; policyVersion: number; writer: string; demo: boolean; outputRef: string | null; handoffFrom: string | null; usage: { inputTokens: number; outputTokens: number; costUsd: number }; error: string | null; startedAt: string; finishedAt: string | null }
export type PostState = 'draft' | 'needs_review' | 'approved' | 'scheduled' | 'published' | 'failed' | 'cancelled';
export interface PostRevision { revision: number; hook: string; caption: string; hashtags: string[]; cta: string; at: string }
export interface SocialPost {
  id: string; workspaceId: string; planId: string; slot: Slot; hook: string; caption: string; hashtags: string[]; altText: string; cta: string; assetBrief: string;
  storyboard: { atSeconds: number; visual: string; overlay: string }[]; claims: { text: string; status: 'verified' | 'hypothesis' }[];
  revision: number; state: PostState; approval: { revision: number; hash: string; accountId: string; at: string; actor: string } | null;
  assetIds: string[]; publish: { idempotencyKey: string; providerPostId: string | null; providerStatus: string | null; url: string | null; live: boolean; error: string | null; at: string } | null;
  history: PostRevision[];
}
export interface SocialPlan { id: string; workspaceId: string; days: 7 | 30; startDate: string; timezone: string; runId: string; postIds: string[]; handoff: string | null; createdAt: string; demo: boolean }
export interface Asset { id: string; workspaceId: string; kind: 'image' | 'video'; target: { type: 'post' | 'angle'; id: string; campaignId?: string }; live: boolean; source: string; mime: string; bytes: Uint8Array | null; remoteUrl: string | null; createdAt: string }
export interface RenderJob { id: string; workspaceId: string; target: Asset['target']; providerId: string; status: RenderStatus; live: boolean; attempts: number; error: string | null; assetId: string | null; createdAt: string; updatedAt: string }
export interface ConnectedAccount { id: string; workspaceId: string; profileId: string; accountId: string; platform: Platform; username: string | null; state: 'connected' | 'disconnected'; live: boolean; connectedAt: string }
export interface AuditEvent { workspaceId: string; actor: string; action: string; target: string; detail: string; at: string }
export interface MetricSnapshot { workspaceId: string; postId: string; source: string; reach: number | null; engagement: number | null; clicks: number | null; syncedAt: string }
export interface UsageRow { workspaceId: string; kind: 'ai_run' | 'image' | 'render'; costUsd: number; at: string }

export interface TeamStore {
  profiles: Map<string, BusinessProfile>; configs: Map<string, AgentConfig>; runs: AgentRun[]; plans: Map<string, SocialPlan>; posts: Map<string, SocialPost>;
  assets: Map<string, Asset>; renders: Map<string, RenderJob>; accounts: Map<string, ConnectedAccount>; zernioProfiles: Map<string, string>;
  audit: AuditEvent[]; providerEvents: Set<string>; metrics: MetricSnapshot[]; usage: UsageRow[];
}
export const newTeamStore = (): TeamStore => ({ profiles: new Map(), configs: new Map(), runs: [], plans: new Map(), posts: new Map(), assets: new Map(), renders: new Map(), accounts: new Map(), zernioProfiles: new Map(), audit: [], providerEvents: new Set(), metrics: [], usage: [] });

export type R<T> = { ok: true; value: T } | { ok: false; error: string; details?: string[] };
const no = (error: string, details?: string[]): { ok: false; error: string; details?: string[] } => ({ ok: false, error, details });

export interface TeamDeps {
  store: TeamStore; marketing: Engine; text: JsonModel | null; images: ImageProvider; renderer: RenderProvider; publisher: SocialPublisher; flags: Flags;
  templates: { reel: string | null; static: string | null }; publicUrl: string | null; zernioWebhookSecret: string | null;
  /** Turns a stored asset into a URL a provider can fetch (signed, expiring). Null when there is no public URL. */
  assetUrl: (asset: Asset) => string | null;
  fetchBytes?: (url: string) => Promise<{ bytes: Uint8Array; mime: string } | null>;
  now?: () => Date; id?: () => string; sleep?: (ms: number) => Promise<void>; maxAttempts?: number;
}

const PROFILE_FIELDS = ['businessName', 'industry', 'offer', 'audience', 'region', 'timezone', 'website'] as const;
const txt = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\p{Cc}/gu, ' ').trim().slice(0, max) : '');
const isTz = (tz: string) => { try { new Intl.DateTimeFormat('en-AU', { timeZone: tz }); return true; } catch { return false; } };

export function createAgentTeam(d: TeamDeps) {
  const s = d.store;
  const now = () => (d.now ? d.now() : new Date());
  const iso = () => now().toISOString();
  const id = d.id ?? (() => randomUUID().replace(/-/g, '').slice(0, 16));
  const sleep = d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const audit = (ws: string, actor: string, action: string, target: string, detail = '') => { s.audit.push({ workspaceId: ws, actor, action, target, detail: detail.slice(0, 300), at: iso() }); };
  const month = () => iso().slice(0, 7);
  const usedThisMonth = (ws: string, kind: UsageRow['kind']) => s.usage.filter((u) => u.workspaceId === ws && u.kind === kind && u.at.startsWith(month()));
  const costThisMonth = (ws: string) => s.usage.filter((u) => u.workspaceId === ws && u.at.startsWith(month())).reduce((a, u) => a + u.costUsd, 0);
  const own = <T extends { workspaceId: string }>(x: T | undefined, ws: string) => (x && x.workspaceId === ws ? x : null);

  function profile(ws: string): BusinessProfile | null { return s.profiles.get(ws) ?? null; }

  function saveProfile(ws: string, raw: unknown, actor: string): R<BusinessProfile> {
    const r = (typeof raw === 'object' && raw ? raw : {}) as Record<string, unknown>;
    const p: BusinessProfile = { workspaceId: ws, businessName: txt(r.businessName, 80), industry: txt(r.industry, 40), offer: txt(r.offer, 400), audience: txt(r.audience, 300), region: txt(r.region, 80) || 'Australia',
      timezone: txt(r.timezone, 60) || 'Australia/Perth', website: txt(r.website, 300),
      facts: (Array.isArray(r.facts) ? r.facts : typeof r.facts === 'string' ? r.facts.split('\n') : []).map((f) => txt(f, 300)).filter(Boolean).slice(0, 20), updatedAt: iso() };
    const errors: string[] = [];
    if (!p.businessName) errors.push('Add your business name.');
    if (!p.offer) errors.push('Add what you sell.');
    if (!findPreset(p.industry)) errors.push('Choose your industry.');
    if (!isTz(p.timezone)) errors.push('That time zone is not valid.');
    if (p.website && !/^https:\/\//.test(p.website)) errors.push('Website must start with https://');
    if (errors.length) return no('invalid_profile', errors);
    const prev = s.profiles.get(ws);
    s.profiles.set(ws, p);
    // A new industry moves agents that are still on their default preset; it never touches a workspace's own settings otherwise.
    // Agents still on untouched defaults follow the business's industry (also on the first save, when defaults were made before it).
    for (const a of ['marketing', 'social'] as const) { const c = s.configs.get(`${ws}:${a}`); if (c && c.revision === 1 && c.presetId !== p.industry) s.configs.delete(`${ws}:${a}`); }
    audit(ws, actor, 'profile.saved', ws, PROFILE_FIELDS.filter((k) => prev?.[k] !== p[k]).join(','));
    return { ok: true, value: p };
  }

  function config(ws: string, agent: AgentType): AgentConfig | null {
    const key = `${ws}:${agent}`;
    const cur = s.configs.get(key);
    if (cur) return cur;
    const p = profile(ws);
    const preset = findPreset(p?.industry ?? 'local-services');
    if (!preset) return null;
    const c = defaultConfig(ws, agent, preset, iso());
    if (p?.audience) c.audience = p.audience;
    s.configs.set(key, c);
    return c;
  }

  function saveConfig(ws: string, agent: AgentType, raw: unknown, actor: string): R<AgentConfig> {
    const cur = config(ws, agent);
    if (!cur) return no('no_config');
    const v = validateConfig(raw, cur, iso());
    if (!v.ok) return no('invalid_config', v.errors);
    s.configs.set(`${ws}:${agent}`, v.config);
    audit(ws, actor, 'config.saved', agent, `rev ${v.config.revision}, preset ${v.config.presetId}@${v.config.presetVersion}`);
    return { ok: true, value: v.config };
  }

  /** Every agent run goes through here: tool check, limits, run record, retries for retryable provider errors, usage. */
  async function run<T>(ws: string, agent: AgentType, kind: string, tool: string, fn: (attempt: number) => Promise<{ value: T; usage: LlmUsage | null; outputRef?: string }>, handoffFrom: string | null = null): Promise<R<T> & { runId: string }> {
    const cfg = config(ws, agent);
    const r: AgentRun = { id: `run_${id()}`, workspaceId: ws, agent, kind, status: 'running', attempts: 0, presetId: cfg?.presetId ?? null, presetVersion: cfg?.presetVersion ?? null, policyVersion: CORE_POLICY_VERSION,
      writer: d.text?.name ?? 'demo', demo: !d.text || d.text.demo, outputRef: null, handoffFrom, usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }, error: null, startedAt: iso(), finishedAt: null };
    s.runs.push(r);
    const end = (status: RunStatus, error: string | null) => { r.status = status; r.error = error; r.finishedAt = iso(); };
    const tdec = authorizeTool(agent, tool, d.flags);
    if (!tdec.allowed) { end('blocked', tdec.reason); return { ...no(tdec.reason), runId: r.id }; }
    if (!cfg?.enabled) { end('blocked', 'agent_off'); return { ...no('agent_off'), runId: r.id }; }
    if (usedThisMonth(ws, 'ai_run').length >= cfg.limits.aiRunsPerMonth) { end('blocked', 'run_limit'); return { ...no('run_limit'), runId: r.id }; }
    if (costThisMonth(ws) >= cfg.limits.aiUsdPerMonth) { end('blocked', 'cost_limit'); return { ...no('cost_limit'), runId: r.id }; }
    const max = d.maxAttempts ?? 3;
    for (let attempt = 1; attempt <= max; attempt++) {
      r.attempts = attempt;
      try {
        const out = await fn(attempt);
        if (out.usage) { r.usage.inputTokens += out.usage.inputTokens; r.usage.outputTokens += out.usage.outputTokens; r.usage.costUsd += out.usage.estimatedCostUsd; }
        r.outputRef = out.outputRef ?? null;
        s.usage.push({ workspaceId: ws, kind: 'ai_run', costUsd: r.usage.costUsd, at: iso() });
        end('succeeded', null);
        return { ok: true, value: out.value, runId: r.id };
      } catch (e) {
        const pe = e instanceof ProviderError ? e : null;
        const spent = pe?.usage ?? (e as { usage?: LlmUsage | null }).usage ?? null;
        if (spent) { r.usage.inputTokens += spent.inputTokens; r.usage.outputTokens += spent.outputTokens; r.usage.costUsd += spent.estimatedCostUsd; }
        const msg = pe ? pe.code : e instanceof Error ? e.message.slice(0, 200) : 'error';
        const retry = attempt < max && (pe ? pe.retryable : msg.startsWith('invalid_output') && attempt < 2);
        if (!retry) { s.usage.push({ workspaceId: ws, kind: 'ai_run', costUsd: r.usage.costUsd, at: iso() }); end('failed', msg); return { ...no(msg.startsWith('invalid_output') ? 'invalid_output' : msg.startsWith('invalid_brief') ? 'invalid_brief' : 'provider_failed', [msg]), runId: r.id }; }
        await sleep(pe?.status === 429 ? 2000 * attempt : 500 * attempt);
      }
    }
    end('failed', 'exhausted'); return { ...no('provider_failed'), runId: r.id };
  }

  /** Marketing agent: five ad angles from the profile + config, through the shared marketing engine. */
  async function generateAds(ws: string, actor: string): Promise<R<{ campaignId: string }> & { runId?: string }> {
    const p = profile(ws); if (!p) return no('no_profile');
    const cfg = config(ws, 'marketing')!;
    const before = d.marketing.usage(ws).estimatedCostUsd;
    // One campaign per request. The engine already retries bad model output once, so here we retry only provider hiccups.
    let campaignId: string | null = null;
    const res = await run(ws, 'marketing', 'marketing.angles', 'marketing.draft_angles', async () => {
      if (!campaignId) {
        const c = d.marketing.createCampaign(ws, { businessName: p.businessName, niche: findPreset(cfg.presetId)?.name ?? p.industry, offer: p.offer, audience: cfg.audience || p.audience, region: p.region, goal: /sale/i.test(cfg.goals.join(' ')) ? 'sales' : 'leads', channel: 'organic', tone: cfg.brandVoice, facts: p.facts });
        if (!c.ok) throw new ProviderError('invalid_brief', 0, null, false);
        campaignId = c.value.id;
      }
      const g = await d.marketing.generateAngles(ws, campaignId);
      const cost = d.marketing.usage(ws).estimatedCostUsd - before;
      const usage = { provider: 'marketing-engine', model: d.marketing.writerName, inputTokens: 0, outputTokens: 0, estimatedCostUsd: cost };
      if (!g.ok) {
        const retryable = g.error === 'writer_failed' && /http_(429|5\d\d)|timeout|network/.test((g.details ?? []).join(' '));
        throw Object.assign(new ProviderError(`${g.error === 'invalid_output' ? 'invalid_output' : 'writer_failed'}: ${(g.details ?? []).join('; ').slice(0, 300)}`, 0, null, retryable), { usage });
      }
      return { value: { campaignId }, usage, outputRef: campaignId };
    });
    if (res.ok) audit(ws, actor, 'marketing.angles_drafted', res.value.campaignId);
    return res;
  }

  function handoffFor(ws: string, campaignId: string | null): string | null {
    if (!campaignId) return null;
    const c = d.marketing.get(ws, campaignId);
    if (!c) return null;
    const chosen = c.angles.find((a) => a.id === c.approvedAngleId);
    return JSON.stringify({ campaign: c.id, approvedAngle: chosen ? { approach: chosen.approach, hook: chosen.hook, cta: chosen.cta } : null, angles: c.angles.map((a) => ({ approach: a.approach, hook: a.hook })) });
  }

  /** Social agent: a 7 or 30-day plan. Slots are laid out by the backend; the model writes each one. */
  async function generatePlan(ws: string, opts: { days: 7 | 30; startDate?: string; campaignId?: string | null }, actor: string): Promise<R<SocialPlan> & { runId?: string }> {
    const p = profile(ws); if (!p) return no('no_profile');
    const cfg = config(ws, 'social')!;
    const preset = findPreset(cfg.presetId, cfg.presetVersion);
    if (!preset) return no('preset_missing');
    if (opts.days !== 7 && opts.days !== 30) return no('bad_days');
    const start = opts.startDate && /^\d{4}-\d{2}-\d{2}$/.test(opts.startDate) ? opts.startDate : new Date(now().getTime() + 86400000).toISOString().slice(0, 10);
    const slots = planSlots(cfg, preset, opts.days, start, p.facts.some((f) => /review|testimonial|stars|said/i.test(f)));
    const handoff = handoffFor(ws, opts.campaignId ?? null);
    const res = await run(ws, 'social', `social.plan_${opts.days}`, 'social.draft_plan', async () => {
      let raw: unknown; let usage: LlmUsage | null = null;
      if (d.text && !d.text.demo) {
        const out = await d.text.complete({ system: compileInstructions(CORE_POLICY, blueprints.social, preset, cfg), user: socialUserPrompt(p, slots, handoff), schema: postsSchema, schemaName: 'social_posts', maxTokens: opts.days === 30 ? 32000 : 10000 });
        raw = parseJson(out.text); usage = out.usage;
      } else raw = demoPosts(p, preset, slots);
      const v = validatePosts(raw, slots, cfg, p.facts);
      if (!v.ok) throw Object.assign(new Error(`invalid_output: ${v.errors.slice(0, 3).join('; ')}`), { usage });
      const planId = `plan_${id()}`;
      const posts: SocialPost[] = v.drafts.map((x) => ({ id: `post_${id()}`, workspaceId: ws, planId, slot: x.slot, hook: x.hook, caption: x.caption, hashtags: x.hashtags, altText: x.altText, cta: x.cta, assetBrief: x.assetBrief, storyboard: x.storyboard, claims: x.claims,
        revision: 1, state: 'needs_review', approval: null, assetIds: [], publish: null, history: [{ revision: 1, hook: x.hook, caption: x.caption, hashtags: x.hashtags, cta: x.cta, at: iso() }] }));
      for (const post of posts) s.posts.set(post.id, post);
      const plan: SocialPlan = { id: planId, workspaceId: ws, days: opts.days, startDate: start, timezone: p.timezone, runId: '', postIds: posts.map((x) => x.id), handoff, createdAt: iso(), demo: !d.text || d.text.demo };
      s.plans.set(planId, plan);
      return { value: plan, usage, outputRef: planId };
    }, opts.campaignId ? `campaign:${opts.campaignId}` : null);
    if (res.ok) { res.value.runId = res.runId; audit(ws, actor, 'social.plan_drafted', res.value.id, `${opts.days} days`); }
    return res;
  }

  /** "Five ads and a week of posts": marketing first, then social with a structured handoff. */
  async function launch(ws: string, days: 7 | 30, actor: string) {
    const ads = await generateAds(ws, actor);
    const plan = await generatePlan(ws, { days, campaignId: ads.ok ? ads.value.campaignId : null }, actor);
    return { ads, plan };
  }

  const hashPost = (x: SocialPost) => createHash('sha256').update(JSON.stringify([x.id, x.revision, x.hook, x.caption, x.hashtags, x.cta, x.assetIds, x.slot.platform, x.slot.date, x.slot.time])).digest('hex');

  function editPost(ws: string, postId: string, raw: unknown, actor: string): R<SocialPost> {
    const x = own(s.posts.get(postId), ws); if (!x) return no('not_found');
    if (x.state === 'scheduled' || x.state === 'published') return no('locked', ['Cancel the scheduled post in your social account first; published posts cannot be edited here.']);
    const e = (typeof raw === 'object' && raw ? raw : {}) as Record<string, unknown>;
    const rule = platformRules[x.slot.platform];
    const next = { hook: e.hook === undefined ? x.hook : txt(e.hook, 150), caption: e.caption === undefined ? x.caption : String(e.caption ?? '').trim(), cta: e.cta === undefined ? x.cta : txt(e.cta, 60),
      hashtags: e.hashtags === undefined ? x.hashtags : (Array.isArray(e.hashtags) ? e.hashtags : String(e.hashtags).split(/[\s,]+/)).map((h) => String(h).trim().replace(/^#*/, '#')).filter((h) => /^#[\p{L}\p{N}_]{2,40}$/u.test(h)).slice(0, rule.hashtags),
      date: e.date === undefined ? x.slot.date : txt(e.date, 10), time: e.time === undefined ? x.slot.time : txt(e.time, 5) };
    const errors: string[] = [];
    if (!next.hook) errors.push('Add a hook.');
    if (!next.caption || next.caption.length > rule.caption) errors.push(`Caption must be 1 to ${rule.caption} characters on ${x.slot.platform}.`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(next.date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(next.time)) errors.push('Date or time is not valid.');
    if (bannedClaim(`${next.hook} ${next.caption} ${next.cta}`)) errors.push('That wording makes a claim we never allow (income, guarantee, fake urgency or similar).');
    if (errors.length) return no('invalid_edit', errors);
    const wasApproved = !!x.approval;
    Object.assign(x, { hook: next.hook, caption: next.caption, cta: next.cta, hashtags: next.hashtags, claims: claimsIn([next.hook, next.caption], profile(ws)?.facts ?? []), revision: x.revision + 1, approval: null, state: 'needs_review' });
    x.slot = { ...x.slot, date: next.date, time: next.time };
    x.history.push({ revision: x.revision, hook: x.hook, caption: x.caption, hashtags: x.hashtags, cta: x.cta, at: iso() });
    audit(ws, actor, 'post.edited', x.id, `rev ${x.revision}${wasApproved ? ', approval withdrawn' : ''}`);
    return { ok: true, value: x };
  }

  function approvePost(ws: string, postId: string, opts: { accountId: string; confirmClaims?: boolean }, actor: string): R<SocialPost> {
    const x = own(s.posts.get(postId), ws); if (!x) return no('not_found');
    if (x.state !== 'needs_review' && x.state !== 'draft' && x.state !== 'failed') return no('wrong_state', [`This post is ${x.state}.`]);
    const acct = own(s.accounts.get(opts.accountId), ws);
    if (!acct || acct.state !== 'connected') return no('account_not_connected');
    if (acct.platform !== x.slot.platform) return no('wrong_platform', [`This post is for ${x.slot.platform}; that account is ${acct.platform}.`]);
    if (platformRules[x.slot.platform].needsMedia && !x.assetIds.some((a) => own(s.assets.get(a), ws))) return no('needs_media', [`${x.slot.platform} posts need an image or video. Make one first.`]);
    const flagged = x.claims.filter((c) => c.status === 'hypothesis');
    if (flagged.length && !opts.confirmClaims) return no('claims_unchecked', flagged.map((c) => c.text));
    x.approval = { revision: x.revision, hash: hashPost(x), accountId: acct.id, at: iso(), actor };
    x.state = 'approved';
    audit(ws, actor, 'post.approved', x.id, `rev ${x.revision} for ${acct.platform}${acct.username ? ` @${acct.username}` : ''}`);
    return { ok: true, value: x };
  }

  /** Deterministic publishing: approval bound to this exact revision + account, one provider schedule per revision. */
  async function schedulePost(ws: string, postId: string, actor: string): Promise<R<SocialPost>> {
    const x = own(s.posts.get(postId), ws); if (!x) return no('not_found');
    const key = `${ws}:${x.id}:r${x.revision}`;
    if (x.publish?.idempotencyKey === key && x.publish.providerPostId) return { ok: true, value: x }; // already sent: never twice
    // The publishing switch guards REAL posting. In mock mode nothing leaves the server, so the flow can be tested end to end.
    const t = authorizeTool('social', 'social.schedule_post', d.publisher.live ? d.flags : { ...d.flags, publishingEnabled: true }, { approved: !!x.approval });
    if (!t.allowed) return no(t.reason);
    if (!x.approval || x.approval.revision !== x.revision || x.approval.hash !== hashPost(x)) return no('approval_stale', ['The post changed after approval. Approve it again.']);
    const acct = own(s.accounts.get(x.approval.accountId), ws);
    if (!acct || acct.state !== 'connected' || acct.platform !== x.slot.platform) return no('account_not_connected');
    if (!platformRules[x.slot.platform].publishable) return no('platform_not_supported', [platformRules[x.slot.platform].note]);
    if (acct.live !== d.publisher.live) return no('account_mode_mismatch', ['This account was connected in mock mode. Reconnect it with Zernio.']);
    const assets = x.assetIds.map((a) => own(s.assets.get(a), ws)).filter((a): a is Asset => !!a);
    const media = assets.map((a) => ({ type: a.kind === 'video' ? 'video' as const : 'image' as const, url: d.assetUrl(a) })).filter((m): m is { type: 'image' | 'video'; url: string } => !!m.url);
    if (d.publisher.live && (assets.some((a) => !a.live) || (platformRules[x.slot.platform].needsMedia && !media.length))) return no('needs_live_media', ['Live posts need real media that our server can share (set APP_PUBLIC_URL).']);
    const tz = profile(ws)?.timezone ?? 'Australia/Perth';
    x.publish = { idempotencyKey: key, providerPostId: null, providerStatus: null, url: null, live: d.publisher.live, error: null, at: iso() };
    try {
      const out = await d.publisher.schedule({ idempotencyKey: key, content: `${x.caption}${x.hashtags.length ? `\n\n${x.hashtags.join(' ')}` : ''}`, media, platform: x.slot.platform, accountId: acct.accountId, scheduledFor: `${x.slot.date}T${x.slot.time}:00`, timezone: tz });
      Object.assign(x.publish, { providerPostId: out.providerPostId, providerStatus: out.status, live: out.live });
      x.state = mapZernioPost('', out.status) === 'published' ? 'published' : 'scheduled';
      audit(ws, actor, 'post.scheduled', x.id, `${out.live ? 'live' : 'MOCK'} ${out.providerPostId} at ${x.slot.date} ${x.slot.time} ${tz}`);
      return { ok: true, value: x };
    } catch (e) {
      // Ambiguous failures keep the key: a retry reuses it, and the owner is told to check the account before retrying.
      x.publish.error = e instanceof ProviderError ? e.code : 'network_error';
      x.state = 'failed';
      audit(ws, actor, 'post.schedule_failed', x.id, x.publish.error);
      return no('provider_failed', [x.publish.error]);
    }
  }

  function attachAsset(ws: string, target: Asset['target'], a: Omit<Asset, 'id' | 'workspaceId' | 'target' | 'createdAt'>): Asset {
    const asset: Asset = { id: `ast_${id()}`, workspaceId: ws, target, createdAt: iso(), ...a };
    s.assets.set(asset.id, asset);
    if (target.type === 'post') { const p = own(s.posts.get(target.id), ws); if (p) { p.assetIds = [...p.assetIds, asset.id]; if (p.approval) { p.approval = null; p.state = 'needs_review'; p.revision++; } } }
    return asset;
  }

  function mediaTarget(ws: string, target: Asset['target']): { brief: string; aspect: 'square' | 'portrait' | 'story'; agent: AgentType; texts: Record<string, string> } | null {
    if (target.type === 'post') {
      const p = own(s.posts.get(target.id), ws); if (!p) return null;
      return { brief: p.assetBrief, aspect: p.slot.format === 'reel' ? 'story' : 'portrait', agent: 'social', texts: { hook: p.hook, cta: p.cta } };
    }
    const c = target.campaignId ? d.marketing.get(ws, target.campaignId) : null;
    const a = c?.angles.find((x) => x.id === target.id); if (!a) return null;
    return { brief: a.imageBrief, aspect: a.format === 'reel_9x16' ? 'story' : 'portrait', agent: 'marketing', texts: { hook: a.hook, cta: a.cta, headline: a.headline } };
  }

  async function generateImage(ws: string, target: Asset['target'], actor: string): Promise<R<Asset>> {
    const m = mediaTarget(ws, target); if (!m) return no('not_found');
    const t = authorizeTool(m.agent, 'media.generate_image', d.flags); if (!t.allowed) return no(t.reason);
    const cfg = config(ws, m.agent)!;
    if (usedThisMonth(ws, 'image').length >= cfg.limits.imagesPerMonth) return no('image_limit');
    if (costThisMonth(ws) >= cfg.limits.aiUsdPerMonth) return no('cost_limit');
    const prompt = `${m.brief}. Style: ${cfg.creativeStyle}. No words or logos in the image. Realistic, not stock-photo. ${profile(ws)?.businessName ?? ''}`.trim();
    try {
      const img = await d.images.generate({ prompt, aspect: m.aspect });
      s.usage.push({ workspaceId: ws, kind: 'image', costUsd: img.estimatedCostUsd, at: iso() });
      const asset = attachAsset(ws, target, { kind: 'image', live: img.live, source: img.live ? `openai:${img.model}` : 'mock', mime: img.mime, bytes: img.bytes, remoteUrl: null });
      audit(ws, actor, 'media.image', asset.id, img.live ? 'live' : 'MOCK');
      return { ok: true, value: asset };
    } catch (e) { return no('provider_failed', [e instanceof ProviderError ? e.code : 'error']); }
  }

  async function renderVideo(ws: string, target: Asset['target'], actor: string): Promise<R<RenderJob>> {
    const m = mediaTarget(ws, target); if (!m) return no('not_found');
    const t = authorizeTool(m.agent, 'media.render_video', d.flags); if (!t.allowed) return no(t.reason);
    const cfg = config(ws, m.agent)!;
    if (usedThisMonth(ws, 'render').length >= cfg.limits.rendersPerMonth) return no('render_limit');
    const template = m.aspect === 'story' ? d.templates.reel : d.templates.static;
    if (d.renderer.live && !template) return no('no_template', ['Set CREATOMATE_REEL_TEMPLATE_ID and CREATOMATE_STATIC_TEMPLATE_ID.']);
    const image = [...s.assets.values()].find((a) => a.workspaceId === ws && a.target.id === target.id && a.kind === 'image');
    const mods: Record<string, string> = { Headline: m.texts.hook ?? '', CTA: m.texts.cta ?? '', Brand: profile(ws)?.businessName ?? '' };
    const imgUrl = image ? d.assetUrl(image) : null; if (imgUrl) mods.Image = imgUrl;
    const job: RenderJob = { id: `rnd_${id()}`, workspaceId: ws, target, providerId: '', status: 'requested', live: d.renderer.live, attempts: 0, error: null, assetId: null, createdAt: iso(), updatedAt: iso() };
    try {
      const h = await d.renderer.start({ templateId: template ?? 'mock', modifications: mods, webhookUrl: d.publicUrl ? `${d.publicUrl}/api/webhooks/creatomate` : null, metadata: job.id });
      Object.assign(job, { providerId: h.providerId, status: h.status, live: h.live });
    } catch (e) { job.status = 'failed'; job.error = e instanceof ProviderError ? e.code : 'error'; }
    s.renders.set(job.id, job);
    if (job.status !== 'failed') s.usage.push({ workspaceId: ws, kind: 'render', costUsd: 0, at: iso() });
    audit(ws, actor, 'media.render_requested', job.id, `${job.live ? 'live' : 'MOCK'} ${job.status}`);
    return job.status === 'failed' ? no('provider_failed', [job.error ?? '']) : { ok: true, value: job };
  }

  /** Reconcile one render from the provider (never from a webhook body alone). Copies the finished file into our storage. */
  async function syncRender(ws: string, renderId: string): Promise<R<RenderJob>> {
    const job = own(s.renders.get(renderId), ws); if (!job) return no('not_found');
    if (job.status === 'completed' || job.status === 'failed') return { ok: true, value: job };
    job.attempts++;
    try {
      const h = await d.renderer.status(job.providerId);
      job.status = h.status; job.error = h.error; job.updatedAt = iso();
      if (h.status === 'completed') {
        let bytes: Uint8Array | null = null, mime = 'video/mp4';
        if (h.url && d.fetchBytes) { const f = await d.fetchBytes(h.url); if (f) { bytes = f.bytes; mime = f.mime; } }
        if (h.live && !bytes) { job.status = 'failed'; job.error = 'download_failed'; return { ok: true, value: job }; }
        job.assetId = attachAsset(ws, job.target, { kind: 'video', live: h.live, source: h.live ? 'creatomate' : 'mock', mime, bytes, remoteUrl: null }).id;
      }
    } catch (e) { job.error = e instanceof ProviderError ? e.code : 'error'; if (job.attempts >= 20) job.status = 'failed'; }
    return { ok: true, value: job };
  }

  /** Creatomate webhook: a hint only. We find the job by provider id, then ask the provider. */
  async function handleCreatomateHint(body: unknown): Promise<R<string>> {
    const b = (typeof body === 'object' && body ? body : {}) as Record<string, unknown>;
    const pid = typeof b.id === 'string' ? b.id : '';
    const job = [...s.renders.values()].find((j) => j.providerId === pid && (typeof b.metadata !== 'string' || b.metadata === j.id));
    if (!job) return no('unknown_render');
    await syncRender(job.workspaceId, job.id);
    return { ok: true, value: job.id };
  }

  // Connections. Mock mode makes a clearly labelled mock account so the flow can be tested end to end without Zernio.
  async function connectStart(ws: string, platform: Platform, redirectUrl: string, actor: string): Promise<R<{ url: string | null; account: ConnectedAccount | null }>> {
    if (!d.flags.agentsEnabled) return no('agents_disabled');
    if (!d.publisher.live) {
      const a: ConnectedAccount = { id: `acc_${id()}`, workspaceId: ws, profileId: `mock_profile_${ws}`, accountId: `mock_${platform}`, platform, username: `mock_${platform}`, state: 'connected', live: false, connectedAt: iso() };
      s.accounts.set(a.id, a); audit(ws, actor, 'account.mock_connected', a.id, platform);
      return { ok: true, value: { url: null, account: a } };
    }
    try {
      let pid = s.zernioProfiles.get(ws);
      if (!pid) { pid = await d.publisher.ensureProfile(ws, profile(ws)?.businessName ?? ws); s.zernioProfiles.set(ws, pid); }
      return { ok: true, value: { url: await d.publisher.connectUrl(pid, platform, redirectUrl), account: null } };
    } catch (e) { return no('provider_failed', [e instanceof ProviderError ? e.code : 'error']); }
  }

  async function syncAccounts(ws: string): Promise<R<ConnectedAccount[]>> {
    const pid = s.zernioProfiles.get(ws);
    if (!d.publisher.live || !pid) return { ok: true, value: accounts(ws) };
    try {
      const list = await d.publisher.accounts(pid);
      for (const z of list) {
        const ex = [...s.accounts.values()].find((a) => a.workspaceId === ws && a.accountId === z.accountId);
        if (ex) { ex.state = 'connected'; ex.username = z.username; continue; }
        const a: ConnectedAccount = { id: `acc_${id()}`, workspaceId: ws, profileId: pid, accountId: z.accountId, platform: z.platform, username: z.username, state: 'connected', live: true, connectedAt: iso() };
        s.accounts.set(a.id, a);
      }
      return { ok: true, value: accounts(ws) };
    } catch (e) { return no('provider_failed', [e instanceof ProviderError ? e.code : 'error']); }
  }

  function disconnect(ws: string, accountId: string, actor: string): R<ConnectedAccount> {
    const a = own(s.accounts.get(accountId), ws); if (!a) return no('not_found');
    a.state = 'disconnected'; audit(ws, actor, 'account.disconnected', a.id);
    return { ok: true, value: a };
  }

  /** Zernio webhook: signature, dedupe on event id, profile -> workspace mapping we created, post id within that workspace. */
  function handleZernioWebhook(rawBody: string, headers: { signature: string | null; eventId: string | null }): R<string> {
    if (!d.zernioWebhookSecret || !verifyZernio(rawBody, headers.signature, d.zernioWebhookSecret)) return no('bad_signature');
    let b: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    try { b = JSON.parse(rawBody); } catch { return no('bad_body'); }
    const eventId = String(b.id ?? headers.eventId ?? '');
    if (!eventId) return no('no_event_id');
    if (s.providerEvents.has(`zernio:${eventId}`)) return { ok: true, value: 'duplicate' };
    s.providerEvents.add(`zernio:${eventId}`);
    if (b.test) return { ok: true, value: 'test' };
    const ext = Array.isArray(b.profiles) ? b.profiles.map((p: Record<string, unknown>) => ({ id: String(p.id), ws: String(p.externalId) })) : [];
    // Accept a profile only if we created it for that workspace.
    const match = ext.find((p: { id: string; ws: string }) => s.zernioProfiles.get(p.ws) === p.id);
    if (!match) return no('unknown_profile');
    const ws = match.ws as string;
    const event = String(b.event ?? '');
    if (event.startsWith('post.')) {
      const pid = String(b.post?._id ?? b.post?.id ?? '');
      const x = [...s.posts.values()].find((p) => p.workspaceId === ws && p.publish?.providerPostId === pid);
      if (!x) return no('unknown_post');
      const st = mapZernioPost(event, typeof b.post?.status === 'string' ? b.post.status : null);
      if (st) { x.state = st; x.publish!.providerStatus = event; const url = (b.post?.platforms ?? []).map((p: Record<string, unknown>) => p.platformPostUrl ?? p.url).find((u: unknown) => typeof u === 'string'); if (url) x.publish!.url = url; }
      audit(ws, 'zernio', `webhook.${event}`, x.id);
      return { ok: true, value: x.id };
    }
    if (event === 'account.disconnected') {
      const aid = String(b.account?.accountId ?? b.account?._id ?? '');
      for (const a of s.accounts.values()) if (a.workspaceId === ws && a.accountId === aid) a.state = 'disconnected';
      audit(ws, 'zernio', 'webhook.account.disconnected', aid);
    }
    return { ok: true, value: event || 'ignored' };
  }

  /** Real metrics only. Called by a sync job with provider-returned numbers; nothing here makes numbers up. */
  function recordMetrics(ws: string, postId: string, m: { source: string; reach?: number | null; engagement?: number | null; clicks?: number | null }): R<MetricSnapshot> {
    const x = own(s.posts.get(postId), ws); if (!x || x.state !== 'published' || !x.publish?.live) return no('not_published_live');
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);
    const snap = { workspaceId: ws, postId, source: m.source.slice(0, 40), reach: n(m.reach), engagement: n(m.engagement), clicks: n(m.clicks), syncedAt: iso() };
    s.metrics.push(snap); return { ok: true, value: snap };
  }

  function performance(ws: string) {
    const posts = [...s.posts.values()].filter((p) => p.workspaceId === ws);
    const latest = new Map<string, MetricSnapshot>(); for (const m of s.metrics) if (m.workspaceId === ws) latest.set(m.postId, m);
    const snaps = [...latest.values()];
    const sum = (k: 'reach' | 'engagement' | 'clicks') => (snaps.some((x) => x[k] !== null) ? snaps.reduce((a, x) => a + (x[k] ?? 0), 0) : null);
    const published = posts.filter((p) => p.state === 'published');
    const recs: string[] = [];
    if (snaps.length < 3) recs.push('Not enough real results yet. Recommendations start after 3 published posts have metrics.');
    else {
      const byPillar = new Map<string, { n: number; eng: number }>();
      for (const sn of snaps) { const p = s.posts.get(sn.postId); if (!p || sn.engagement === null) continue; const v = byPillar.get(p.slot.pillar) ?? { n: 0, eng: 0 }; v.n++; v.eng += sn.engagement; byPillar.set(p.slot.pillar, v); }
      const ranked = [...byPillar.entries()].filter(([, v]) => v.n >= 2).map(([k, v]) => ({ k, avg: v.eng / v.n })).sort((a, b) => b.avg - a.avg);
      if (ranked.length >= 2) recs.push(`"${ranked[0]!.k}" posts averaged the most engagement (${Math.round(ranked[0]!.avg)}) and "${ranked[ranked.length - 1]!.k}" the least (${Math.round(ranked[ranked.length - 1]!.avg)}) across your own posts. Try one more "${ranked[0]!.k}" post next week.`);
      else recs.push('Results are in, but no pillar has 2 measured posts yet to compare.');
    }
    return { publishedLive: published.filter((p) => p.publish?.live).length, publishedMock: published.filter((p) => !p.publish?.live).length, scheduled: posts.filter((p) => p.state === 'scheduled').length,
      reach: sum('reach'), engagement: sum('engagement'), clicks: sum('clicks'), leads: null as number | null, lastSynced: snaps.map((x) => x.syncedAt).sort().pop() ?? null, recommendations: recs };
  }

  const accounts = (ws: string) => [...s.accounts.values()].filter((a) => a.workspaceId === ws);
  function dashboard(ws: string) {
    const posts = [...s.posts.values()].filter((p) => p.workspaceId === ws);
    const runs = s.runs.filter((r) => r.workspaceId === ws);
    return {
      profile: profile(ws), configs: { marketing: config(ws, 'marketing'), social: config(ws, 'social') }, flags: d.flags,
      providers: { text: d.text && !d.text.demo ? d.text.name : 'demo', images: d.images.live ? 'live' : 'mock', video: d.renderer.live ? 'live' : 'mock', publishing: d.publisher.live ? 'live' : 'mock' },
      runs: runs.slice(-20).reverse(), running: runs.filter((r) => r.status === 'running').length,
      pending: posts.filter((p) => p.state === 'needs_review').length, approved: posts.filter((p) => p.state === 'approved').length,
      upcoming: posts.filter((p) => p.state === 'scheduled').sort((a, b) => `${a.slot.date}${a.slot.time}`.localeCompare(`${b.slot.date}${b.slot.time}`)).slice(0, 10),
      plans: [...s.plans.values()].filter((p) => p.workspaceId === ws).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      posts, campaigns: d.marketing.list(ws), assets: [...s.assets.values()].filter((a) => a.workspaceId === ws).map(({ bytes, ...a }) => ({ ...a, size: bytes?.length ?? 0 })),
      renders: [...s.renders.values()].filter((r) => r.workspaceId === ws), accounts: accounts(ws), audit: s.audit.filter((a) => a.workspaceId === ws).slice(-30).reverse(),
      usage: { aiRuns: usedThisMonth(ws, 'ai_run').length, images: usedThisMonth(ws, 'image').length, renders: usedThisMonth(ws, 'render').length, costUsd: Math.round(costThisMonth(ws) * 1e4) / 1e4 },
      performance: performance(ws), presets: industryPresets.map((p) => ({ id: p.id, name: p.name, version: p.version })),
    };
  }

  /** Paid ads are Phase 6. This exists so the refusal is tested and visible, not silently absent. */
  function createPaidCampaign(ws: string): R<never> { const t = authorizeTool('marketing', 'paid.create_campaign', d.flags, { approved: false }); audit(ws, 'system', 'paid.refused', ws, t.allowed ? '' : t.reason); return no(t.allowed ? 'approval_required' : t.reason); }

  return { profile, saveProfile, config, saveConfig, generateAds, generatePlan, launch, editPost, approvePost, schedulePost, generateImage, renderVideo, syncRender, handleCreatomateHint,
    connectStart, syncAccounts, disconnect, handleZernioWebhook, recordMetrics, performance, dashboard, createPaidCampaign,
    asset: (ws: string, assetId: string) => own(s.assets.get(assetId), ws) };
}
export type AgentTeam = ReturnType<typeof createAgentTeam>;
