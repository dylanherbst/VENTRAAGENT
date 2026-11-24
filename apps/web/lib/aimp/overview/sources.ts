// AMP-091 source adapters for the Business Overview (H01): seller readiness, fulfilment and money events, visits.
// Each adapter wraps a REAL existing service store and fits one `OverviewDeps` seam. Plain functions; no I/O of their own.
//
// Real sources:  seller readiness (SellerAccountStore + deriveReadiness), fulfilment (FulfilmentStore.list), money events
//                (FulfilmentStore.listMoneyEvents: refunds, partial refunds, disputes, refund exceptions).
// Absent source: visits. The repo has no per-business visit counter (lib/aimp/analytics.ts is marketing-site `track()` only, and
//                has no business id or reader). `createAbsentVisitsSource` answers null, which the read model shows as
//                "not measured yet"; it never answers 0. `createVisitsSource` is the port a real counter plugs into later.
//
// Tenant isolation: the seller store is read with workspace AND business (null for any other workspace). The fulfilment store lists
// per workspace only (gap: no list-by-business), so these adapters filter to the business here, and `collect` filters again.
import type { FulfilmentStore } from '../fulfilment/types.ts';
import { deriveReadiness } from '../sellers/readiness.ts';
import type { SellerAccountStore } from '../sellers/store.ts';
import type { OverviewDeps, OverviewDelivery, OverviewMoneyEvent, OverviewScope, Tenanted } from './types.ts';

import { isSampleSellerAccountId } from '../sellers/sample.ts';

export type SellerSource = OverviewDeps['seller'];
export type FulfilmentSource = OverviewDeps['fulfilment'];
export type VisitsSource = NonNullable<OverviewDeps['analytics']>;

const inBusiness = <T extends OverviewScope>(rows: T[], s: OverviewScope): T[] => rows.filter((r) => r.workspaceId === s.workspaceId && r.businessId === s.businessId);

/** Seller readiness for one business. No account on file (or an account in another workspace) reads as `not_connected`. */
export function createSellerSource(store: Pick<SellerAccountStore, 'get'>): SellerSource {
  // A sample (fixture) seller from a test purchase is not a connected payments account: it reads as not connected here.
  return { readiness: async (s) => { const snap = store.get(s.workspaceId, s.businessId)?.snapshot ?? null; return deriveReadiness(snap && !isSampleSellerAccountId(snap.id) ? snap : null); } };
}

/** Fulfilment records and refund / dispute events for one business, mapped to the overview shapes. No buyer email, token or link is copied. */
export function createFulfilmentSource(store: Pick<FulfilmentStore, 'list' | 'listMoneyEvents'>): FulfilmentSource {
  return {
    list: async (s) => inBusiness(
      (await store.list(s.workspaceId)).map((f): Tenanted<OverviewDelivery> => ({
        orderId: f.orderId, status: f.status, attempts: f.attempts, maxAttempts: f.maxAttempts, lastError: f.delivery.lastError, updatedAt: f.updatedAt,
        workspaceId: f.workspaceId, businessId: f.businessId,
      })), s),
    moneyEvents: async (s) => inBusiness(
      (await store.listMoneyEvents(s.workspaceId)).map((e): Tenanted<OverviewMoneyEvent> => ({
        eventId: e.eventId, kind: e.kind, orderId: e.orderId, amountMinor: e.amountMinor, needsOwner: e.needsOwner, at: e.at,
        workspaceId: e.workspaceId, businessId: e.businessId,
      })), s),
  };
}

/** No visit counter exists: visits are unknown (null), never 0. */
export function createAbsentVisitsSource(): VisitsSource {
  return { visits: async () => null };
}

/**
 * The port a real visit counter plugs into. `read` returns the visit count for ONE business, or null when it cannot say.
 * Anything that is not a non-negative safe integer (NaN, negative, fraction, string) is treated as unknown, not as a number.
 */
export function createVisitsSource(read: (scope: OverviewScope) => Promise<number | null | undefined>): VisitsSource {
  return {
    visits: async (s) => {
      const v = await read({ workspaceId: s.workspaceId, businessId: s.businessId });
      return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;
    },
  };
}

/** What is real and what is absent, for the page to show honestly. */
export const OVERVIEW_SOURCE_STATUS = {
  seller: 'real', fulfilment: 'real', moneyEvents: 'real', visits: 'absent',
} as const;
