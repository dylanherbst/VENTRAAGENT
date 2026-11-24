// Campaign drafts and approval (AMP-050). One campaign per business: status draft -> approved, with a version number.
//  - Regenerating always writes a fresh DRAFT with the next version (an approved plan goes back to draft: new copy needs a new yes).
//  - Approving re-checks the saved plan against the brand, listings and store as they are NOW, so a plan whose product was
//    repriced, unlisted or whose store was paused cannot be approved; regenerate it instead.
//  - Every call is scoped to one workspace and business; another workspace's campaign looks the same as none.
//  - Nothing is posted or sent from here. Publishing is AMP-052 and has its own approval.
import { buildLaunchCampaign } from './generate.ts';
import type { CampaignLlmOptions } from './generate.ts';
import type { CampaignContext, CampaignIssue, CampaignRecord, CampaignStore, LaunchCampaignInput } from './types.ts';
import { validateCampaignPlan } from './validate.ts';

export interface CampaignDeps {
  store: CampaignStore;
  /** Injected clock. */
  now: () => Date;
  /** Injected id source; defaults to crypto.randomUUID(). */
  newId?: () => string;
  /** The llm provider adapter. Leave out (or null) for the built-in plan only. */
  llm?: CampaignLlmOptions['llm'];
}
export interface CampaignScope { workspaceId: string; businessId: string }
export type CampaignResult = { ok: true; campaign: CampaignRecord } | { ok: false; errors: CampaignIssue[] };

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const fail = (field: string, code: CampaignIssue['code'], message: string): { ok: false; errors: CampaignIssue[] } => ({ ok: false, errors: [{ field, code, message }] });
const NONE = 'No campaign has been planned for this business yet. Generate one first.';

function scopeIssue(s: CampaignScope): CampaignIssue | null {
  if (typeof s?.workspaceId !== 'string' || !ID.test(s.workspaceId)) return { field: 'workspaceId', code: 'scope', message: 'A workspace is needed for a campaign.' };
  if (typeof s.businessId !== 'string' || !ID.test(s.businessId)) return { field: 'businessId', code: 'scope', message: 'A business is needed for a campaign.' };
  return null;
}
function iso(now: () => Date): string {
  const d = now();
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) throw new TypeError('now must return a valid Date');
  return d.toISOString();
}

/** Plan (or re-plan) the campaign and save it as the business's draft. Nothing is saved when the plan cannot be built. */
export async function regenerateCampaign(deps: CampaignDeps, input: Omit<LaunchCampaignInput, 'now'>, opts: { idempotencyKey?: string } = {}): Promise<CampaignResult> {
  const s = scopeIssue(input);
  if (s) return { ok: false, errors: [s] };
  const built = await buildLaunchCampaign({ ...input, now: deps.now }, { llm: deps.llm, idempotencyKey: opts.idempotencyKey });
  if (!built.ok) return built;
  const at = iso(deps.now);
  const newId = deps.newId ?? (() => globalThis.crypto.randomUUID());
  return deps.store.mutate(input.workspaceId, input.businessId, (cur) => {
    const record: CampaignRecord = {
      id: cur?.id ?? newId(), workspaceId: input.workspaceId, businessId: input.businessId, version: (cur?.version ?? 0) + 1, status: 'draft',
      plan: built.plan, enrichment: built.enrichment, createdAt: cur?.createdAt ?? at, updatedAt: at, approvedAt: null, approvedBy: null,
    };
    return { record, result: { ok: true as const, campaign: record } };
  });
}

/**
 * Approve the draft (owner action, so `approvedBy` is required). `ctx` is the CURRENT brand, listings and store; the saved plan
 * must still be valid against them. `expectedVersion` is required: approval is refused when the plan was regenerated since the owner read it.
 */
export async function approveCampaign(deps: CampaignDeps, ctx: CampaignContext, approvedBy: string, opts: { expectedVersion: number }): Promise<CampaignResult> {
  const s = scopeIssue(ctx);
  if (s) return { ok: false, errors: [s] };
  if (!Number.isInteger(opts?.expectedVersion) || opts.expectedVersion <= 0) return fail('version', 'invalid', 'Say which version of the campaign you are approving. Reload and try again.');
  if (typeof approvedBy !== 'string' || approvedBy.trim().length === 0) return fail('approvedBy', 'invalid', 'Say who is approving this campaign.');
  const at = iso(deps.now);
  return deps.store.mutate<CampaignResult>(ctx.workspaceId, ctx.businessId, (cur) => {
    const keep = <T>(result: T) => ({ record: cur, result });
    if (!cur) return keep(fail('campaign', 'not_found', NONE));
    if (opts.expectedVersion !== cur.version) {
      return keep(fail('version', 'stale', `The campaign changed since you opened it (now version ${cur.version}, you had ${opts.expectedVersion}). Reload and try again.`));
    }
    if (cur.status !== 'draft') return keep(fail('campaign', 'not_draft', 'This campaign is already approved. Regenerate it to start a new draft.'));
    const issues = validateCampaignPlan(cur.plan, ctx);
    if (issues.length) return keep({ ok: false as const, errors: issues });
    const record: CampaignRecord = { ...cur, status: 'approved', approvedAt: at, approvedBy: approvedBy.trim(), updatedAt: at };
    return { record, result: { ok: true as const, campaign: record } };
  });
}

/** The business's campaign (draft or approved), or undefined. Other workspaces always get undefined. */
export async function getCampaign(deps: Pick<CampaignDeps, 'store'>, scope: CampaignScope): Promise<CampaignRecord | undefined> {
  if (scopeIssue(scope)) return undefined;
  return (await deps.store.get(scope.workspaceId, scope.businessId)) ?? undefined;
}

/** The plan AMP-051 may turn into content: only an APPROVED campaign's plan is returned. */
export async function getApprovedCampaign(deps: Pick<CampaignDeps, 'store'>, scope: CampaignScope): Promise<CampaignRecord | undefined> {
  const c = await getCampaign(deps, scope);
  return c?.status === 'approved' ? c : undefined;
}
