import Link from 'next/link';
import { Shell } from '../components/shell';
import { AddBrand } from '../components/add-brand';
import { requireOwner, vault } from '../lib/server';
import { listBrands } from '../../web/lib/aimp/studio/brands';
import { EXISTING_INDUSTRIES } from '../../web/lib/aimp/onboarding/existing';

export const dynamic = 'force-dynamic';

export default async function Brands() {
  await requireOwner();
  const v = await vault();
  const brands = (await listBrands(v)).filter((b) => !b.archived);
  return (
    <Shell>
      <div>
        <h1 className="sh-h1">Your brands</h1>
        <p className="sh-lede">Each brand has its own Marketing agent, Social agent and AI Setter, with its own settings, posts and inbox. Nothing is posted, sent or paid for without your approval.</p>
        <p className="sh-muted">Saved in {v.kind === 'supabase' ? 'your Supabase database' : 'a private folder on this computer'}.</p>
      </div>
      <div className="sh-grid">
        {brands.map((b) => (
          <Link key={b.id} href={`/b/${b.id}`} className="sh-card sh-brandcard">
            <strong>{b.businessName}</strong>
            <span className="sh-muted">{EXISTING_INDUSTRIES.find((i) => i.id === b.industry)?.name}</span>
            <span className="sh-muted">{b.offer}</span>
          </Link>
        ))}
        <AddBrand />
      </div>
    </Shell>
  );
}
