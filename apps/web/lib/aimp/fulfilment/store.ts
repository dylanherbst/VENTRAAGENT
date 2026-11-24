// In-memory FulfilmentStore (AMP-042). Every method runs synchronously inside one JS turn, so two calls started together cannot
// interleave (a database does the same with a unique index on order_id and conditional UPDATEs; see aimp_fulfilment.sql).
import type { Entitlement, Fulfilment, FulfilmentAuditEntry, FulfilmentStore, MoneyEvent } from './types.ts';

const clone = <T>(v: T): T => structuredClone(v);
export const FULFILMENT_AUDIT_CAP = 2000;
/** Memory store only: the oldest refund / dispute event rows are dropped past this, so a flood of events cannot grow without limit. */
export const FULFILMENT_MONEY_EVENT_CAP = 5000;

export function createMemoryFulfilmentStore(): FulfilmentStore {
  const byOrder = new Map<string, Fulfilment>();
  const entitlements = new Map<string, Entitlement>();
  const events = new Map<string, MoneyEvent>();
  const audit: FulfilmentAuditEntry[] = [];
  let seq = 0;
  const mine = (ws: string, orderId: string): Fulfilment | null => {
    const f = byOrder.get(orderId);
    return f && f.workspaceId === ws ? f : null;
  };

  return {
    kind: 'memory',
    async createForOrder(nf, ne) {
      const existing = byOrder.get(nf.orderId);
      if (existing) {
        // An order id belongs to one workspace. A second workspace can never attach to it.
        if (existing.workspaceId !== nf.workspaceId) throw new Error('That order belongs to another workspace.');
        return { fulfilment: clone(existing), entitlement: clone(entitlements.get(nf.orderId) as Entitlement), created: false };
      }
      const f: Fulfilment = {
        ...clone(nf), status: 'queued', attempts: 0, attemptLog: [], leaseUntil: null, reissues: 0, reissueRequest: null, updatedAt: nf.createdAt,
        delivery: { deliveredAt: null, emailMessageId: null, emailIdempotencyKey: null, lastError: null },
      };
      const e: Entitlement = { ...clone(ne), grantId: null, grantExpiresAt: null, status: 'active', revokedAt: null };
      byOrder.set(f.orderId, f);
      entitlements.set(f.orderId, e);
      return { fulfilment: clone(f), entitlement: clone(e), created: true };
    },
    async get(ws, orderId) { const f = mine(ws, orderId); return f ? clone(f) : null; },
    async getEntitlement(ws, orderId) { const e = entitlements.get(orderId); return e && e.workspaceId === ws ? clone(e) : null; },
    async list(ws) { return [...byOrder.values()].filter((f) => f.workspaceId === ws).map(clone); },

    async claimAttempt(ws, orderId, input) {
      const f = mine(ws, orderId);
      if (!f) return null;
      const expired = f.status === 'delivering' && f.leaseUntil !== null && Date.parse(f.leaseUntil) <= Date.parse(input.at);
      if (f.status !== 'queued' && f.status !== 'failed' && !expired) return null;
      if (expired) {
        // The attempt that held the lease died. It stays in the log as abandoned.
        const dead = f.attemptLog.find((a) => a.n === f.attempts && a.outcome === 'running');
        if (dead) { dead.outcome = 'abandoned'; dead.finishedAt = input.at; }
        if (f.attempts >= f.maxAttempts) { f.status = 'needs_review'; f.leaseUntil = null; f.updatedAt = input.at; return null; }
      }
      if (f.attempts >= f.maxAttempts) return null;
      f.attempts += 1;
      f.status = 'delivering';
      f.leaseUntil = input.leaseUntil;
      f.updatedAt = input.at;
      f.attemptLog.push({ n: f.attempts, trigger: input.trigger, startedAt: input.at, finishedAt: null, outcome: 'running', error: null, grantId: null });
      return clone(f);
    },

    async settleAttempt(ws, orderId, n, r) {
      const f = mine(ws, orderId);
      if (!f || f.status !== 'delivering' || f.attempts !== n) return null;
      const a = f.attemptLog.find((x) => x.n === n);
      if (!a || a.outcome !== 'running') return null;
      a.finishedAt = r.at;
      a.grantId = r.grantId;
      f.leaseUntil = null;
      f.updatedAt = r.at;
      if (r.ok) {
        a.outcome = 'delivered';
        f.status = 'delivered';
        f.delivery = { deliveredAt: r.at, emailMessageId: r.emailMessageId, emailIdempotencyKey: r.emailIdempotencyKey, lastError: null };
      } else {
        a.outcome = 'failed';
        a.error = r.error;
        f.delivery.lastError = r.error;
        f.status = r.revoked ? 'revoked' : r.needsReview || f.attempts >= f.maxAttempts ? 'needs_review' : 'failed';
      }
      return clone(f);
    },

    async setGrant(ws, orderId, grant) {
      const e = entitlements.get(orderId);
      if (!e || e.workspaceId !== ws || e.status !== 'active') return null;
      e.grantId = grant.id;
      e.grantExpiresAt = grant.expiresAt;
      return clone(e);
    },

    async claimReissue(ws, orderId, input) {
      const f = mine(ws, orderId);
      if (!f || f.status === 'revoked') return null;
      const r = f.reissueRequest;
      if (r && r.key === input.key) {
        const recent = Date.parse(r.at) > Date.parse(input.staleBefore);
        // Same request again: still being sent (and not abandoned), or already sent.
        if (r.grantId === null ? recent : input.sticky || recent) return { claimed: false, grantId: r.grantId };
      }
      f.reissueRequest = { key: input.key, at: input.at, grantId: null };
      return { claimed: true };
    },

    async releaseReissue(ws, orderId, key) {
      const f = mine(ws, orderId);
      if (f && f.reissueRequest?.key === key && f.reissueRequest.grantId === null) f.reissueRequest = null;
    },

    async recordReissue(ws, orderId, input) {
      const f = mine(ws, orderId);
      if (!f || f.status === 'revoked') return null;
      if (input.requestKey !== undefined && f.reissueRequest?.key === input.requestKey) f.reissueRequest.grantId = input.grantId;
      f.reissues += 1;
      f.updatedAt = input.at;
      // A reissue that reached the buyer also resolves a failed or parked delivery. A running attempt keeps its lease.
      if (f.status !== 'delivering') { f.status = 'delivered'; f.leaseUntil = null; }
      f.delivery = { deliveredAt: input.at, emailMessageId: input.emailMessageId, emailIdempotencyKey: input.emailIdempotencyKey, lastError: null };
      return clone(f);
    },

    async revoke(ws, orderId, at) {
      const f = mine(ws, orderId);
      const e = entitlements.get(orderId);
      if (!f || !e) return null;
      const changed = f.status !== 'revoked' || e.status !== 'revoked';
      if (changed) {
        const running = f.attemptLog.find((a) => a.outcome === 'running');
        if (running) { running.outcome = 'abandoned'; running.finishedAt = at; }
        f.status = 'revoked'; f.leaseUntil = null; f.updatedAt = at;
        e.status = 'revoked'; e.revokedAt ??= at;
      }
      return { fulfilment: clone(f), entitlement: clone(e), changed };
    },

    async hasMoneyEvent(eventId) { return events.has(eventId); },
    async recordMoneyEvent(ev) {
      if (events.has(ev.eventId)) return false;
      if (events.size >= FULFILMENT_MONEY_EVENT_CAP) { const oldest = events.keys().next().value; if (oldest !== undefined) events.delete(oldest); }
      events.set(ev.eventId, clone(ev));
      return true;
    },
    async listMoneyEvents(ws) { return [...events.values()].filter((e) => e.workspaceId === ws).map(clone); },

    async appendAudit(e) {
      if (audit.length >= FULFILMENT_AUDIT_CAP) audit.shift();
      audit.push({ ...e, seq: ++seq });
    },
    async listAudit(ws) { return audit.filter((e) => e.workspaceId === ws).map((e) => ({ ...e })); },
  };
}
