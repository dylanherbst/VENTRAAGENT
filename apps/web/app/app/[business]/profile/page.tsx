import type { Metadata } from 'next';
import { TeamPage } from '../ai-team/team-page';

export const metadata: Metadata = { title: 'Business Profile' };
export const dynamic = 'force-dynamic';

export default async function ProfilePage({ params }: { params: Promise<{ business: string }> }) {
  const { business } = await params;
  return <TeamPage business={business} startTab="settings" title="Business Profile" intro="The one profile all three agents use: what you sell, who for, your voice, facts you can prove and your goals. Change it here and every agent follows." />;
}
