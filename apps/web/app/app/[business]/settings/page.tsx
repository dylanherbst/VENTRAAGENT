import type { Metadata } from 'next';
import Link from 'next/link';
import { AppIntro, AppLayout, GlassCard } from '../../../design-system/aimp-glass';
import { checkBusiness } from '../../../start/_server/runtime';
import { UnknownBusiness } from '../overview-view';
import { settingsLinks } from '../workspace-nav-items';

export const metadata: Metadata = { title: 'Settings' };

// Behind the profile icon on a phone: every screen that is not one of the four tabs, so nothing becomes unreachable.
export default async function SettingsPage({ params }: { params: Promise<{ business: string }> }) {
  const { business } = await params;
  if (!checkBusiness(business)) return <UnknownBusiness />;
  return (
    <AppLayout width="regular">
      <AppIntro title="Settings"><p>Your brand, address, payments and connected tools.</p></AppIntro>
      <GlassCard heading="h2" title="Your business" data-testid="settings-links">
        <ul className="plg-list">
          {settingsLinks.map((l) => (
            <li key={l.segment}><Link className="plg-link" data-target="large" href={`/app/${business}/${l.segment}`}>{l.label}</Link>. {l.detail}</li>
          ))}
        </ul>
      </GlassCard>
    </AppLayout>
  );
}
