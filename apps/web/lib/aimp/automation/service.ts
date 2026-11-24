// Automation service (G02, G03, G04, G08). Every call takes an OperationContext with workspaceId AND businessId and only ever
// reads or writes that business. The one gate into JobService.enqueue for gated kinds is start() / decide(): pause, approval and
// the generation allowance are all checked there, at execution time.
// Pausing an area stops NEW jobs of that area AND pauses that business's not-yet-finished jobs of the area (queued, waiting-retry
// or running) through the job engine; a running step's result is discarded and it re-runs on resume. Leaving paused resumes only the jobs this module
// paused. Delivery (`fulfil-order`) is in no area, so it is never paused.
import type { OperationContext } from '../contracts.ts';
import type { JobService } from '../jobs/service.ts';
import { hashInput, isJson, JobsError, safeText, stableStringify } from '../jobs/types.ts';
import type { JobRecord, JsonValue } from '../jobs/types.ts';
import type { AutomationStore } from './store.ts';
import {
  APPROVAL_TTL_MS, AREA_FOR_KIND, AREA_LABELS, AutomationError, automationAreas, automationModes, DEFAULT_CAP, DEFAULT_MODES, GENERATION_KINDS,
  KIND_LABELS, MAX_CAP, MAX_DESCRIPTION, periodOf, STATUS_LABELS, UNGATED_KINDS,
} from './types.ts';
import type {
  ActivityEntry, ActivityFeed, ApprovalRecord, ApprovalView, AutomationArea, AutomationEvent, AutomationEventType, AutomationMode, AutomationSettings,
  DecideResult, RetryResult, Scope, StartResult, UsageSummary,
} from './types.ts';

export interface AutomationService {
  getSettings(ctx: OperationContext): Promise<AutomationSettings>;
  setMode(ctx: OperationContext, area: AutomationArea, mode: AutomationMode): Promise<AutomationSettings>;
  setCap(ctx: OperationContext, limit: number): Promise<AutomationSettings>;
  usage(ctx: OperationContext): Promise<UsageSummary>;
  /** Gate for a job: starts it, or records a pending approval, or refuses (paused, cap). Same ctx.idempotencyKey = same result. */
  start(ctx: OperationContext, req: { kind: string; input?: JsonValue; description?: string }): Promise<StartResult>;
  approvals(ctx: OperationContext, filter?: { status?: ApprovalView['status'] }): Promise<ApprovalView[]>;
  /** Idempotent: repeating the same decision never runs the action again. Only the owning business can decide. */
  decide(ctx: OperationContext, approvalId: string, decision: 'approve' | 'reject'): Promise<DecideResult>;
  activity(ctx: OperationContext, opts?: { limit?: number }): Promise<ActivityFeed>;
  /** Retry a failed job of THIS business (completed steps are not repeated). Another business's job answers not_found. */
  retryJob(ctx: OperationContext, jobId: string): Promise<RetryResult>;
}

export interface AutomationServiceOptions {
  store: AutomationStore;
  jobs: JobService;
  now?: () => number;
  newId?: () => string;
  /** Default AI generations per period when the owner has not set one. */
  defaultCap?: number;
}

function scopeOf(ctx: OperationContext): Scope {
  const ok = (s: unknown, max: number) => typeof s === 'string' && s.length > 0 && s.length <= max;
  if (!ctx || !ok(ctx.workspaceId, 100)) throw new AutomationError('invalid', 'A workspace is required.');
  if (!ok(ctx.businessId, 100)) throw new AutomationError('invalid', 'A business is required.');
  if (!ok(ctx.actorUserId, 100)) throw new AutomationError('invalid', 'Who is making this change is required.');
  return { workspaceId: ctx.workspaceId, businessId: ctx.businessId as string };
}

const view = (a: ApprovalRecord): ApprovalView => ({
  id: a.id, area: a.area, kind: a.kind, description: a.description, status: a.status,
  requestedAt: a.requestedAt, expiresAt: a.expiresAt, decidedAt: a.decidedAt, jobId: a.jobId,
});
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const time = (ms: number) => `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`;

export function createAutomationService(opts: AutomationServiceOptions): AutomationService {
  const { store, jobs } = opts;
  const now = opts.now ?? Date.now;
  const newId = opts.newId ?? (() => globalThis.crypto.randomUUID());
  const defaultCap = opts.defaultCap ?? DEFAULT_CAP;

  const modeOf = (s: Scope, area: AutomationArea): AutomationMode => store.getMode(s, area) ?? DEFAULT_MODES[area];
  function usageOf(s: Scope): UsageSummary {
    const p = periodOf(now());
    const limit = store.getCap(s) ?? defaultCap;
    const used = store.countReservations(s, p.key);
    return { used, limit, remaining: Math.max(0, limit - used), periodKey: p.key, resetsAt: p.resetsAt, reached: used >= limit };
  }
  const settingsOf = (s: Scope): AutomationSettings => ({
    modes: Object.fromEntries(automationAreas.map((a) => [a, modeOf(s, a)])) as AutomationSettings['modes'],
    usage: usageOf(s),
  });
  function record(s: Scope, id: string, type: AutomationEventType, area: AutomationArea | null, text: string, approvalId: string | null = null): void {
    const e: AutomationEvent = { schemaVersion: 1, id, type, workspaceId: s.workspaceId, businessId: s.businessId, at: now(), area, text: safeText(text), approvalId };
    store.appendEvent(e);
  }
  const capMessage = (u: UsageSummary) =>
    `You have used all ${u.limit} AI generations for this period. New generation is paused until ${day(u.resetsAt)}. Orders and deliveries are not affected.`;
  const pausedMessage = (area: AutomationArea) => `${AREA_LABELS[area]} is paused, so this was not started. Deliveries are unchanged.`;

  /** Takes one generation from the allowance, once per key. Returns the usage when refused. */
  function reserve(s: Scope, key: string): { refused: UsageSummary | null; added: boolean } {
    if (store.hasReservation(s, key)) return { refused: null, added: false };
    const u = usageOf(s);
    if (u.reached) return { refused: u, added: false };
    store.addReservation(s, key, u.periodKey, now());
    return { refused: null, added: true };
  }

  /** Expires a due pending approval with a compare-and-set, so it can never overwrite a decision made in the meantime. */
  async function expireIfDue(s: Scope, a: ApprovalRecord): Promise<ApprovalRecord> {
    if (a.status !== 'pending' || now() < a.expiresAt) return a;
    if (await store.transitionApproval(s, a.id, 'pending', { status: 'expired', decidedAt: now() })) {
      record(s, `approval:${a.id}:expired`, 'approval-expired', a.area, `This request expired and was not run: ${a.description}`, a.id);
    }
    return store.getApproval(s, a.id) ?? a; // whoever won, the stored state is the truth
  }
  const refreshed = async (s: Scope): Promise<ApprovalRecord[]> => Promise.all(store.listApprovals(s).map((a) => expireIfDue(s, a)));
  const seqId = (s: Scope, base: string) => `${base}:${store.nextSequence(s)}`;
  const jobCtx = (ctx: OperationContext, s: Scope): OperationContext => ({ ...ctx, workspaceId: s.workspaceId, businessId: s.businessId });

  /** Pauses this business's not-yet-finished jobs of the area. A running step is left to finish. Remembers what it paused. */
  async function pauseAreaJobs(ctx: OperationContext, s: Scope, area: AutomationArea): Promise<void> {
    const jc = jobCtx(ctx, s);
    for (const j of await jobs.list(jc)) {
      if (j.workspaceId !== s.workspaceId || j.businessId !== s.businessId || AREA_FOR_KIND[j.kind] !== area) continue;
      // `running` is included: the engine's pause takes the lease, discards the in-flight step's result and re-runs that step on
      // resume under the same step key, so a multi-step job cannot slip its next step in while the area shows Paused.
      if (j.status !== 'queued' && j.status !== 'waiting-retry' && j.status !== 'running') continue;
      store.addPausedJob(s, area, j.id); // remembered first, so a crash after the pause can still be undone
      try { await jobs.pause(jc, j.id, s.businessId); } catch (e) {
        store.forgetPausedJob(s, area, j.id);
        if (e instanceof JobsError) continue; // it finished or was cancelled in the meantime
        throw e;
      }
      record(s, seqId(s, `job-paused:${j.id}`), 'jobs-paused', area, `Paused because ${AREA_LABELS[area]} is paused: ${KIND_LABELS[j.kind] ?? j.kind} will not run until you switch it back on.`);
    }
  }
  /** Resumes only the jobs this module paused for the area, and only if they are still paused. */
  async function resumeAreaJobs(ctx: OperationContext, s: Scope, area: AutomationArea): Promise<void> {
    const jc = jobCtx(ctx, s);
    for (const id of store.listPausedJobs(s, area)) {
      let j: JobRecord | null = null;
      try { j = await jobs.get(jc, id, s.businessId); } catch (e) { if (!(e instanceof JobsError)) throw e; }
      if (j && j.status === 'paused') {
        try {
          await jobs.resume(jc, id);
          record(s, seqId(s, `job-resumed:${id}`), 'jobs-resumed', area, `Resumed because ${AREA_LABELS[area]} is on again: ${KIND_LABELS[j.kind] ?? j.kind}.`);
        } catch (e) { if (!(e instanceof JobsError)) throw e; }
      }
      store.forgetPausedJob(s, area, id);
    }
  }

  async function enqueueFor(ctx: OperationContext, s: Scope, key: string, kind: string, input: JsonValue) {
    // The job engine makes keys unique per WORKSPACE + kind. Two businesses in one workspace must not share a key space, or the
    // second would be handed the first one's job, so the key is namespaced by business (business id and key are each capped).
    return jobs.enqueue({ ...ctx, workspaceId: s.workspaceId, businessId: s.businessId, idempotencyKey: `${s.businessId}:${key}` }, { kind, input });
  }

  return {
    async getSettings(ctx) { return settingsOf(scopeOf(ctx)); },

    async setMode(ctx, area, mode) {
      const s = scopeOf(ctx);
      if (!automationAreas.includes(area)) throw new AutomationError('invalid', 'That automation area does not exist.');
      if (!automationModes.includes(mode)) throw new AutomationError('invalid', 'That mode is not available.');
      const before = modeOf(s, area);
      if (before !== mode) {
        store.setMode(s, area, mode);
        record(s, seqId(s, `mode:${area}:${now()}:${mode}`), 'mode-changed', area, `${AREA_LABELS[area]} changed from "${before}" to "${mode}".${mode === 'paused' ? ' Nothing new will start and scheduled work is paused; a step already running will finish. Deliveries are unchanged.' : ''}`);
      }
      // Run the sweep even when the mode did not change: a pause or resume that failed half way is repaired by asking again.
      // Both sweeps are idempotent and record nothing for jobs already in the right state.
      if (mode === 'paused') await pauseAreaJobs(ctx, s, area);
      else await resumeAreaJobs(ctx, s, area);
      return settingsOf(s);
    },

    async setCap(ctx, limit) {
      const s = scopeOf(ctx);
      if (!Number.isInteger(limit) || limit < 0 || limit > MAX_CAP) throw new AutomationError('invalid', `The allowance must be a whole number from 0 to ${MAX_CAP}.`);
      if ((store.getCap(s) ?? defaultCap) !== limit) {
        store.setCap(s, limit);
        record(s, seqId(s, `cap:${now()}:${limit}`), 'cap-changed', 'product-generation', `The AI generation allowance is now ${limit} per period.`);
      }
      return settingsOf(s);
    },

    async usage(ctx) { return usageOf(scopeOf(ctx)); },

    async start(ctx, req) {
      const s = scopeOf(ctx);
      if (typeof ctx.idempotencyKey !== 'string' || ctx.idempotencyKey.length === 0 || ctx.idempotencyKey.length > 99) throw new AutomationError('invalid', 'An idempotency key is required (up to 99 characters).');
      const input: JsonValue = req.input ?? {};
      if (!isJson(input) || stableStringify(input).length > 20_000) throw new AutomationError('invalid', 'The input must be plain JSON under 20 KB.');
      const key = ctx.idempotencyKey;

      if (UNGATED_KINDS.includes(req.kind)) {
        // Paid work: never paused, never counted, never held for approval.
        const { job, created } = await enqueueFor(ctx, s, key, req.kind, input);
        return { outcome: 'started', jobId: job.id, jobStatus: job.status, created, message: 'Started.' };
      }
      const area = AREA_FOR_KIND[req.kind];
      if (!area) throw new AutomationError('invalid', 'That kind of action is not covered by automation settings.');
      const mode = modeOf(s, area);
      const isGen = GENERATION_KINDS.includes(req.kind);

      if (mode === 'paused') {
        const message = pausedMessage(area);
        record(s, `blocked:${area}:${key}`, 'blocked-paused', area, `${KIND_LABELS[req.kind] ?? req.kind} was not started because ${AREA_LABELS[area]} is paused.`);
        return { outcome: 'paused', message };
      }

      // A key that already has an approval keeps that approval's fate whatever the mode is now: a rejected or expired one never
      // runs (not even if the mode was switched to automatic), a pending one stays the single waiting request, an approved one
      // returns its one job.
      const hash = hashInput({ kind: req.kind, input });
      const found = store.findApprovalByKey(s, key);
      if (found) {
        const existing = await expireIfDue(s, found);
        if (existing.requestHash !== hash) throw new AutomationError('conflict', 'That request key was already used for a different request.');
        if (existing.status === 'rejected' || existing.status === 'expired') {
          return {
            outcome: 'already_decided', decision: existing.status, approvalId: existing.id,
            message: existing.status === 'rejected'
              ? 'This request was rejected, so it was not run. Ask again as a new request if you still want it.'
              : 'This request expired and was not run. Ask again as a new request if you still want it.',
          };
        }
        if (existing.status === 'approved') {
          // Recovery after a crash (approved, no job id yet): the job may not exist, so it takes its generation slot like decide() does
          // (the slot is keyed by the approval, so one already taken before the crash is not taken twice).
          const jobKey = `approval-${existing.id}`;
          let reservedNow = false;
          if (GENERATION_KINDS.includes(existing.kind)) {
            const r = reserve(s, jobKey);
            if (r.refused) {
              record(s, `blocked-cap:approval:${existing.id}`, 'blocked-cap', existing.area, `Approving "${existing.description}" could not start: the AI generation allowance (${r.refused.limit}) is used up until ${day(r.refused.resetsAt)}.`, existing.id);
              return { outcome: 'cap_reached', message: capMessage(r.refused), usage: r.refused };
            }
            reservedNow = r.added;
          }
          try {
            const { job, created } = await enqueueFor(ctx, s, jobKey, existing.kind, existing.input as JsonValue);
            return { outcome: 'started', jobId: job.id, jobStatus: job.status, created, message: 'Already approved and started.' };
          } catch (e) {
            if (reservedNow) store.removeReservation(s, jobKey);
            throw e;
          }
        }
        return { outcome: 'needs_approval', approvalId: existing.id, created: false, message: 'This is waiting for your approval. Nothing has been started.' };
      }

      if (mode === 'owner_approval') {
        // The same key may already have started a job while the mode was automatic. Answer as a duplicate of it: an approval
        // would use a different job key (approval-<id>) and run the work a second time.
        const originalKey = `${s.businessId}:${key}`;
        const dup = (await jobs.list(jobCtx(ctx, s))).find((j) => j.workspaceId === s.workspaceId && j.businessId === s.businessId && j.kind === req.kind && j.idempotencyKey === originalKey);
        if (dup) {
          if (stableStringify(dup.input) !== stableStringify(input)) throw new AutomationError('conflict', 'That request key was already used for a different request.');
          return { outcome: 'started', jobId: dup.id, jobStatus: dup.status, created: false, message: 'Already started.' };
        }
        if (isGen && usageOf(s).reached) {
          const u = usageOf(s);
          record(s, `blocked-cap:${key}`, 'blocked-cap', area, `${KIND_LABELS[req.kind]} was not requested: the AI generation allowance (${u.limit}) is used up until ${day(u.resetsAt)}.`);
          return { outcome: 'cap_reached', message: capMessage(u), usage: u };
        }
        const id = newId();
        const description = safeText((req.description ?? `${KIND_LABELS[req.kind] ?? req.kind}`).trim() || `${KIND_LABELS[req.kind] ?? req.kind}`).slice(0, MAX_DESCRIPTION);
        store.insertApproval({
          id, scope: s, area, kind: req.kind, description, input: structuredClone(input), requestHash: hash, requestKey: key,
          status: 'pending', requestedAt: now(), expiresAt: now() + APPROVAL_TTL_MS, decidedAt: null, jobId: null,
        });
        record(s, `approval:${id}:requested`, 'approval-requested', area, `Waiting for you: ${description}`, id);
        return { outcome: 'needs_approval', approvalId: id, created: true, message: 'This is waiting for your approval. Nothing has been started.' };
      }

      // automatic
      let reservedHere = false;
      if (isGen) {
        const r = reserve(s, key);
        if (r.refused) {
          record(s, `blocked-cap:${key}`, 'blocked-cap', area, `${KIND_LABELS[req.kind]} was not started: the AI generation allowance (${r.refused.limit}) is used up until ${day(r.refused.resetsAt)}.`);
          return { outcome: 'cap_reached', message: capMessage(r.refused), usage: r.refused };
        }
        reservedHere = r.added;
      }
      try {
        const { job, created } = await enqueueFor(ctx, s, key, req.kind, input);
        return { outcome: 'started', jobId: job.id, jobStatus: job.status, created, message: 'Started.' };
      } catch (e) {
        if (reservedHere) store.removeReservation(s, key);
        throw e;
      }
    },

    async approvals(ctx, filter) {
      const s = scopeOf(ctx);
      return (await refreshed(s)).filter((a) => !filter?.status || a.status === filter.status).map(view).reverse();
    },

    async decide(ctx, approvalId, decision) {
      const s = scopeOf(ctx);
      if (decision !== 'approve' && decision !== 'reject') throw new AutomationError('invalid', 'Choose approve or reject.');
      // Scope is part of the lookup: another business gets the same answer as a missing id.
      const found = typeof approvalId === 'string' ? store.getApproval(s, approvalId) : null;
      if (!found) throw new AutomationError('not_found', 'Approval not found.');
      const a = await expireIfDue(s, found);

      /** Answer for an approval that is not pending (already decided, or lost a race to a concurrent decision). */
      const answerDecided = (cur: ApprovalRecord): DecideResult => {
        if (cur.status === 'expired') {
          if (decision === 'approve') throw new AutomationError('expired', 'This request expired and was not run. Ask for it again.');
          return { approval: view(cur), ran: false, alreadyDecided: true, message: 'This request had already expired.' };
        }
        if (cur.status === 'pending') throw new AutomationError('conflict', 'This request changed at the same moment. Please try again.');
        const same = (decision === 'approve') === (cur.status === 'approved');
        if (!same) throw new AutomationError('conflict', `This was already ${cur.status}. It cannot be changed.`);
        return { approval: view(cur), ran: false, alreadyDecided: true, message: `Already ${cur.status}. Nothing was run again.` };
      };
      const latest = (): ApprovalRecord => store.getApproval(s, a.id) ?? a;
      if (a.status !== 'pending') return answerDecided(a);

      if (decision === 'reject') {
        if (!(await store.transitionApproval(s, a.id, 'pending', { status: 'rejected', decidedAt: now() }))) return answerDecided(latest());
        record(s, `approval:${a.id}:rejected`, 'approval-rejected', a.area, `You rejected: ${a.description}`, a.id);
        return { approval: view(latest()), ran: false, alreadyDecided: false, message: 'Rejected. It will not run.' };
      }

      // Approve. The claim below is a compare-and-set on `pending`, so two simultaneous approvals cannot both pass it.
      if (modeOf(s, a.area) === 'paused') {
        record(s, `blocked:approval:${a.id}`, 'blocked-paused', a.area, `Approving "${a.description}" was refused because ${AREA_LABELS[a.area]} is paused.`, a.id);
        throw new AutomationError('blocked', `${AREA_LABELS[a.area]} is paused, so this cannot start. Turn it back on or reject the request.`);
      }
      const jobKey = `approval-${a.id}`;
      if (!(await store.transitionApproval(s, a.id, 'pending', { status: 'approved', decidedAt: now() }))) return answerDecided(latest());
      const revert = () => store.transitionApproval(s, a.id, 'approved', { status: 'pending', decidedAt: null });
      if (GENERATION_KINDS.includes(a.kind)) {
        const r = reserve(s, jobKey);
        if (r.refused) {
          await revert();
          record(s, `blocked-cap:approval:${a.id}`, 'blocked-cap', a.area, `Approving "${a.description}" was refused: the AI generation allowance (${r.refused.limit}) is used up until ${day(r.refused.resetsAt)}.`, a.id);
          throw new AutomationError('blocked', capMessage(r.refused));
        }
      }
      let job: JobRecord;
      try {
        ({ job } = await enqueueFor(ctx, s, jobKey, a.kind, a.input as JsonValue));
      } catch (e) {
        // Nothing started: put the request back so the owner can try again.
        await revert();
        // Released whether this call took the slot or an earlier attempt did: a pending request holds no slot. Removing by key is
        // idempotent, so a second revert cannot release anything else, and approving again takes the slot once.
        store.removeReservation(s, jobKey);
        throw e;
      }
      // The job exists from here on. If this write fails the approval stays approved with the slot kept, and start() with the same
      // key finds the same job (the job key is stable) instead of a second one.
      await store.transitionApproval(s, a.id, 'approved', { status: 'approved', jobId: job.id });
      record(s, `approval:${a.id}:approved`, 'approval-approved', a.area, `You approved: ${a.description}`, a.id);
      return { approval: view(latest()), ran: true, alreadyDecided: false, message: 'Approved. It has been started.' };
    },

    async retryJob(ctx, jobId) {
      const s = scopeOf(ctx);
      if (typeof jobId !== 'string' || jobId.length === 0 || jobId.length > 100) throw new AutomationError('not_found', 'Job not found.');
      try {
        const j = await jobs.retry(jobCtx(ctx, s), jobId, s.businessId);
        record(s, seqId(s, `job-retried:${j.id}`), 'job-retried', AREA_FOR_KIND[j.kind] ?? null, `You chose Retry: ${KIND_LABELS[j.kind] ?? j.kind}. Steps already finished are not repeated.`);
        return { jobId: j.id, jobStatus: j.status, message: 'Retrying now. Steps already finished are not repeated.' };
      } catch (e) {
        if (e instanceof JobsError) throw new AutomationError(e.code === 'not_found' ? 'not_found' : 'conflict', e.code === 'not_found' ? 'Job not found.' : safeText(e.message));
        throw e;
      }
    },

    async activity(ctx, o = {}) {
      const s = scopeOf(ctx);
      const approvals = await refreshed(s);
      const byId = new Map(approvals.map((a) => [a.id, a]));
      const entries: ActivityEntry[] = [];
      const base = { nextAction: null, nextRetryAt: null, approvalId: null, jobId: null, needsOwner: false, area: null } as const;

      for (const e of store.listEvents(s)) {
        const a = e.approvalId ? byId.get(e.approvalId) : undefined;
        if (e.type === 'approval-requested' && a?.status === 'pending') continue; // shown below as the live "Needs you" row
        const limit = e.type === 'blocked-cap' || e.type === 'cap-changed';
        const status = e.type === 'blocked-paused' || e.type === 'blocked-cap' || e.type === 'jobs-paused' ? 'paused' : e.type === 'approval-rejected' || e.type === 'approval-expired' ? 'cancelled' : 'complete';
        entries.push({
          ...base, id: `event:${e.id}`, at: e.at, source: e.type.startsWith('approval') ? 'approval' : limit ? 'limit' : e.type.startsWith('job') ? 'job' : 'setting', status, label: STATUS_LABELS[status],
          title: e.text, detail: null, area: e.area, approvalId: e.approvalId,
          nextAction: e.type === 'blocked-cap' ? `It resets on the next period, or raise the allowance in settings.` : e.type === 'blocked-paused' ? 'Switch the area back on when you are ready.' : null,
        });
      }
      for (const a of approvals) {
        if (a.status !== 'pending') continue;
        entries.push({
          ...base, id: `approval:${a.id}`, at: a.requestedAt, source: 'approval', status: 'needs_approval', label: STATUS_LABELS.needs_approval, title: a.description,
          detail: `Expires ${time(a.expiresAt)}. Nothing has started.`, area: a.area, needsOwner: true, nextAction: 'Approve or reject.', approvalId: a.id,
        });
      }
      for (const j of await jobs.list(ctx)) {
        if (j.workspaceId !== s.workspaceId || j.businessId !== s.businessId) continue;
        entries.push(jobEntry(j));
      }

      entries.sort((x, y) => y.at - x.at || x.id.localeCompare(y.id));
      const limited = entries.slice(0, Math.min(500, Math.max(1, o.limit ?? 100)));
      return {
        entries: limited,
        needsYou: entries.filter((e) => e.needsOwner).length,
        failed: entries.filter((e) => e.source === 'job' && e.status === 'failed').length,
        retrying: entries.filter((e) => e.status === 'waiting-retry').length,
      };
    },
  };
}

/** Plain-English row for a job. Never includes the input, idempotency key, lease owner or provider detail. */
function jobEntry(j: JobRecord): ActivityEntry {
  const title = KIND_LABELS[j.kind] ?? j.kind;
  const retried = Math.max(0, j.attempts - j.steps.filter((x) => x.status === 'succeeded').length);
  const e: ActivityEntry = {
    id: `job:${j.id}`, at: j.updatedAt, source: 'job', status: j.status, label: STATUS_LABELS[j.status], title, detail: null, area: AREA_FOR_KIND[j.kind] ?? null,
    needsOwner: false, nextAction: null, nextRetryAt: null, approvalId: null, jobId: j.id,
  };
  if (j.status === 'succeeded') e.detail = retried > 0 ? `Finished after ${retried} retr${retried === 1 ? 'y' : 'ies'}.` : 'Finished.';
  else if (j.status === 'failed') { e.detail = j.lastError ?? 'It stopped.'; e.nextAction = 'Choose Retry. Steps already finished are not repeated.'; e.needsOwner = true; }
  else if (j.status === 'waiting-retry') { e.detail = `${j.lastError ?? 'A temporary problem.'} Trying again automatically.`; e.nextRetryAt = j.nextRunAt; }
  else if (j.status === 'paused') { e.detail = j.lastError ?? 'Paused.'; e.nextAction = 'Resume the job when you are ready.'; }
  else if (j.status === 'queued') e.detail = 'Waiting to start.';
  else if (j.status === 'running') e.detail = 'In progress.';
  else e.detail = 'Cancelled.';
  if (e.detail) e.detail = safeText(e.detail);
  return e;
}
