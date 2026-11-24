import type { Metadata } from 'next';
import { Shell } from '../../../../components/shell';
import { AnglesClient } from '../../../../components/angles-client';
import { brandOr404 } from '../../../../lib/brand-page';
import { loadAnglesAction } from '../angles-actions';
import { playbook } from '../../../../../web/lib/aimp/marketing-engine/playbook';

export const metadata: Metadata = { title: 'Ad angles' };
export const dynamic = 'force-dynamic';

export default async function BrandAds({ params }: { params: Promise<{ brand: string }> }) {
  const b = await brandOr404((await params).brand);
  const scope = { kind: 'business' as const, business: b.id };
  const initial = await loadAnglesAction(scope);
  return (
    <Shell brand={b} tab="ads">
      <div><h1 className="sh-h1">Ad angles</h1><p className="sh-lede">Five different ways to sell the same thing. Write from a brief, or load one of the 100 ads in your playbook. Paid ads stay off.</p></div>
      {initial ? <AnglesClient scope={scope} initial={initial} niches={playbook.map((n) => ({ id: n.id, tier: n.tier, name: n.name }))}
        defaults={{ businessName: b.businessName, offer: b.offer, audience: b.audience, region: 'Australia', channel: 'organic' }} /> : <p>Brand not found.</p>}
    </Shell>
  );
}
