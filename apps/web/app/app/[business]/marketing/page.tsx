import type { Metadata } from 'next';
import Link from 'next/link';
import { TeamPage } from '../ai-team/team-page';

export const metadata: Metadata = { title: 'Marketing' };
export const dynamic = 'force-dynamic';

// Growth product: the Marketing agent's home. Ad ideas and creative come from the AI Team; deeper tools sit one tap away.
export default async function MarketingPage({ params }: { params: Promise<{ business: string }> }) {
  const { business } = await params;
  return (
    <>
      <TeamPage business={business} startTab="ads" title="Marketing" intro="Your Marketing agent researches your market, writes five different ad angles, and makes the images and videos. Paid ads stay off until you approve a budget." />
      <nav className="mk-more" aria-label="More marketing tools" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center', padding: '0 16px 32px' }}>
        <Link href={`/app/${business}/marketing/angles`}>Ad angle studio</Link>
        <Link href={`/app/${business}/gaps`}>Competitor research</Link>
        <Link href={`/app/${business}/marketing/creative`}>Creative library</Link>
        <Link href={`/app/${business}/marketing/calendar`}>Campaign calendar</Link>
      </nav>
    </>
  );
}
