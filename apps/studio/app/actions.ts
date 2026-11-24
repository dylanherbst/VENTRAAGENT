'use server';
import { redirect } from 'next/navigation';
import { requireOwner, vault } from '../lib/server';
import { addBrand, setArchived } from '../../web/lib/aimp/studio/brands';

export async function addBrandAction(_prev: { errors: Record<string, string> }, form: FormData): Promise<{ errors: Record<string, string> }> {
  await requireOwner();
  const tz = String(form.get('timezone') || 'Australia/Perth');
  const r = await addBrand(await vault(), { businessName: form.get('businessName'), industry: form.get('industry'), offer: form.get('offer'), audience: form.get('audience'), website: form.get('website'), timezone: tz });
  if (!r.ok) return { errors: r.errors as Record<string, string> };
  redirect(`/b/${r.brand.id}`);
}

export async function archiveBrandAction(form: FormData): Promise<void> {
  await requireOwner();
  await setArchived(await vault(), String(form.get('id') ?? ''), true);
  redirect('/');
}
