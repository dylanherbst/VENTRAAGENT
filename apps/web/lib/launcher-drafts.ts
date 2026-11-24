import { accountRequest } from './course-account.ts';
import type { CourseRequest } from './course-account.ts';
import { uuid } from './workspace-validation.ts';
import { byteLength } from './byte-size.ts';

export const launcherKinds = ['skill-assessment', 'market-evidence', 'offer-validation', 'pricing-scenario', 'brand-direction', 'business-plan', 'crm-contacts', 'crm-pipeline', 'lead-forms', 'storefront', 'link-in-bio', 'ad-concepts', 'community-space', 'website-page', 'service-proposals', 'service-agreement', 'service-invoice', 'service-portal', 'service-projects', 'education-certificate', 'education-sales-page', 'education-coaching', 'education-workshop', 'lead-scoring', 'content-calendar', 'email-campaigns', 'funnels', 'booking-page', 'student-progress', 'workflow-builder', 'launch-checklist', 'lesson-quiz', 'service-offers', 'growth-plan', 'growth-audit', 'notification-prefs', 'lead-followups', 'membership-plans'] as const;
export type LauncherKind = typeof launcherKinds[number];
export const launcherDraftByteLimit = 128000;
export type RemoteLauncherDraft = { kind: LauncherKind; revision: number; updatedAt: string | null; raw: string };

// Some local stores are arrays. The account copy wraps them as { items: [...] } so the server always holds one JSON object.
export function packArray(raw: string): string {
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value)) throw new Error('Expected a list of records.');
  return JSON.stringify({ items: value });
}
export function unpackArray(raw: string): string {
  const value = JSON.parse(raw) as { items?: unknown };
  if (!value || !Array.isArray(value.items)) throw new Error('Account copy is not a list of records. Your local copy is unchanged.');
  return JSON.stringify(value.items);
}
export function checkedKind(value: unknown): LauncherKind {
  if (typeof value !== 'string' || !(launcherKinds as readonly string[]).includes(value)) throw new Error('Unknown launcher draft.');
  return value as LauncherKind;
}
// The server only checks size and shape; the module that owns each draft re-validates it with its own restore function before use.
export function checkedDraftRaw(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string' || !raw || byteLength(raw) > launcherDraftByteLimit) throw new Error('Draft is empty or too large.');
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('Draft is not valid JSON.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Draft must be an object.');
  return value as Record<string, unknown>;
}
export async function loadLauncherDraft(workspace: string, kind: LauncherKind, request?: CourseRequest): Promise<RemoteLauncherDraft | null> {
  uuid(workspace); checkedKind(kind);
  const result = await accountRequest(`/api/workspace/launcher?workspace=${encodeURIComponent(workspace)}&kind=${encodeURIComponent(kind)}`, undefined, request);
  if (result.draft === null) return null;
  const d = result.draft as Record<string, unknown> | undefined;
  if (!d || typeof d !== 'object' || !Number.isSafeInteger(d.revision) || (d.revision as number) < 1 || !d.data || typeof d.data !== 'object') throw new Error('Invalid account draft. Your local copy is unchanged.');
  return { kind, revision: d.revision as number, updatedAt: typeof d.updated_at === 'string' ? d.updated_at : null, raw: JSON.stringify(d.data) };
}
export async function saveLauncherDraft(workspace: string, kind: LauncherKind, raw: string, revision: number, request?: CourseRequest): Promise<number> {
  uuid(workspace); checkedKind(kind); checkedDraftRaw(raw);
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('Refresh before saving.');
  const result = await accountRequest('/api/workspace/launcher', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save', workspace, kind, revision, draft: JSON.parse(raw) }) }, request);
  if (result.saved !== true || result.revision !== revision + 1) throw new Error('Save could not be verified. Refresh before retrying.');
  return result.revision as number;
}
export async function deleteLauncherDraft(workspace: string, kind: LauncherKind, revision: number, request?: CourseRequest): Promise<void> {
  uuid(workspace); checkedKind(kind);
  const result = await accountRequest('/api/workspace/launcher', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', workspace, kind, revision }) }, request);
  if (result.deleted !== true) throw new Error('Delete could not be verified. Refresh before retrying.');
}
