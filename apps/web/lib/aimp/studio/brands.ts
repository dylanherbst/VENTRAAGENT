// The studio's brands: any number of the owner's own businesses. Each brand is its own workspace ("studio-<slug>"), so data never mixes.
import { validateExisting, slugFor, type ExistingBusinessInput, type ExistingErrors } from '../onboarding/existing.ts';
import type { Vault } from './vault.ts';

export interface StudioBrand extends ExistingBusinessInput { id: string; createdAt: string; archived: boolean }
export const MAX_BRANDS = 50;
export const BRANDS_KEY = 'brands';
export const brandKey = (id: string) => `brand/${id}`;
export const mediaKey = (id: string, assetId: string) => `media/${id}/${assetId.toLowerCase()}`;
const ID = /^studio-[a-z0-9-]{3,48}$/;
export const isBrandId = (v: unknown): v is string => typeof v === 'string' && ID.test(v);

export async function listBrands(v: Vault): Promise<StudioBrand[]> {
  const raw = await v.get(BRANDS_KEY);
  return Array.isArray(raw) ? (raw as StudioBrand[]).filter((b) => isBrandId(b?.id)) : [];
}

export async function addBrand(v: Vault, raw: unknown, now = new Date()): Promise<{ ok: true; brand: StudioBrand } | { ok: false; errors: ExistingErrors & { form?: string } }> {
  const r = validateExisting(raw);
  if (!r.ok) return { ok: false, errors: r.errors };
  const list = await listBrands(v);
  if (list.filter((b) => !b.archived).length >= MAX_BRANDS) return { ok: false, errors: { form: `You can have up to ${MAX_BRANDS} brands.` } };
  let id = `studio-${slugFor(r.value.businessName).slice(0, 40)}`;
  for (let i = 2; list.some((b) => b.id === id); i++) id = `studio-${slugFor(r.value.businessName, String(i)).slice(0, 40)}`;
  const brand: StudioBrand = { ...r.value, id, createdAt: now.toISOString(), archived: false };
  await v.put(BRANDS_KEY, [...list, brand]);
  return { ok: true, brand };
}

export async function setArchived(v: Vault, id: string, archived: boolean): Promise<boolean> {
  const list = await listBrands(v);
  const b = list.find((x) => x.id === id);
  if (!b) return false;
  b.archived = archived;
  await v.put(BRANDS_KEY, list);
  return true;
}
