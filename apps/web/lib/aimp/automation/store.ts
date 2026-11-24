// AutomationStore: persistence boundary plus the in-memory implementation (tests and the demo page). Every method takes a
// Scope (workspace + business) and only ever sees that business's rows. Methods are synchronous so each is atomic within one
// JS context; the service relies on that for "reserve then enqueue" and "claim the approval, then run".
//
// PROPOSED TABLES (no migration in AMP-061; a later task adds them). Shown for the report; none exist today.
//   aimp_automation_settings(workspace_id, business_id, area, mode, updated_at, primary key (workspace_id, business_id, area),
//     foreign key (workspace_id, business_id) references aimp_businesses (workspace_id, id))
//   aimp_usage_caps(workspace_id, business_id, period_limit int check (period_limit >= 0), primary key (workspace_id, business_id))
//   aimp_usage_reservations(workspace_id, business_id, action_key text, period_key text, at, primary key (workspace_id, business_id, action_key))
//     -- the primary key makes "count once per action" a database fact; cap check = count(*) for the period, inside the same
//        transaction as the insert (SELECT ... FOR UPDATE on the cap row)
//   aimp_approvals(id uuid pk, workspace_id, business_id, area, kind, description, input jsonb, request_hash, request_key,
//     status check in ('pending','approved','rejected','expired'), requested_at, expires_at, decided_at, job_id,
//     unique (workspace_id, business_id, request_key), foreign key (workspace_id, business_id) references aimp_businesses)
//     -- decide = UPDATE ... SET status='approved' WHERE id=$1 AND workspace_id=$2 AND business_id=$3 AND status='pending'; zero rows = already decided
//   aimp_automation_events(id text, workspace_id, business_id, type, area, text, approval_id, at, primary key (workspace_id, business_id, id))
//   RLS on all: owners select their own business rows; no client write policies (service role only).
import type { ApprovalRecord, ApprovalStatus, AutomationArea, AutomationEvent, AutomationMode, Scope } from './types.ts';

export interface AutomationStore {
  getMode(s: Scope, area: AutomationArea): AutomationMode | null;
  setMode(s: Scope, area: AutomationArea, mode: AutomationMode): void;
  getCap(s: Scope): number | null;
  setCap(s: Scope, limit: number): void;
  hasReservation(s: Scope, key: string): boolean;
  addReservation(s: Scope, key: string, periodKey: string, at: number): void;
  removeReservation(s: Scope, key: string): void;
  countReservations(s: Scope, periodKey: string): number;
  insertApproval(a: ApprovalRecord): void;
  getApproval(s: Scope, id: string): ApprovalRecord | null;
  findApprovalByKey(s: Scope, key: string): ApprovalRecord | null;
  updateApproval(s: Scope, id: string, patch: Partial<Pick<ApprovalRecord, 'status' | 'decidedAt' | 'jobId'>>): ApprovalRecord;
  /**
   * Compare-and-set: moves the approval from `from` to `to.status` (and applies decidedAt / jobId) only if its status is still
   * `from`. Resolves false (and changes nothing) when it is not, or when the approval is not this business's. Database:
   * UPDATE ... WHERE id=$1 AND workspace_id=$2 AND business_id=$3 AND status=$4; zero rows = false.
   */
  transitionApproval(s: Scope, id: string, from: ApprovalStatus, to: { status: ApprovalStatus; decidedAt?: number | null; jobId?: string | null }): Promise<boolean>;
  listApprovals(s: Scope): ApprovalRecord[];
  appendEvent(e: AutomationEvent): void;
  listEvents(s: Scope): AutomationEvent[];
  /** Per-business counter so two events in the same millisecond get different ids. */
  nextSequence(s: Scope): number;
  /** Job ids THIS module paused when an area was paused (so only those are resumed). */
  addPausedJob(s: Scope, area: AutomationArea, jobId: string): void;
  listPausedJobs(s: Scope, area: AutomationArea): string[];
  forgetPausedJob(s: Scope, area: AutomationArea, jobId: string): void;
}

const clone = <T>(v: T): T => structuredClone(v);
const sk = (s: Scope) => JSON.stringify([s.workspaceId, s.businessId]);

export function createMemoryAutomationStore(): AutomationStore {
  const modes = new Map<string, AutomationMode>();
  const caps = new Map<string, number>();
  const reservations = new Map<string, { periodKey: string; at: number }>();
  const approvals = new Map<string, ApprovalRecord>();
  const events = new Map<string, AutomationEvent>();
  const sequences = new Map<string, number>();
  const pausedJobs = new Map<string, Set<string>>();
  const mk = (s: Scope, ...rest: string[]) => JSON.stringify([s.workspaceId, s.businessId, ...rest]);
  const own = (s: Scope, id: string): ApprovalRecord | null => {
    const a = approvals.get(id);
    return a && sk(a.scope) === sk(s) ? a : null;
  };
  return {
    getMode: (s, area) => modes.get(mk(s, area)) ?? null,
    setMode: (s, area, mode) => { modes.set(mk(s, area), mode); },
    getCap: (s) => caps.get(sk(s)) ?? null,
    setCap: (s, limit) => { caps.set(sk(s), limit); },
    hasReservation: (s, key) => reservations.has(mk(s, key)),
    addReservation: (s, key, periodKey, at) => { reservations.set(mk(s, key), { periodKey, at }); },
    removeReservation: (s, key) => { reservations.delete(mk(s, key)); },
    countReservations(s, periodKey) {
      let n = 0;
      for (const [k, v] of reservations) {
        const [w, b] = JSON.parse(k) as string[];
        if (w === s.workspaceId && b === s.businessId && v.periodKey === periodKey) n++;
      }
      return n;
    },
    insertApproval: (a) => { approvals.set(a.id, clone(a)); },
    getApproval: (s, id) => { const a = own(s, id); return a ? clone(a) : null; },
    findApprovalByKey(s, key) {
      for (const a of approvals.values()) if (sk(a.scope) === sk(s) && a.requestKey === key) return clone(a);
      return null;
    },
    updateApproval(s, id, patch) {
      const a = own(s, id);
      if (!a) throw new Error('approval not found');
      Object.assign(a, patch);
      return clone(a);
    },
    // Synchronous body: the check and the write cannot interleave with another caller.
    transitionApproval: async (s, id, from, to) => {
      const a = own(s, id);
      if (!a || a.status !== from) return false;
      a.status = to.status;
      if (to.decidedAt !== undefined) a.decidedAt = to.decidedAt;
      if (to.jobId !== undefined) a.jobId = to.jobId;
      return true;
    },
    nextSequence(s) { const n = (sequences.get(sk(s)) ?? 0) + 1; sequences.set(sk(s), n); return n; },
    addPausedJob(s, area, jobId) { const k = mk(s, area); const set = pausedJobs.get(k) ?? new Set<string>(); set.add(jobId); pausedJobs.set(k, set); },
    listPausedJobs: (s, area) => [...(pausedJobs.get(mk(s, area)) ?? [])],
    forgetPausedJob(s, area, jobId) { pausedJobs.get(mk(s, area))?.delete(jobId); },
    listApprovals: (s) => [...approvals.values()].filter((a) => sk(a.scope) === sk(s)).map(clone).sort((x, y) => x.requestedAt - y.requestedAt || x.id.localeCompare(y.id)),
    appendEvent(e) { const k = mk({ workspaceId: e.workspaceId, businessId: e.businessId }, e.id); if (!events.has(k)) events.set(k, clone(e)); },
    listEvents: (s) => [...events.values()].filter((e) => e.workspaceId === s.workspaceId && e.businessId === s.businessId).map(clone),
  };
}
