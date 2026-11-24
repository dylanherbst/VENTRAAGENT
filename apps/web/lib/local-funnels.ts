import { leadFormStorageKey, restoreLeadFormDraft } from './local-lead-forms.ts';
import { restoreEmailCampaigns, emailCampaignsStorageKey } from './local-email-campaigns.ts';
import { storefrontStorageKey, restoreStorefrontDraft } from './local-storefront.ts';
import { linkInBioStorageKey, restoreLinkInBioDraft } from './local-link-in-bio.ts';
import { websitePageStorageKey, restoreWebsitePage } from './local-website-page.ts';
import { offerStorageKey } from './local-offers.ts';

export const funnelStatuses = ['draft', 'ready', 'archived'] as const;
export type FunnelStatus = (typeof funnelStatuses)[number];
export const stepKinds = ['traffic', 'lead-form', 'email', 'offer', 'storefront', 'link-in-bio', 'page', 'thank-you', 'other'] as const;
export type StepKind = (typeof stepKinds)[number];
export const linkTypes = ['lead-form', 'email-campaign', 'offer', 'storefront', 'link-in-bio', 'page'] as const;
export type LinkType = (typeof linkTypes)[number];

export const funnelLimit = 20;
export const stepLimit = 12;
export const funnelNameLimit = 120;
export const goalLimit = 500;
export const stepTitleLimit = 120;
export const stepNoteLimit = 500;
const storageByteLimit = 300000;

export type FunnelStep = { id: string; kind: StepKind; title: string; note: string; linkedRef?: { type: LinkType; id: string } };
export type Funnel = { id: string; name: string; goal: string; status: FunnelStatus; steps: FunnelStep[] };

export const funnelsStorageKey = (profileId: string) => `launchpad.funnels.v1.${profileId}`;

/** Which saved item type a step kind can point at. Other kinds cannot be linked. */
export const linkTypeForKind = (kind: StepKind): LinkType | null =>
  kind === 'lead-form' ? 'lead-form' : kind === 'email' ? 'email-campaign' : kind === 'offer' || kind === 'storefront' || kind === 'link-in-bio' || kind === 'page' ? kind : null;

export function blankStep(id: string, kind: StepKind = 'other'): FunnelStep { return { id, kind, title: '', note: '' }; }
export function blankFunnel(id: string, stepId = `${id}-s1`): Funnel {
  return { id, name: '', goal: '', status: 'draft', steps: [blankStep(stepId, 'traffic')] };
}

export type FunnelCheck = { problems: string[]; warnings: string[] };

export function validateFunnel(funnel: Funnel, snapshot?: WorkspaceSnapshot): FunnelCheck {
  const problems: string[] = [];
  const warnings: string[] = [];
  if (!funnel || typeof funnel !== 'object') return { problems: ['Funnel is not valid.'], warnings };
  if (typeof funnel.id !== 'string' || !funnel.id || funnel.id.length > 80) problems.push('Funnel needs an id.');
  if (typeof funnel.name !== 'string' || !funnel.name.trim()) problems.push('Name is required.');
  else if (funnel.name.length > funnelNameLimit) problems.push(`Name must be ${funnelNameLimit} characters or fewer.`);
  if (typeof funnel.goal !== 'string') problems.push('Goal must be text.');
  else if (funnel.goal.length > goalLimit) problems.push(`Goal must be ${goalLimit} characters or fewer.`);
  if (!(funnelStatuses as readonly string[]).includes(funnel.status)) problems.push('Choose a status from the list.');
  if (!Array.isArray(funnel.steps) || funnel.steps.length < 1) problems.push('Add at least one step.');
  else if (funnel.steps.length > stepLimit) problems.push(`A funnel can have up to ${stepLimit} steps.`);
  else {
    const ids = new Set<string>();
    funnel.steps.forEach((s, i) => {
      const n = i + 1;
      if (!s || typeof s !== 'object') { problems.push(`Step ${n} is not valid.`); return; }
      if (typeof s.id !== 'string' || !s.id || s.id.length > 80) problems.push(`Step ${n} needs an id.`);
      else if (ids.has(s.id)) problems.push('Steps need unique ids.');
      else ids.add(s.id);
      if (!(stepKinds as readonly string[]).includes(s.kind)) problems.push(`Step ${n} needs a type.`);
      if (typeof s.title !== 'string' || !s.title.trim()) problems.push(`Step ${n} needs a title.`);
      else if (s.title.length > stepTitleLimit) problems.push(`Step ${n} title must be ${stepTitleLimit} characters or fewer.`);
      if (typeof s.note !== 'string' || s.note.length > stepNoteLimit) problems.push(`Step ${n} note must be ${stepNoteLimit} characters or fewer.`);
      if (s.linkedRef !== undefined) {
        const r = s.linkedRef;
        if (!r || typeof r !== 'object' || !(linkTypes as readonly string[]).includes(r.type) || typeof r.id !== 'string' || !r.id || r.id.length > 120) problems.push(`Step ${n} has an invalid link.`);
        else if (linkTypeForKind(s.kind) !== r.type) problems.push(`Step ${n} link does not match its type.`);
      }
    });
    if (!problems.length) {
      const kinds = funnel.steps.map(s => s.kind);
      if (kinds.includes('email') && !kinds.includes('lead-form')) warnings.push('This funnel has an email step but no lead form step. Nobody would be on your list to email.');
      if (!kinds.includes('thank-you')) warnings.push('This funnel has no thank-you step.');
      if (snapshot) resolveLinks(funnel, snapshot).forEach((r, i) => { if (r.linked && !r.found) warnings.push(`Step ${i + 1} links to something that no longer exists or cannot be read.`); });
    }
  }
  return { problems, warnings };
}

export type SnapshotItem = { id: string; label: string };
/** Saved items per type. null means that store exists but could not be read. Missing store is an empty list. */
export type WorkspaceSnapshot = Record<LinkType, SnapshotItem[] | null>;
export const emptySnapshot = (): WorkspaceSnapshot => ({ 'lead-form': [], 'email-campaign': [], offer: [], storefront: [], 'link-in-bio': [], page: [] });

export type ResolvedLink = { linked: boolean; found: boolean; label: string };
export function resolveLinks(funnel: Pick<Funnel, 'steps'>, snapshot: WorkspaceSnapshot): ResolvedLink[] {
  return funnel.steps.map(s => {
    const ref = s.linkedRef;
    if (!ref) return { linked: false, found: false, label: '' };
    const list = snapshot[ref.type];
    if (!list) return { linked: true, found: false, label: 'Saved items could not be read' };
    const hit = list.find(x => x.id === ref.id);
    return hit ? { linked: true, found: true, label: hit.label } : { linked: true, found: false, label: 'No longer exists' };
  });
}

type Store = Pick<Storage, 'getItem'>;
function safe<T>(fn: () => T[]): T[] | null { try { return fn(); } catch { return null; } }
function rawOf(storage: Store, key: string): string | null | undefined { try { return storage.getItem(key); } catch { return undefined; } }

/** Read-only. Never writes. Unreadable or invalid stores become null; absent stores become empty lists. */
export function readWorkspaceSnapshot(storage: Store, profileId: string): WorkspaceSnapshot {
  const pick = <T,>(key: string, read: (raw: string) => T[]): T[] | null => {
    const raw = rawOf(storage, key);
    if (raw === undefined) return null;
    if (raw === null) return [];
    return safe(() => read(raw));
  };
  const one = <D,>(key: string, restore: (raw: string, id: string) => D | null, label: (d: D) => string, idOf?: (d: D) => string) =>
    pick<SnapshotItem>(key, raw => { const d = restore(raw, profileId); return d ? [{ id: idOf ? idOf(d) : profileId, label: label(d) || 'Untitled' }] : []; });
  return {
    'lead-form': one(leadFormStorageKey(profileId), restoreLeadFormDraft, d => d.internalName, d => d.id),
    'email-campaign': pick(emailCampaignsStorageKey(profileId), raw => restoreEmailCampaigns(raw, profileId).map(c => ({ id: c.id, label: c.name }))),
    offer: pick(offerStorageKey(profileId), raw => {
      const v: unknown = JSON.parse(raw);
      if (!Array.isArray(v)) throw new Error('bad');
      return v.filter((o): o is { id: string; name: string } => !!o && typeof o.id === 'string' && typeof o.name === 'string').map(o => ({ id: o.id, label: o.name }));
    }),
    storefront: one(storefrontStorageKey(profileId), restoreStorefrontDraft, d => d.heading),
    'link-in-bio': one(linkInBioStorageKey(profileId), restoreLinkInBioDraft, d => d.pageTitle),
    page: one(websitePageStorageKey(profileId), restoreWebsitePage, d => d.title),
  };
}

export function moveStep(funnel: Funnel, stepId: string, direction: -1 | 1): Funnel {
  const i = funnel.steps.findIndex(s => s.id === stepId);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= funnel.steps.length) return funnel;
  const steps = funnel.steps.slice();
  [steps[i], steps[j]] = [steps[j], steps[i]];
  return { ...funnel, steps };
}

function clean(f: Funnel): Funnel {
  return {
    id: f.id, name: f.name.trim(), goal: f.goal, status: f.status,
    steps: f.steps.map(s => {
      const out: FunnelStep = { id: s.id, kind: s.kind, title: s.title.trim(), note: s.note };
      if (s.linkedRef) out.linkedRef = { type: s.linkedRef.type, id: s.linkedRef.id };
      return out;
    }),
  };
}

export function saveFunnel(funnels: readonly Funnel[], funnel: Funnel): Funnel[] {
  const { problems } = validateFunnel(funnel);
  if (problems.length) throw new Error(problems[0]);
  const next = clean(funnel);
  const exists = funnels.some(f => f.id === next.id);
  if (!exists && funnels.length >= funnelLimit) throw new Error(`This browser supports up to ${funnelLimit} funnels.`);
  return exists ? funnels.map(f => (f.id === next.id ? next : f)) : [...funnels, next];
}
export function removeFunnel(funnels: readonly Funnel[], id: string): Funnel[] { return funnels.filter(f => f.id !== id); }

export function restoreFunnels(raw: string | null, profileId: string): Funnel[] {
  if (!profileId) throw new Error('Profile is required.');
  if (raw === null) return [];
  if (raw.length > storageByteLimit) throw new Error('Saved funnels are too large. Nothing was overwritten.');
  let values: unknown;
  try { values = JSON.parse(raw); } catch { throw new Error('Saved funnels are not valid. Nothing was overwritten.'); }
  if (!Array.isArray(values) || values.length > funnelLimit) throw new Error('Invalid saved funnels. Nothing was overwritten.');
  const ids = new Set<string>();
  return values.map(value => {
    const f = value as Funnel;
    if (!f || typeof f !== 'object' || Array.isArray(f) || validateFunnel(f).problems.length) throw new Error('Invalid saved funnel. Nothing was overwritten.');
    if (ids.has(f.id)) throw new Error('Duplicate funnel IDs. Nothing was overwritten.');
    ids.add(f.id);
    return clean(f);
  });
}

/** Writes the full list only if browser storage still holds exactly what this editor last read. */
export function persistFunnels(storage: Pick<Storage, 'getItem' | 'setItem'>, profileId: string, expectedRaw: string | null, funnels: readonly Funnel[]): string {
  const key = funnelsStorageKey(profileId);
  if (storage.getItem(key) !== expectedRaw) throw new Error('Funnels changed in another tab. Your unsaved changes remain; copy them before reloading.');
  const checked = restoreFunnels(JSON.stringify(funnels), profileId);
  const raw = JSON.stringify(checked);
  if (raw.length > storageByteLimit) throw new Error('Funnel storage limit reached. Your unsaved changes remain.');
  storage.setItem(key, raw);
  return raw;
}
