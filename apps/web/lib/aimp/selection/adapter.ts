// Shape for a database-backed SelectionStore over lib/aimp/data (not wired: AMP-013 may not edit data/** or add migrations).
// It reuses checkNewBusiness so a selection is validated against the same contract the businesses table uses.
// A real store must create the business row and the build job in one transaction under a UNIQUE idempotency key
// (see the report: this needs an RPC and a jobs table/unique key that the current migration does not provide).
import { checkNewBusiness, type NewBusiness } from '../data/index.ts';
import type { SelectionRecord } from './select.ts';

/** What a database store would insert for a selection. Throws AimpRowError if the workspace id is not a uuid etc. */
export function selectionToNewBusiness(record: SelectionRecord): NewBusiness {
  return checkNewBusiness({
    workspaceId: record.workspaceId, blueprintId: record.business.blueprintId,
    blueprintVersion: record.business.blueprintVersion, niche: record.business.niche, model: record.business.model,
  });
}

/** The transactional call a database store needs; implemented by a future Supabase RPC. */
export interface SelectionDb {
  /** Insert business + job when `record.key` is new; otherwise return the stored pair. Atomic. */
  insertOnce(record: SelectionRecord, business: NewBusiness): Promise<{ record: SelectionRecord; created: boolean }>;
}

/** Validate then hand over to the database; keeps the "validate first" rule in one place. */
export async function saveSelection(db: SelectionDb, record: SelectionRecord): Promise<{ record: SelectionRecord; created: boolean }> {
  return db.insertOnce(record, selectionToNewBusiness(record));
}
