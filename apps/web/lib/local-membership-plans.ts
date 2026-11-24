// Membership plan drafts: tiers, perks and price wording, for planning only. No billing, no sign-ups, no gating of any content.
// Price is free text (for example "$29 a month" or "Free"); it is never parsed, summed or charged.
export const tierLimit = 6;
export const perkLimit = 12;
export const tierNameLimit = 80;
export const tierPriceTextLimit = 80;
export const tierPitchLimit = 300;
export const perkTextLimit = 160;
const storageByteLimit = 64000;

export type Tier = { id: string; name: string; priceText: string; pitch?: string; perks: string[] };
export type MembershipPlans = { version: 1; profileId: string; tiers: Tier[]; revision: number; updatedAt: string | null };

export const membershipStorageKey = (profileId: string) => `launchpad.membership-plans.v1.${profileId}`;
export const blankPlans = (profileId: string): MembershipPlans => ({ version: 1, profileId, tiers: [], revision: 0, updatedAt: null });

export function validatePlans(m: MembershipPlans): { problems: string[] } {
  const problems: string[] = [];
  if (!m || typeof m !== 'object' || Array.isArray(m)) return { problems: ['Membership plans are not valid.'] };
  if (m.version !== 1) problems.push('Unsupported membership plans version.');
  if (typeof m.profileId !== 'string' || !m.profileId) problems.push('Profile is required.');
  if (!Number.isSafeInteger(m.revision) || m.revision < 0) problems.push('Revision is not valid.');
  if (m.updatedAt !== null && (typeof m.updatedAt !== 'string' || Number.isNaN(Date.parse(m.updatedAt)))) problems.push('Updated time is not valid.');
  if (!Array.isArray(m.tiers)) { problems.push('Tiers must be a list.'); return { problems }; }
  if (m.tiers.length > tierLimit) { problems.push(`Up to ${tierLimit} tiers are supported.`); return { problems }; }
  const ids = new Set<string>(), names = new Set<string>();
  m.tiers.forEach((t, i) => {
    const n = i + 1;
    if (!t || typeof t !== 'object') { problems.push(`Tier ${n} is not valid.`); return; }
    if (typeof t.id !== 'string' || !t.id || t.id.length > 80) problems.push(`Tier ${n} needs an id.`);
    else if (ids.has(t.id)) problems.push('Tiers need unique ids.');
    else ids.add(t.id);
    if (typeof t.name !== 'string' || !t.name.trim()) problems.push(`Tier ${n} needs a name.`);
    else if (t.name.length > tierNameLimit) problems.push(`Tier ${n} name must be ${tierNameLimit} characters or fewer.`);
    else if (names.has(t.name.trim().toLowerCase())) problems.push('Tiers need different names.');
    else names.add(t.name.trim().toLowerCase());
    if (typeof t.priceText !== 'string' || !t.priceText.trim() || t.priceText.length > tierPriceTextLimit) problems.push(`Tier ${n} needs price wording of ${tierPriceTextLimit} characters or fewer.`);
    if (t.pitch !== undefined && (typeof t.pitch !== 'string' || t.pitch.length > tierPitchLimit)) problems.push(`Tier ${n} pitch must be ${tierPitchLimit} characters or fewer.`);
    if (!Array.isArray(t.perks) || t.perks.length > perkLimit || t.perks.some(p => typeof p !== 'string' || !p.trim() || p.length > perkTextLimit)) problems.push(`Tier ${n} perks must be up to ${perkLimit} short lines.`);
  });
  return { problems };
}

export function addTier(m: MembershipPlans, t: { id: string; name: string; priceText: string; pitch?: string }): MembershipPlans {
  if (m.tiers.length >= tierLimit) throw new Error(`Up to ${tierLimit} tiers are supported.`);
  const tier: Tier = { id: t.id, name: t.name.trim(), priceText: t.priceText.trim(), perks: [] };
  if (t.pitch?.trim()) tier.pitch = t.pitch.trim();
  return { ...m, tiers: [...m.tiers, tier] };
}
export const removeTier = (m: MembershipPlans, id: string): MembershipPlans => ({ ...m, tiers: m.tiers.filter(t => t.id !== id) });
export function addPerk(m: MembershipPlans, tierId: string, text: string): MembershipPlans {
  const t = m.tiers.find(x => x.id === tierId);
  if (!t) throw new Error('Tier not found.');
  const perk = text.trim();
  if (!perk) throw new Error('Enter the perk.');
  if (perk.length > perkTextLimit) throw new Error(`A perk must be ${perkTextLimit} characters or fewer.`);
  if (t.perks.length >= perkLimit) throw new Error(`Up to ${perkLimit} perks per tier.`);
  return { ...m, tiers: m.tiers.map(x => x.id === tierId ? { ...x, perks: [...x.perks, perk] } : x) };
}
export function removePerk(m: MembershipPlans, tierId: string, index: number): MembershipPlans {
  return { ...m, tiers: m.tiers.map(x => x.id === tierId ? { ...x, perks: x.perks.filter((_, i) => i !== index) } : x) };
}
/** Perks that appear in more than one tier, listed so the owner can see what each step up really adds. */
export function sharedPerks(m: MembershipPlans): string[] {
  const seen = new Map<string, number>();
  for (const t of m.tiers) for (const p of new Set(t.perks.map(x => x.trim().toLowerCase()))) seen.set(p, (seen.get(p) ?? 0) + 1);
  return [...seen].filter(([, n]) => n > 1).map(([p]) => p);
}
/** Perks of a tier that no earlier tier lists, in the order the tiers are drawn. */
export function newPerks(m: MembershipPlans, tierId: string): string[] {
  const before = new Set<string>();
  for (const t of m.tiers) {
    if (t.id === tierId) return t.perks.filter(p => !before.has(p.trim().toLowerCase()));
    t.perks.forEach(p => before.add(p.trim().toLowerCase()));
  }
  return [];
}

function clean(m: MembershipPlans): MembershipPlans {
  return { version: 1, profileId: m.profileId, revision: m.revision, updatedAt: m.updatedAt, tiers: m.tiers.map(t => {
    const o: Tier = { id: t.id, name: t.name.trim(), priceText: t.priceText.trim(), perks: t.perks.map(p => p.trim()) };
    if (t.pitch) o.pitch = t.pitch;
    return o;
  }) };
}

/** Returns null when nothing is saved. Throws on anything invalid; never writes. */
export function restorePlans(raw: string | null, profileId: string): MembershipPlans | null {
  if (!profileId) throw new Error('Profile is required.');
  if (raw === null) return null;
  if (raw.length > storageByteLimit) throw new Error('Saved membership plans are too large. Nothing was overwritten.');
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('Saved membership plans are not valid. Nothing was overwritten.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid saved membership plans. Nothing was overwritten.');
  const m = value as MembershipPlans;
  if (m.profileId !== profileId || validatePlans(m).problems.length) throw new Error('Invalid saved membership plans. Nothing was overwritten.');
  return clean(m);
}

/** Writes only if storage still holds what this editor last read. Bumps the revision. Returns the raw text written. */
export function persistPlans(storage: Pick<Storage, 'getItem' | 'setItem'>, profileId: string, expectedRaw: string | null, plans: MembershipPlans, nowIso: string): string {
  const key = membershipStorageKey(profileId);
  if (storage.getItem(key) !== expectedRaw) throw new Error('Membership plans changed in another tab. Your unsaved changes remain; copy them before reloading.');
  if (plans.profileId !== profileId) throw new Error('Membership plans belong to another profile.');
  if (Number.isNaN(Date.parse(nowIso))) throw new Error('Current time is not valid.');
  const next = clean({ ...plans, revision: plans.revision + 1, updatedAt: new Date(nowIso).toISOString() });
  const problems = validatePlans(next).problems;
  if (problems.length) throw new Error(problems[0]);
  const raw = JSON.stringify(next);
  if (raw.length > storageByteLimit) throw new Error('Membership plan storage limit reached. Your unsaved changes remain.');
  storage.setItem(key, raw);
  return raw;
}
