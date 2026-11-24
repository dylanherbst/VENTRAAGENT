import 'server-only';
import { notFound } from 'next/navigation';
import { requireOwner, vault } from './server';
import { isBrandId, listBrands } from '../../web/lib/aimp/studio/brands';

export async function brandOr404(id: string) {
  await requireOwner();
  const b = isBrandId(id) ? (await listBrands(await vault())).find((x) => x.id === id && !x.archived) : undefined;
  if (!b) notFound();
  return b;
}
