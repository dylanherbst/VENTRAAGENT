import type { Metadata } from 'next';
import { AppIntro, AppLayout, GlassNotice } from '../../../design-system/aimp-glass';
import { availability, checkBusiness } from '../../../start/_server/runtime';
import { UnknownBusiness } from '../overview-view';
import { getOfferState } from '../../../../lib/aimp/offers/store';
import { OffersClient } from './offers-client';

export const metadata: Metadata = { title: 'Offer' };
export const dynamic = 'force-dynamic';

// Offer builder: what you know, who you help, the problem you solve -> three offers -> your own words in a real PDF -> preview -> approve.
export default async function OffersPage({ params }: { params: Promise<{ business: string }> }) {
  const { business } = await params;
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
  const s = getOfferState(business);
  return (
    <AppLayout width="regular">
      <AppIntro title="Build your offer"><p>Tell us what you know. We suggest what to sell and build the PDF from your own words. You preview it, edit it and approve it before anyone can buy.</p></AppIntro>
      <OffersClient business={business} initial={{ answers: s.answers, offerId: s.offerId, content: s.content, approvedAt: s.approved?.approvedAt ?? null, approvedPrice: s.approved?.priceMinor ?? null }} />
    </AppLayout>
  );
}
