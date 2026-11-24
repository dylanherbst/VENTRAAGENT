import type { Metadata } from 'next';
import { AppIntro, AppLayout, GlassButton, GlassNotice, GlassState } from '../../../design-system/aimp-glass';
import { availability, catalogueCtx, checkBusiness, MAX_PRODUCTS_PER_BUSINESS, productCtx, runtime } from '../../../start/_server/runtime';
import { UnknownBusiness } from '../overview-view';
import { loadProducts } from './_server/products';
import { ProductsView } from './products-view';
import { parseFilter } from './view-model';
import './products.css';

export const metadata: Metadata = { title: 'Products' };
export const dynamic = 'force-dynamic';

type Query = { [key: string]: string | string[] | undefined };

// Screen 12: the products of an existing business. Same in-memory DEMO runtime as /start, the overview and the brand page (lost on
// restart), and off in production unless the demo tools are enabled. `?status=active|draft|archived|all` picks the filter;
// the default list leaves archived products out (AMP-097), they are listed under `?status=archived`.
export default async function ProductsPage({ params, searchParams }: { params: Promise<{ business: string }>; searchParams: Promise<Query> }) {
  const { business } = await params;
  const q = await searchParams;
  const a = availability();
  if (!a.available) {
    return (
      <AppLayout width="regular">
        <AppIntro title="This page is not switched on here" />
        <GlassNotice tone="warn" title="Demo storage is off on this site"><p>{a.reason}</p></GlassNotice>
      </AppLayout>
    );
  }
  if (!checkBusiness(business)) return <UnknownBusiness />;

  let found;
  try {
    found = await loadProducts(runtime(), { productCtx, catalogueCtx, maxProducts: MAX_PRODUCTS_PER_BUSINESS }, business);
  } catch (e) {
    console.error('[app products] could not load the products:', e instanceof Error ? e.name : 'unknown error');
    return (
      <AppLayout width="regular">
        <AppIntro title="Products">{null}</AppIntro>
        <GlassState kind="error" title="We could not load your products" action={<GlassButton href={`/app/${business}/products`}>Try again</GlassButton>}>
          <p>Something went wrong while reading your products. Nothing was changed.</p>
        </GlassState>
      </AppLayout>
    );
  }
  if (!found.found) return <UnknownBusiness />;
  return <ProductsView businessId={business} rows={found.rows} create={found.create} filter={parseFilter(q.status)} />;
}
