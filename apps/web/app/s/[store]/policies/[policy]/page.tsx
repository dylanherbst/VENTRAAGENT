import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { storeMetadata } from '../../../../../lib/aimp/hosts/seo';
import { isPolicyPage, loadPublishedStore, policyPages } from '../../../../../lib/aimp/storefront/load';

type Params = { params: Promise<{ store: string; policy: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { store: s, policy } = await params;
  const store = await loadPublishedStore(s);
  if (!store || !isPolicyPage(policy)) return { title: 'Not found', robots: { index: false, follow: false } };
  return storeMetadata(store, process.env, { path: `/policies/${policy}`, title: policyPages[policy] });
}

export default async function PolicyPage({ params }: Params) {
  const { store: s, policy } = await params;
  const store = await loadPublishedStore(s);
  if (!store || !isPolicyPage(policy)) notFound();
  return (
    <article className="st-wrap st-narrow st-section st-prose">
      <h1>{policyPages[policy]}</h1>
      {store.demo ? <p className="st-note">Sample policy text. A real store owner reviews and approves their policies before publishing.</p> : null}
      {store.policies[policy].map((para) => <p key={para}>{para}</p>)}
      <p className="st-muted">Questions? Email <a href={`mailto:${store.contact.email}`}>{store.contact.email}</a>.</p>
    </article>
  );
}
