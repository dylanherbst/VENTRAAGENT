import { notFound } from 'next/navigation';
import { campaignRuntime, DEMO_CAMPAIGN_SCOPE } from '../../../lib/aimp/campaigns/demo';
import { linksAreAbsolute, sellableListings } from '../../../lib/aimp/campaigns/links';
import { getCampaign } from '../../../lib/aimp/campaigns/service';
import { claimRules } from '../../../lib/aimp/campaigns/claims';
import { formatAud } from '../../../lib/aimp/catalogue/pricing';
import { approve, regenerate } from './actions';

export const dynamic = 'force-dynamic';

type Params = { [key: string]: string | string[] | undefined };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
const box = { display: 'block', width: '100%', minHeight: 44, padding: 8, boxSizing: 'border-box' } as const;
const btn = { minHeight: 44, minWidth: 44, padding: '8px 16px' } as const;

// Isolated test page for AMP-050 (launch campaign plan): the real brand, catalogue and campaign code on in-memory stores,
// seeded with the demo catalogue. Plain markup, no design system. Nothing is posted: this page only plans and approves.
export default async function CampaignTest({ searchParams }: { searchParams: Promise<Params> }) {
  const p = campaignRuntime();
  if (!p) notFound(); // production: hidden unless AIMP_TOOLS_ENABLED=1
  const rt = await p;
  const msg = one((await searchParams).msg);
  const ctx = await rt.context();
  const campaign = await getCampaign({ store: rt.campaigns }, DEMO_CAMPAIGN_SCOPE);
  const llm = rt.registry.llm.status;
  const social = rt.registry.social.status;
  const live = !llm.demo && !social.demo && llm.status === 'live' && social.status === 'live';
  const sellable = sellableListings(ctx);
  const plan = campaign?.plan;

  return <main style={{ maxWidth: 760, margin: '0 auto', padding: 12, fontFamily: 'system-ui, sans-serif', lineHeight: 1.5 }}>
    <h1>Launch campaign test</h1>
    <p>
      <span data-testid="page-mode"><strong>{live ? 'LIVE' : 'DEMO'}</strong></span>
      {' '}· Connection: <span data-testid="connection-state">{llm.label}; {social.label} (this page never posts); database not connected (in-memory, resets on server restart)</span>
    </p>
    <p>
      The brand and listings below come from the demo catalogue. The demo store is treated as published at the brand&apos;s store address; it is not a real published store.
      {' '}<span data-testid="link-mode">{linksAreAbsolute(ctx.store) ? 'Links are full store URLs.' : 'No store domain is configured here, so links are shown as store paths.'}</span>
    </p>
    {msg && <p role="alert" data-testid="campaign-message">{msg}</p>}

    <h2>What the campaign is built from</h2>
    <p data-testid="brand">Approved brand: {ctx.brand ? <><strong>{ctx.brand.name}</strong> · tone {ctx.brand.tone} · store address {ctx.brand.slug}</> : 'none'}</p>
    <ul data-testid="listings">
      {sellable.map((l) => <li key={l.listingId}>{l.title} · {formatAud(l.priceMinor)} {l.currency} · approved</li>)}
      {ctx.listings.filter((l) => l.status === 'draft').map((l) => <li key={l.listingId}>{l.title} · draft, left out of the campaign</li>)}
    </ul>

    <form action={regenerate}>
      <p><label>First day of the launch, for a 30-day plan (YYYY-MM-DD; empty means today) <input name="startDate" defaultValue={plan?.schedule.startDate ?? ''} style={box} /></label></p>
      <p><label><input type="checkbox" name="useLlm" value="1" /> Ask the AI provider to improve the copy ({llm.label}). Copy that breaks a rule is dropped and the built-in plan is kept.</label></p>
      <p><button type="submit" style={btn} data-testid="regenerate">{campaign ? 'Regenerate' : 'Generate campaign'}</button></p>
    </form>

    {!campaign || !plan ? <p data-testid="no-campaign">No campaign planned yet.</p> : <>
      <h2>Campaign</h2>
      <p>
        Version <span data-testid="campaign-version">{campaign.version}</span> · <strong data-testid="campaign-status">{campaign.status}</strong>
        {' '}· written by <span data-testid="campaign-source">{plan.source === 'llm' ? 'AI copy on the built-in plan' : 'the built-in generator'}</span>
        {campaign.approvedAt && <> · approved {campaign.approvedAt}</>}
      </p>
      {campaign.status === 'draft' && <form action={approve}>
        <input type="hidden" name="version" value={campaign.version} />
        <button type="submit" style={btn} data-testid="approve">Approve this campaign</button>
      </form>}

      <h3>Audience</h3>
      <p data-testid="audience"><strong>{plan.audience.who}</strong>. {plan.audience.problem}</p>
      <ul>{plan.audience.whereTheyAre.map((w) => <li key={w}>{w}</li>)}</ul>

      <h3>Channel</h3>
      <p data-testid="channel">Main channel: <strong>{plan.primaryChannel}</strong>. Export only (you post these yourself): {plan.secondaryChannels.map((s) => s.channel).join(', ') || 'none'}.</p>

      <h3>Content pillars</h3>
      <ul data-testid="pillars">{plan.pillars.map((x) => <li key={x.id}><strong>{x.title}</strong>: {x.summary}</li>)}</ul>

      <h3>Pinterest and search themes</h3>
      <ul data-testid="seo-themes">{plan.seoThemes.map((t) => <li key={t.theme} data-testid="seo-theme"><strong>{t.theme}</strong> · board: {t.pinterestBoard} · keywords: {t.keywords.join(', ')}</li>)}</ul>

      <h3>Schedule ({plan.schedule.startDate} to {plan.schedule.endDate})</h3>
      {plan.schedule.days.map((d) => <section key={d.day} data-testid="schedule-day" style={{ borderTop: '1px solid #ccc', marginTop: 12 }}>
        <h4>Day {d.day} · {d.date}</h4>
        {plan.items.filter((it) => d.itemIds.includes(it.id)).map((it) => <div key={it.id} data-testid="campaign-item" style={{ marginBottom: 12 }}>
          <p><strong>{it.hook}</strong> · {it.channel} {it.format}{it.exportOnly ? ' (export only)' : ''} · pillar {it.pillarId}</p>
          <p>{it.description}</p>
          <p>Angle: {it.angle}</p>
          <p>Call to action: {it.callToAction}</p>
          <p>Product: {it.productTitle} · <span data-testid="item-price">{it.priceLabel} {it.currency}</span> · link <a href={it.targetUrl} data-testid="item-link">{it.targetUrl}</a></p>
        </div>)}
      </section>)}
    </>}

    <h2>Claim rules applied to every line of copy</h2>
    <ul data-testid="claim-rules">{claimRules.map((r) => <li key={r.id}>{r.label}</li>)}</ul>
  </main>;
}
