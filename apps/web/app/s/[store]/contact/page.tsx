import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { storeMetadata } from '../../../../lib/aimp/hosts/seo';
import { loadPublishedStore } from '../../../../lib/aimp/storefront/load';

export async function generateMetadata({ params }: { params: Promise<{ store: string }> }): Promise<Metadata> {
  const store = await loadPublishedStore((await params).store);
  return store ? storeMetadata(store, process.env, { path: '/contact', title: 'Contact' }) : { title: 'Not found', robots: { index: false, follow: false } };
}

export default async function ContactPage({ params }: { params: Promise<{ store: string }> }) {
  const store = await loadPublishedStore((await params).store);
  if (!store) notFound();
  return (
    <article className="st-wrap st-narrow st-section st-prose">
      <h1>Contact</h1>
      <p>Questions about an order or a file? Email us and we reply {store.contact.responseTime}.</p>
      <p><a className="st-btn st-btn-primary" href={`mailto:${store.contact.email}`}>{store.contact.email}</a></p>
      <p className="st-muted">Please include your order number if you have one.</p>
      <p className="st-small st-muted">{store.contact.businessName}{store.contact.abn ? ` · ABN ${store.contact.abn}` : ''}</p>
    </article>
  );
}
