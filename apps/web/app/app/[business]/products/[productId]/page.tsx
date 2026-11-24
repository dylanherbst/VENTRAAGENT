import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AppIntro, AppLayout, GlassButton, GlassNotice, GlassState } from '../../../../design-system/aimp-glass';
import { availability, catalogueCtx, checkBusiness, productCtx, runtime } from '../../../../start/_server/runtime';
import { LONG_MAX, SHORT_MAX, TITLE_MAX } from '../../../../../lib/aimp/catalogue/validate';
import { UnknownBusiness } from '../../overview-view';
import { loadProductEditor } from './_server/editor';
import { ProductEditorView } from './editor-view';
import { productsHref } from './view-model';

export const metadata: Metadata = { title: 'Product' };
export const dynamic = 'force-dynamic';

// Screen 13: one product of an existing business. Same in-memory DEMO runtime as /start, the overview, the brand page and the
// products list (lost on restart), and off in production unless the demo tools are enabled. An unknown product, or one that belongs
// to another business, is a 404.
export default async function ProductEditorPage({ params }: { params: Promise<{ business: string; productId: string }> }) {
  const { business, productId } = await params;
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
    found = await loadProductEditor(runtime(), { productCtx, catalogueCtx }, business, productId);
  } catch (e) {
    console.error('[app product editor] could not load the product:', e instanceof Error ? e.name : 'unknown error');
    return (
      <AppLayout width="regular">
        <AppIntro title="Product">{null}</AppIntro>
        <GlassState kind="error" title="We could not load this product" action={<GlassButton href={productsHref(business)}>Back to your products</GlassButton>}>
          <p>Something went wrong while reading the product. Nothing was changed.</p>
        </GlassState>
      </AppLayout>
    );
  }
  if (!found.found) notFound();
  return <ProductEditorView businessId={business} editor={found.editor} limits={{ title: TITLE_MAX, short: SHORT_MAX, long: LONG_MAX }} />;
}
