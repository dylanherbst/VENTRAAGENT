import type { Metadata } from 'next';
import { Shell } from '../../../components/shell';
import { TeamClient } from '../../../components/team-client';
import { brandOr404 } from '../../../lib/brand-page';
import { loadTeamAction } from './team-actions';

export const metadata: Metadata = { title: 'AI Team' };
export const dynamic = 'force-dynamic';

export default async function BrandTeam({ params }: { params: Promise<{ brand: string }> }) {
  const b = await brandOr404((await params).brand);
  const initial = await loadTeamAction(b.id);
  return (
    <Shell brand={b} tab="team">
      <div><h1 className="sh-h1">AI Team</h1><p className="sh-lede">Your Marketing agent writes five ad ideas, your Social agent plans the posts to match. Edit, make images and video, approve, schedule.</p></div>
      {initial ? <TeamClient business={b.id} initial={initial} /> : <p>Brand not found.</p>}
    </Shell>
  );
}
