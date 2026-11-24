import type { Metadata } from 'next';
import { Shell } from '../../../../components/shell';
import { SetterClient } from '../../../../components/setter-client';
import { brandOr404 } from '../../../../lib/brand-page';
import { loadSetterAction } from '../setter-actions';

export const metadata: Metadata = { title: 'AI Setter' };
export const dynamic = 'force-dynamic';

export default async function BrandSetter({ params }: { params: Promise<{ brand: string }> }) {
  const b = await brandOr404((await params).brand);
  const initial = await loadSetterAction(b.id);
  return (
    <Shell brand={b} tab="setter">
      <div><h1 className="sh-h1">AI Setter</h1><p className="sh-lede">Answers DMs in your voice, qualifies people and sends your link. Test it here: type as a customer. Replies are drafts until you switch on automatic replies. Connecting the real Instagram account needs the Meta app.</p></div>
      {initial ? <SetterClient business={b.id} initial={initial} /> : <p>Brand not found.</p>}
    </Shell>
  );
}
