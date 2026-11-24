import type { Metadata } from 'next';
import { TeamPage } from '../ai-team/team-page';

export const metadata: Metadata = { title: 'Social Media' };
export const dynamic = 'force-dynamic';

export default async function SocialPage({ params }: { params: Promise<{ business: string }> }) {
  const { business } = await params;
  return <TeamPage business={business} startTab="posts" title="Social Media" intro="Your Social Media agent plans, writes and designs your posts, then schedules the ones you approve. Your calendar, drafts, approvals and results are all here." />;
}
