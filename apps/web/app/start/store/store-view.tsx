'use client';
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  AppIntro, GlassBadge, GlassButton, GlassCard, GlassField, GlassGrid, GlassIcon, GlassKeyValue, GlassNotice, GlassSelect, GlassState, GlassTextArea,
} from '../../design-system/aimp-glass';
import { formatPrice } from '../../../lib/aimp/storefront/load';
import { paymentsState, storeAction } from '../actions';
import { reviewLaunch } from '../../../lib/aimp/launch/review';
import { formatWhen, journeyRoute } from '../journey';
import { JourneyShell, LoadingState, NeedBusiness, useJourney } from '../journey-client';
import type { PaymentsState, StoreOp, StoreState } from '../journey-types';

type Site = NonNullable<StoreState['site']>;
interface Form { heading: string; subheading: string; tagline: string }
const formOf = (s: Site): Form => ({ heading: s.draft.config.hero.heading, subheading: s.draft.config.hero.subheading, tagline: s.draft.config.brand.tagline });

/** The one thing the owner should do next, worked out from the store's real state. */
function nextAction(s: Site): { title: string; why: string } {
  if (s.publicView.status === 'paused') return { title: 'Resume your store', why: 'It is paused, so visitors would see a “temporarily unavailable” page.' };
  if (s.publicView.status === 'none') return { title: 'Preview your draft, then publish it', why: 'Nothing has been published, so visitors would see a “not found” page.' };
  if (s.draft.hasUnpublishedChanges) return { title: 'Publish your changes', why: 'Your draft is different from the live version. Visitors still get the live version.' };
  if (!s.purchase.canBuy) return { title: 'Continue to payments', why: `The buy button is off. ${s.purchase.reason}` };
  return { title: 'Nothing needed', why: 'The live version matches your draft and the buy button is on.' };
}

export function StoreView() {
  const { ready, journey } = useJourney();
  const [state, setState] = useState<StoreState | null>(null);
  const [failed, setFailed] = useState(false);
  const [payments, setPayments] = useState<PaymentsState | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [note, setNote] = useState('');
  const [rollbackTo, setRollbackTo] = useState('');
  const [notice, setNotice] = useState<{ ok: boolean; text: string; errors: string[] } | null>(null);
  const [busy, setBusy] = useState<'' | StoreOp['kind']>('');
  const busyRef = useRef(false);
  const businessId = journey?.businessId ?? '';

  const take = (s: StoreState, keepForm = false) => {
    setState(s);
    if (!keepForm) setForm(s.site ? formOf(s.site) : null);
    const live = s.site?.history.liveVersion ?? null;
    setRollbackTo(live && live > 1 ? String(live - 1) : '');
  };

  useEffect(() => {
    if (!journey) return;
    let live = true;
    storeAction(journey.businessId, { kind: 'load' }).then((r) => { if (!live) return; take(r.state); if (!r.ok) setNotice({ ok: false, text: r.message, errors: r.errors }); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [journey]);

  useEffect(() => {
    let live = true;
    paymentsState().then((p) => { if (live) setPayments(p); }).catch(() => { /* the review then says payments could not be read */ });
    return () => { live = false; };
  }, []);

  async function run(op: StoreOp) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(op.kind); setNotice(null);
    try {
      const r = await storeAction(businessId, op);
      take(r.state, !r.ok || op.kind === 'preview'); // keep what was typed when a save is refused
      setNotice({ ok: r.ok, text: r.message, errors: r.errors });
      if (r.ok && op.kind === 'publish') setNote('');
    } catch { setNotice({ ok: false, text: 'We could not reach the server, so nothing was changed. Try again.', errors: [] }); }
    finally { busyRef.current = false; setBusy(''); }
  }

  const shell = { step: 'store' as const, backHref: journeyRoute('catalogue'), backLabel: 'Back to your listings' };
  if (!ready) return <JourneyShell {...shell}><LoadingState title="Loading your store…" /></JourneyShell>;
  if (!journey) return <JourneyShell {...shell}><NeedBusiness /></JourneyShell>;
  if (failed) return <JourneyShell {...shell}><GlassState kind="error" title="We could not load your store" action={<GlassButton block={false} onClick={() => window.location.reload()}>Try again</GlassButton>}><p>The server did not answer. Nothing was changed.</p></GlassState></JourneyShell>;
  if (!state) return <JourneyShell {...shell}><LoadingState title="Loading your store…" /></JourneyShell>;

  const site = state.site;
  const isBusy = busy !== '';
  const dirty = Boolean(site && form && JSON.stringify(form) !== JSON.stringify(formOf(site)));
  const pub = site?.publicView;
  const live = pub?.status === 'live' ? pub : null;
  const next = site ? nextAction(site) : null;
  const seller = payments?.readiness;
  const review = reviewLaunch({
    brandApproved: state.brandApproved, approvedListings: state.approvedListings, hasStoreDraft: Boolean(site), formDirty: dirty,
    hasUnpublishedChanges: site?.draft.hasUnpublishedChanges ?? true, hasLiveVersion: site?.history.liveVersion != null, paused: Boolean(site?.draft.paused),
    buyEnabled: Boolean(site?.purchase.canBuy),
    paymentsNextAction: seller?.nextAction.label ?? 'Check your payments',
    paymentsWhy: seller?.nextAction.why ?? (site && !site.purchase.canBuy ? site.purchase.reason : 'We could not read your payment status yet.'),
    paymentsOutstanding: seller?.outstanding ?? [],
  });
  const older = site ? site.history.versions.filter((v) => v.version !== site.history.liveVersion) : [];
  const preview = site?.preview ?? null;
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setForm((f) => (f ? { ...f, [k]: e.target.value } : f));

  const footer = (
    <>
      <GlassButton variant={live ? 'primary' : 'secondary'} href={journeyRoute('payments')} icon={live ? <GlassIcon name="spark" size={22} tone="deep" /> : undefined}>Continue to payments</GlassButton>
      <GlassButton variant="secondary" href={journeyRoute('catalogue')}>Back to your listings</GlassButton>
    </>
  );

  return (
    <JourneyShell {...shell} footer={footer}>
      <AppIntro eyebrow={journey.idea.niche} title="Preview and publish your store">
        <p>Your store starts as a private draft built from your approved brand and listings. You preview it, publish it, and can pause it or go back to an earlier version at any time.</p>
      </AppIntro>
      <p className="plg-badges" data-testid="connection-state">
        <GlassBadge dot>Database not connected · demo storage on the server</GlassBadge>
        <GlassBadge dot>Nothing here goes on the public internet</GlassBadge>
      </p>
      {!state.available ? <GlassNotice tone="warn" title="This step is not switched on here"><p>{state.reason}</p></GlassNotice> : null}
      {notice?.text ? <GlassNotice tone={notice.ok ? 'success' : 'error'} title={notice.text} data-testid="message">{notice.errors.length ? <ul className="plg-list">{notice.errors.map((e) => <li key={e}>{e}</li>)}</ul> : null}</GlassNotice> : null}

      {state.available && !site ? (
        <GlassCard heading="h2" eyebrow="No store yet" title="Create your store draft" data-testid="no-store"
          footer={<GlassButton variant="primary" onClick={() => run({ kind: 'create' })} loading={busy === 'create'} loadingLabel="Creating your draft…" disabled={!state.brandApproved || state.approvedListings === 0} icon={<GlassIcon name="spark" size={22} tone="deep" />}>Create my store draft</GlassButton>}>
          <p className="plg-text">The draft uses your approved brand for its name, look and headline, and your approved listings for its products and prices.</p>
          <GlassKeyValue items={[
            { label: 'Brand', value: state.brandApproved ? <GlassBadge tone="success">Approved</GlassBadge> : <a className="plg-link" href={journeyRoute('brand')}>Approve your brand</a> },
            { label: 'Approved listings', value: state.approvedListings > 0 ? <GlassBadge tone="success">{state.approvedListings}</GlassBadge> : <a className="plg-link" href={journeyRoute('catalogue')}>Approve a listing</a> },
          ]} />
          <p className="plg-note">The FAQ, trust points and policies start as sample text from the demo store, and the contact email is a placeholder. The store is marked as a demo, so it shows a DEMO banner and cannot take payment.</p>
        </GlassCard>
      ) : null}

      {site && form && next ? (
        <>
          <GlassCard heading="h2" highlighted eyebrow="Store status" title={live ? `Live · version ${live.version}` : pub?.status === 'paused' ? 'Paused' : 'Not published'} data-testid="public-status"
            badges={<GlassBadge tone={live ? 'success' : pub?.status === 'paused' ? 'warn' : 'neutral'} dot>{live ? 'Live in this demo' : pub?.status === 'paused' ? 'Paused' : 'Draft only'}</GlassBadge>}>
            <div className="plg-stack" data-gap="1">
              <p className="plg-eyebrow">The one thing to do next</p>
              <p className="plg-card-title" data-testid="next-action">{next.title}</p>
              <p className="plg-text">{next.why}</p>
            </div>
            <GlassKeyValue items={[
              { label: 'Store address', value: <span className="plg-mono">{site.slug}</span> },
              { label: 'What visitors get', value: live ? `Version ${live.version}: “${live.config.hero.heading}”` : pub?.status === 'paused' ? 'A “temporarily unavailable” page' : 'A “not found” page' },
              { label: 'Your draft', value: <span data-testid="draft-state">{site.draft.hasUnpublishedChanges ? 'Has unpublished changes' : 'Matches the live version'} (revision {site.draft.revision})</span> },
              { label: 'Buy button', value: <span data-testid="buy-state">{site.purchase.canBuy ? 'On' : `Off. ${site.purchase.reason}`}</span> },
            ]} />
            <p className="plg-note">“Live” here means the published version in this demo. The public store address only serves the two sample stores for now, so no one else can open your store yet.</p>
          </GlassCard>

          <GlassCard heading="h2" highlighted eyebrow="Review my launch" title={review.headline} data-testid="launch-review"
            footer={<GlassButton variant="primary" data-testid="approve-publish" icon={<GlassIcon name="spark" size={22} tone="deep" />}
              onClick={() => run({ kind: 'publish', note, expectedRevision: site.draft.revision })} loading={busy === 'publish'} loadingLabel="Publishing…"
              disabled={!review.canApprove || dirty || (isBusy && busy !== 'publish')}>Approve and publish</GlassButton>}>
            <ul className="plg-list" data-testid="launch-items">
              {review.items.map((it) => (
                <li key={it.id} data-status={it.status}>
                  <GlassBadge tone={it.status === 'done' ? 'success' : it.status === 'waiting' ? 'warn' : 'neutral'}>{it.status === 'done' ? 'Done' : it.status === 'waiting' ? 'Waiting' : 'To do'}</GlassBadge>{' '}
                  <strong>{it.label}.</strong> {it.detail} {it.status !== 'done' && it.step !== 'store' ? <a className="plg-link" href={journeyRoute(it.step)}>Open</a> : null}
                </li>
              ))}
            </ul>
            {review.blockers.length > 0 ? <GlassNotice tone="warn" title="What is stopping you publishing"><ul className="plg-list">{review.blockers.map((b) => <li key={b}>{b}</li>)}</ul></GlassNotice> : null}
            {review.canApprove && review.paymentsHolding.length > 0 ? <GlassNotice tone="info" title="What is holding up payments" data-testid="payments-holding"><ul className="plg-list">{review.paymentsHolding.map((b) => <li key={b}>{b}</li>)}</ul></GlassNotice> : null}
            <p className="plg-note">{review.actionNote}</p>
          </GlassCard>

          <GlassGrid min={380}>
            <GlassCard heading="h2" eyebrow="Private draft" title="Edit your store"
              footer={<>
                <GlassButton variant={dirty ? 'primary' : 'secondary'} onClick={() => run({ kind: 'save', ...form, expectedRevision: site.draft.revision })} loading={busy === 'save'} loadingLabel="Saving…" disabled={!dirty || (isBusy && busy !== 'save')}>Save draft</GlassButton>
                <GlassButton variant="secondary" onClick={() => run({ kind: 'preview' })} loading={busy === 'preview'} loadingLabel="Building the preview…" disabled={dirty || (isBusy && busy !== 'preview')}>Preview draft</GlassButton>
              </>}>
              <form className="plg-stack" data-gap="4" aria-label="Edit your store draft" onSubmit={(e) => { e.preventDefault(); if (dirty) void run({ kind: 'save', ...form, expectedRevision: site.draft.revision }); }} noValidate>
                <GlassField label="Headline" name="heading" value={form.heading} onChange={set('heading')} autoComplete="off" hint="Up to 90 characters." />
                <GlassTextArea label="Text under the headline" name="subheading" rows={3} value={form.subheading} onChange={set('subheading')} />
                <GlassField label="Tagline" name="tagline" value={form.tagline} onChange={set('tagline')} autoComplete="off" />
                <button type="submit" className="plg-sr" tabIndex={-1} aria-hidden="true">Save</button>
              </form>
              <p className="plg-note">{site.draft.config.products.length} {site.draft.config.products.length === 1 ? 'product' : 'products'} in the draft.</p>
              <p><button type="button" className="plg-link" data-target="large" disabled={isBusy} onClick={() => run({ kind: 'sync', expectedRevision: site.draft.revision })}>Bring in my latest approved listings</button>
              </p>
              {dirty ? <p className="plg-note">Save the draft before you preview or publish it.</p> : null}
            </GlassCard>

            <GlassCard heading="h2" eyebrow="Go live, pause or go back" title="Publish"
              footer={<>
                {site.draft.paused
                  ? <GlassButton variant="secondary" onClick={() => run({ kind: 'unpause' })} loading={busy === 'unpause'} disabled={isBusy && busy !== 'unpause'}>Resume store</GlassButton>
                  : <GlassButton variant="secondary" onClick={() => run({ kind: 'pause' })} loading={busy === 'pause'} disabled={site.history.liveVersion === null || (isBusy && busy !== 'pause')}>Pause store</GlassButton>}
              </>}>
              <GlassField label="Note for this version (optional)" name="note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} autoComplete="off" hint="For your own history, for example “New headline”." />
              <p className="plg-text">Publishing checks the whole store first. If anything fails, nothing changes and the live version keeps being served.</p>
              {older.length > 0 ? (
                <div className="plg-stack" data-gap="3">
                  <GlassSelect label="Go back to an earlier version" name="rollback" value={rollbackTo} onChange={(e) => setRollbackTo(e.target.value)}>
                    <option value="">Choose a version</option>
                    {older.map((v) => <option key={v.version} value={v.version}>Version {v.version}{v.note ? ` · ${v.note}` : ''}</option>)}
                  </GlassSelect>
                  <GlassButton variant="secondary" data-testid="rollback" onClick={() => run({ kind: 'rollback', version: Number(rollbackTo) })} loading={busy === 'rollback'} disabled={!rollbackTo || (isBusy && busy !== 'rollback')}>Restore that version</GlassButton>
                  <p className="plg-note">Restoring publishes the old version again as a new version. Nothing is deleted.</p>
                </div>
              ) : <p className="plg-note">Once you have published more than once, you can go back to an earlier version here.</p>}
            </GlassCard>
          </GlassGrid>

          {preview ? (
            <GlassCard heading="h2" eyebrow="Preview of your draft" title="How your store would look" data-testid="preview-box" badges={<><GlassBadge>Not public</GlassBadge><GlassBadge>{preview.render.robots ? 'Hidden from search engines' : 'Visible to search engines'}</GlassBadge></>}>
              <div className="store-preview" style={preview.render.cssVars as CSSProperties}>
                {preview.render.demo ? <p className="store-preview-demo"><strong>DEMO STORE</strong> Sample policies. Checkout is turned off.</p> : null}
                <p className="store-preview-logo">{preview.config.brand.name}</p>
                <div className="store-preview-hero">
                  <p className="store-preview-eyebrow">{preview.config.hero.eyebrow}</p>
                  <p className="store-preview-heading">{preview.config.hero.heading}</p>
                  <p className="store-preview-sub">{preview.config.hero.subheading}</p>
                  <span className="store-preview-cta">{preview.config.hero.ctaLabel}</span>
                </div>
                <ul className="store-preview-products">
                  {preview.config.products.map((p) => (
                    <li key={p.slug}>
                      <span className="store-preview-cover" data-style={p.cover.style}>{p.cover.label}</span>
                      <span className="store-preview-title">{p.title}</span>
                      <span className="store-preview-sub">{p.summary}</span>
                      <span className="store-preview-price">{formatPrice(p.priceMinor)} · {p.format}{p.pages ? ` · ${p.pages} pages` : ''}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <p className="plg-note">A simplified preview drawn from the draft’s real settings and theme (revision {preview.revision}). The full storefront pages are not connected to your draft yet.</p>
            </GlassCard>
          ) : null}

          <GlassCard heading="h2" title="History" data-testid="history">
            {site.history.versions.length === 0 ? <p className="plg-text">Nothing has been published yet.</p> : (
              <GlassKeyValue items={[...site.history.versions].sort((a, b) => b.version - a.version).map((v) => ({
                key: String(v.version),
                label: <>Version {v.version} · {v.source.kind === 'rollback' ? `restored from version ${v.source.fromVersion}` : 'published'} · {formatWhen(v.publishedAt)}{v.note ? <><br /><span className="plg-note">{v.note}</span></> : null}</>,
                value: v.version === site.history.liveVersion ? <GlassBadge tone={site.history.paused ? 'warn' : 'success'}>{site.history.paused ? 'Paused' : 'Live'}</GlassBadge> : <GlassBadge>Earlier</GlassBadge>,
              }))} />
            )}
            {site.history.events.length > 0 ? <ul className="plg-list" data-testid="events">{[...site.history.events].sort((a, b) => b.at.localeCompare(a.at)).map((e, i) => <li key={i}>{formatWhen(e.at)}: {e.kind}{e.version ? ` (version ${e.version})` : ''}</li>)}</ul> : null}
          </GlassCard>
        </>
      ) : null}
    </JourneyShell>
  );
}
