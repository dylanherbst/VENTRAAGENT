import type { Metadata } from 'next';
import { AppIntro, AppLayout, GlassNotice } from '../../design-system/aimp-glass';
import { availability } from '../../start/_server/runtime';
import { loadAnglesAction } from '../../app/[business]/marketing/angles/actions';
import { AnglesClient } from '../../app/[business]/marketing/angles/angles-client';
import { AppBackdrop } from '../../app/[business]/app-backdrop';
import '../../app/[business]/carousel/tokens.css';
import '../../app/[business]/workspace-skin.css';
import '../../app/[business]/theme-dark.css';
import { playbook } from '../../../lib/aimp/marketing-engine/playbook';

export const metadata: Metadata = { title: 'Marketing studio', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

// The owner's standalone marketing studio: AiMoneyPrinter's own ads, preloaded with the 100-ad playbook. Its own private workspace,
// separate from every customer. Runs only where the demo tools are on (your Mac), so it is never public.
export default async function MarketingStudio() {
  const a = availability();
  if (!a.available) return <AppLayout width="regular"><AppIntro title="Marketing studio" /><GlassNotice tone="warn" title="Not switched on here"><p>{a.reason}</p></GlassNotice></AppLayout>;
  const initial = await loadAnglesAction({ kind: 'studio' });
  return (
    <><AppBackdrop /><div className="amg amg-skin"><AppLayout width="wide">
      <AppIntro title="Marketing studio"><p>AiMoneyPrinter&apos;s own ads. Load a niche from your playbook or write a fresh brief, edit, then approve. Same engine customers get, in its own workspace. Nothing is posted or paid for here.</p></AppIntro>
      <GlassNotice tone="info" title="Before anything goes live"><p>The playbook&apos;s market gaps are hypotheses. Check copy against the product, Australian consumer law and Meta&apos;s ad rules before publishing.</p></GlassNotice>
      {initial ? <AnglesClient scope={{ kind: 'studio' }} initial={initial} niches={playbook.map((n) => ({ id: n.id, tier: n.tier, name: n.name }))}
        defaults={{ businessName: 'AiMoneyPrinter', offer: 'One app that finds a real customer problem, builds the offer, shop and marketing, and answers DMs', region: 'Australia', channel: 'paid', tone: 'clear, practical, no hype' }} /> : <p>This page is not switched on here.</p>}
    </AppLayout></div></>
  );
}
