// Setter demo from a saved Growth Audit (Build Plan p.8: Growth Audit -> Setter demo -> enquiry -> booking).
// The audit's business details (name, offer, area, audience) become the Setter config for one demo turn. Nothing here is
// saved as a business's settings, nothing is sent, and nothing is scheduled: the demo only answers in the chat window.
import { createHash } from 'node:crypto';
import { checkOpportunity } from '../../audit-sync';
import type { OpportunitySnapshot } from '../../audit-sync';
import { auditToSetterConfig } from '../../audit-to-setter';
import type { Rpc } from '../orchestrator';
import type { SetterConfig } from '../setter/config';

export class AuditDemoInvalid extends Error {}

function checked(value: unknown): OpportunitySnapshot {
  let audit: OpportunitySnapshot;
  try { audit = checkOpportunity(value); } catch (e) { throw new AuditDemoInvalid(e instanceof Error ? e.message : 'Growth audit is not valid.'); }
  if (!audit.business.name.trim()) throw new AuditDemoInvalid('Add the business name to the Growth Audit first.');
  return audit;
}

/** Checks a saved Growth Audit snapshot (as stored by the Growth Audit) and returns the demo Setter config. */
export function auditDemoConfig(value: unknown): SetterConfig {
  const audit = checked(value);
  try { return auditToSetterConfig(audit); } catch (e) { throw new AuditDemoInvalid(e instanceof Error ? e.message : 'Growth audit is not valid.'); }
}

/** Short, stable hash of the audit's business details and answers (key order does not matter). */
export function auditDemoHash(value: unknown): string {
  const { business: b, answers } = checked(value);
  const a = answers as Record<string, unknown>;
  const basis = JSON.stringify([b.name, b.offer, b.area, b.audience, b.industry, Object.keys(a).sort().map(k => [k, a[k]])]);
  return createHash('sha256').update(basis).digest('hex').slice(0, 16);
}

/** The demo contact key: one contact per visitor AND audit, so a different business never inherits earlier messages.
 *  Fits the web-chat visitor rule (^[A-Za-z0-9_-]{16,64}$). */
export function demoSender(visitor: string, auditHash: string): string {
  return visitor.slice(0, 47) + '-' + auditHash;
}

// Store calls a demo turn may never make: no follow-up or reminder jobs (they would text a real number later), no bookings.
const DEMO_SKIPPED = new Set(['fo_schedule_job', 'fo_book']);

/** The store as seen by a demo turn: records the conversation and the lead, never queues or books anything. */
export function demoRpc(rpc: Rpc): Rpc {
  return async (fn, args) => (DEMO_SKIPPED.has(fn) ? null : rpc(fn, args));
}

export const DEMO_NOT_ON = 'This is a demo. The AI Setter demo is not switched on yet, so a person from Ventra will follow up.';
