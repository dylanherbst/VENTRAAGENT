import { auditKey, restoreAudit, validateAudit, writeCompared } from './ventra-workspace.ts';
import type { Audit, AuditAction, LocalStorage } from './ventra-workspace.ts';
import { aud, calculate, rangeText, validateAnswers, validateAssumptions } from './growth-opportunity.ts';
import type { AuditAnswers, AuditBusiness, Assumptions, Finding } from './growth-opportunity.ts';

// The workspace growth audit is one JSON object under `auditKey`; the account copy (launcher kind "growth-audit") is the
// same object. The Growth Audit calculator's result is stored inside it as `opportunity`, so it syncs with the same
// account panel. The owner's manual assessment is never overwritten.
export type OpportunitySnapshot = {
  version: 1; business: AuditBusiness; answers: AuditAnswers; assumptions: Assumptions; findings: Finding[]; savedAt: string;
  /** The summary text Ventra filled in. If the owner has since edited it, it is left alone on the next save. */
  autoFilled?: { assessment: string; plan: string };
};
export type WorkspaceAudit = Audit & { opportunity?: OpportunitySnapshot };

const invalid = 'Growth audit is not valid. Your local copy is unchanged.';
const isText = (v: unknown, max: number) => typeof v === 'string' && v.length <= max;

/** Findings are always recomputed from the saved answers, so stored evidence can never drift from what the owner said. */
export function opportunitySnapshot(business: AuditBusiness, answers: AuditAnswers, assumptions: Assumptions, now: Date = new Date()): OpportunitySnapshot {
  if (validateAnswers(answers).length || validateAssumptions(assumptions).length) throw new Error('Finish the Growth Audit questions before saving.');
  return { version: 1, business: { ...business }, answers: { ...answers }, assumptions: { ...assumptions }, findings: calculate(answers, assumptions).findings, savedAt: now.toISOString() };
}

export function checkOpportunity(value: unknown): OpportunitySnapshot {
  const o = value as OpportunitySnapshot;
  if (!o || typeof o !== 'object' || o.version !== 1 || !o.business || typeof o.business !== 'object' || !Array.isArray(o.findings)) throw new Error(invalid);
  const b = o.business;
  if (!isText(b.name, 120) || !isText(b.offer, 400) || !isText(b.area, 200) || !isText(b.audience, 300) || !isText(b.industry, 200)) throw new Error(invalid);
  if (typeof o.savedAt !== 'string' || !Number.isFinite(Date.parse(o.savedAt))) throw new Error(invalid);
  if (!o.answers || !o.assumptions || validateAnswers(o.answers).length || validateAssumptions(o.assumptions).length) throw new Error(invalid);
  if (JSON.stringify(o.findings) !== JSON.stringify(calculate(o.answers, o.assumptions).findings)) throw new Error('Growth audit findings do not match the saved answers. Your local copy is unchanged.');
  if (o.autoFilled !== undefined && (!o.autoFilled || !isText(o.autoFilled.assessment, 6000) || !isText(o.autoFilled.plan, 6000))) throw new Error(invalid);
  return o;
}

/** Throws if the raw workspace audit (manual part and, when present, the calculator part) is invalid. */
export function checkAuditRaw(raw: string): void {
  let audit: WorkspaceAudit | null;
  try { audit = restoreAudit(raw); } catch { throw new Error(invalid); }
  if (!audit || !audit.assessment.trim()) throw new Error(invalid);
  if (audit.opportunity !== undefined) checkOpportunity(audit.opportunity);
}

function impactOf(f: Finding, all: Finding[]): AuditAction['impact'] {
  const total = all.reduce((t, x) => t + x.value.high, 0);
  const share = total > 0 ? f.value.high / total : 0;
  return share >= 0.5 ? 'High' : share >= 0.2 ? 'Medium' : 'Low';
}

function summary(o: OpportunitySnapshot): { assessment: string; plan: string; actions: AuditAction[] } {
  const f = o.findings, who = o.business.name || 'This business';
  if (!f.length) return { assessment: `${who}: the Growth Audit answers show no missed, slow or no-show bookings to recover.`, plan: 'Keep replies fast and run the Growth Audit again next month.', actions: [] };
  const bookings = f.reduce((t, x) => ({ low: t.low + x.bookings.low, high: t.high + x.bookings.high }), { low: 0, high: 0 });
  const value = f.reduce((t, x) => ({ low: t.low + x.value.low, high: t.high + x.value.high }), { low: 0, high: 0 });
  return {
    assessment: `${who}: from the owner's Growth Audit answers, about ${rangeText(bookings)} extra bookings (${rangeText(value, aud)}) a month may be recoverable. An estimate, not a promise.`,
    plan: f.map((x, i) => `${i + 1}. ${x.action}`).join('\n'),
    actions: f.slice(0, 3).map(x => ({ finding: x.title, evidence: x.evidence, impact: impactOf(x, f), confidence: x.confidence, destination: '/customers' })),
  };
}

/** The workspace audit with the calculator result attached. A manual assessment the owner wrote or edited is kept. */
export function auditWithOpportunity(existing: Audit | null, snapshot: OpportunitySnapshot, now: Date = new Date()): WorkspaceAudit {
  const o = checkOpportunity(snapshot), s = summary(o);
  const prev = existing as WorkspaceAudit | null;
  const ours = !prev || !prev.assessment.trim() || (prev.opportunity?.autoFilled?.assessment === prev.assessment && prev.opportunity.autoFilled.plan === prev.plan);
  const next: WorkspaceAudit = ours
    ? { version: 1, assessment: s.assessment, underperforming: o.findings.map(x => x.evidence).join('\n'), plan: s.plan, actions: s.actions, updatedAt: now.toISOString(), opportunity: { ...o, autoFilled: { assessment: s.assessment, plan: s.plan } } }
    : { ...prev, updatedAt: now.toISOString(), opportunity: { ...o, autoFilled: prev.opportunity?.autoFilled } };
  if (next.opportunity && next.opportunity.autoFilled === undefined) delete next.opportunity.autoFilled;
  validateAudit(next);
  return next;
}

/** Writes the result into this browser's workspace audit (refuses if another tab changed it). Returns the new raw value. */
export function saveOpportunityToWorkspace(storage: LocalStorage, expectedRaw: string | null, snapshot: OpportunitySnapshot, now: Date = new Date()): string {
  const existing = expectedRaw === null ? null : restoreAudit(expectedRaw);
  const raw = JSON.stringify(auditWithOpportunity(existing, snapshot, now));
  checkAuditRaw(raw);
  return writeCompared(storage, auditKey, expectedRaw, raw);
}

/** The saved calculator result from a raw workspace audit, or null if there is none or it is invalid. */
export function restoreOpportunity(raw: string | null): OpportunitySnapshot | null {
  if (raw === null) return null;
  try { const a = restoreAudit(raw) as WorkspaceAudit | null; return a?.opportunity ? checkOpportunity(a.opportunity) : null; } catch { return null; }
}
