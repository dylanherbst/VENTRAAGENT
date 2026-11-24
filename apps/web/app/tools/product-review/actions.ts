'use server';
import { redirect } from 'next/navigation';
import { ctx, DEMO_BUSINESS, demoProductIds, demoService, errText, makeSpec } from './demo.ts';

const back = (msg?: string): never => redirect(msg ? `/tools/product-review?msg=${encodeURIComponent(msg)}` : '/tools/product-review');
const field = (f: FormData, k: string) => (typeof f.get(k) === 'string' ? String(f.get(k)) : '');

export async function generateDemo(f: FormData): Promise<void> {
  let msg = '';
  try {
    const bp = field(f, 'blueprint') || 'printable-planner';
    const { product } = await demoService().createProduct(ctx, { businessId: DEMO_BUSINESS, spec: await makeSpec(bp) });
    demoProductIds().push(product.id);
  } catch (e) { msg = errText(e); }
  back(msg);
}

export async function regenerateProduct(f: FormData): Promise<void> {
  let msg = '';
  try { await demoService().regenerate(ctx, field(f, 'productId')); } catch (e) { msg = errText(e); }
  back(msg);
}

export async function approveVersion(f: FormData): Promise<void> {
  let msg = '';
  try { await demoService().approve(ctx, field(f, 'versionId')); } catch (e) { msg = errText(e); }
  back(msg);
}
