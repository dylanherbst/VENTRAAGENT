// Marketing Orchestrator, Phase 1A: create campaign from a brief, write 5 angles, owner edits, owner approves one.
// Every read and write is scoped by workspaceId (a campaign from another workspace looks exactly like a missing one).
// Nothing here renders media, schedules or publishes; canSchedule() is the gate later phases must call.
import { randomUUID } from 'node:crypto';
import { checkBrief, validateAngles, applyEdit } from './validate.ts';
import type { StrategyWriter, WriterUsage } from './strategy.ts';
import { findNiche, type PlaybookAd } from './playbook.ts';
import type { AdAngle, Campaign, UsageEvent } from './types.ts';

export type Result<T> = { ok: true; value: T } | { ok: false; error: string; details?: string[] };
const fail = (error: string, details?: string[]): { ok: false; error: string; details?: string[] } => ({ ok: false, error, details });

export interface EngineStore { campaigns: Map<string, Campaign>; usage: UsageEvent[] }
export const newStore = (): EngineStore => ({ campaigns: new Map(), usage: [] });

export function createEngine(deps: { store: EngineStore; writer: StrategyWriter; now?: () => Date; id?: () => string; maxRetries?: number }) {
  const now = () => (deps.now ? deps.now() : new Date()).toISOString();
  const id = deps.id ?? (() => randomUUID().replace(/-/g, '').slice(0, 16));
  const { store } = deps;
  const get = (ws: string, cid: string) => { const c = store.campaigns.get(cid); return c && c.workspaceId === ws ? c : null; };
  const meter = (ws: string, u: WriterUsage | null | undefined) => { if (u) store.usage.push({ workspaceId: ws, provider: u.provider, operation: 'strategy.angles', estimatedCostUsd: u.estimatedCostUsd, at: now() }); };

  return {
    writerName: deps.writer.name,
    demo: deps.writer.demo,
    list(ws: string): Campaign[] { return [...store.campaigns.values()].filter((c) => c.workspaceId === ws).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); },
    get(ws: string, cid: string): Campaign | null { return get(ws, cid); },

    createCampaign(ws: string, rawBrief: unknown): Result<Campaign> {
      if (!ws) return fail('no_workspace');
      const b = checkBrief(rawBrief);
      if (!b.ok) return fail('invalid_brief', b.errors);
      const t = now();
      const c: Campaign = { id: `cmp_${id()}`, workspaceId: ws, brief: b.brief, angles: [], state: 'draft', approvedAngleId: null, approvedAt: null, generatedBy: null, createdAt: t, updatedAt: t };
      store.campaigns.set(c.id, c);
      return { ok: true, value: c };
    },

    /** Writes (or rewrites) the 5 angles. Retries once on invalid output; never stores half a set. Clears any approval. */
    async generateAngles(ws: string, cid: string): Promise<Result<Campaign>> {
      const c = get(ws, cid);
      if (!c) return fail('not_found');
      let last: string[] = [];
      for (let attempt = 0; attempt <= (deps.maxRetries ?? 1); attempt++) {
        let out;
        try { out = await deps.writer.write(c.brief); } catch (e) { meter(ws, (e as { usage?: WriterUsage }).usage); return fail('writer_failed', [(e as Error).message]); }
        meter(ws, out.usage);
        const v = validateAngles(out.raw, c.brief, id);
        if (v.ok) {
          Object.assign(c, { angles: v.angles, state: 'angles_ready', approvedAngleId: null, approvedAt: null, generatedBy: deps.writer.name, updatedAt: now() });
          return { ok: true, value: c };
        }
        last = v.errors;
      }
      return fail('invalid_output', last);
    },

    editAngle(ws: string, cid: string, angleId: string, edit: unknown): Result<AdAngle> {
      const c = get(ws, cid);
      if (!c) return fail('not_found');
      const i = c.angles.findIndex((a) => a.id === angleId);
      if (i < 0) return fail('angle_not_found');
      const r = applyEdit(c.angles[i]!, edit, c.brief);
      if (!r.ok) return fail('invalid_edit', r.errors);
      c.angles[i] = r.angle;
      // Editing the approved angle withdraws approval: the owner approves what actually goes out.
      if (c.approvedAngleId === angleId) Object.assign(c, { approvedAngleId: null, approvedAt: null, state: 'angles_ready' });
      c.updatedAt = now();
      return { ok: true, value: r.angle };
    },

    /** Explicit approval. A 'needs_validation' angle needs confirmHypotheses: the owner says they checked the flagged claims. */
    approveAngle(ws: string, cid: string, angleId: string, opts: { confirmHypotheses?: boolean } = {}): Result<Campaign> {
      const c = get(ws, cid);
      if (!c) return fail('not_found');
      const a = c.angles.find((x) => x.id === angleId);
      if (!a) return fail('angle_not_found');
      if (a.evidenceStatus === 'needs_validation' && !opts.confirmHypotheses) return fail('claims_unchecked', a.claims.filter((x) => x.status === 'hypothesis').map((x) => x.text));
      Object.assign(c, { approvedAngleId: angleId, approvedAt: now(), state: 'angle_approved', updatedAt: now() });
      return { ok: true, value: c };
    },

    /** Standalone studio: start a campaign for AiMoneyPrinter itself from one playbook niche (no AI call). Same validator as AI output. */
    importNiche(ws: string, nicheId: string): Result<Campaign> {
      const n = findNiche(nicheId);
      if (!n) return fail('niche_not_found');
      const c = this.createCampaign(ws, { businessName: 'AiMoneyPrinter', niche: n.name, offer: n.promise, audience: n.who, goal: 'leads', channel: 'paid', tone: 'clear, practical, no hype' });
      if (!c.ok) return c;
      const v = validateAngles({ angles: n.ads.map(fromPlaybook) }, c.value.brief, id);
      if (!v.ok) { store.campaigns.delete(c.value.id); return fail('invalid_output', v.errors); }
      Object.assign(c.value, { angles: v.angles, state: 'angles_ready', generatedBy: `playbook ${n.id}`, updatedAt: now() });
      return c;
    },

    unapprove(ws: string, cid: string): Result<Campaign> {
      const c = get(ws, cid);
      if (!c) return fail('not_found');
      Object.assign(c, { approvedAngleId: null, approvedAt: null, state: c.angles.length ? 'angles_ready' : 'draft', updatedAt: now() });
      return { ok: true, value: c };
    },

    /** The gate every later phase (render, schedule, publish) must pass. */
    canSchedule(ws: string, cid: string): boolean { const c = get(ws, cid); return !!c && c.state === 'angle_approved' && !!c.approvedAngleId; },

    usage(ws: string): { events: number; estimatedCostUsd: number } {
      const ev = store.usage.filter((u) => u.workspaceId === ws);
      return { events: ev.length, estimatedCostUsd: Math.round(ev.reduce((s, u) => s + u.estimatedCostUsd, 0) * 1e6) / 1e6 };
    },
  };
}
export type Engine = ReturnType<typeof createEngine>;

/** Playbook ad -> writer-shaped angle. The visual brief becomes 3 to 6 storyboard beats for reels. */
export function fromPlaybook(a: PlaybookAd) {
  const body = a.brief.replace(/^[A-Z][A-Z ]+:\s*/, '');
  let parts = body.split(/;|→|\.\s+(?=[A-Z])/).map((x) => x.trim()).filter((x) => x.length > 3);
  if (a.format === 'reel_9x16') while (parts.length < 3) parts.push(parts.length === 1 ? 'Show the product doing the work' : 'Brand name and call to action on screen');
  parts = parts.slice(0, 6);
  const step = parts.length > 1 ? Math.floor(24 / (parts.length - 1)) : 0;
  return {
    approach: a.approach, format: a.format, hook: a.hook, primary_copy: a.primaryCopy, cta: a.cta, image_brief: body.slice(0, 600),
    headline: a.hook.length <= 90 ? a.hook : `${a.hook.slice(0, 87).trimEnd()}...`,
    storyboard: a.format === 'reel_9x16' ? parts.map((visual, i) => ({ at_seconds: i * step, visual, overlay: i === 0 ? a.hook.slice(0, 90) : i === parts.length - 1 ? a.cta : '', voiceover: '' })) : [],
    claims: [],
  };
}
