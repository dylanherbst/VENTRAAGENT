'use client';
import { useEffect, useRef, useState } from 'react';
import {
  AppIntro, GlassBadge, GlassButton, GlassCard, GlassDisclosure, GlassField, GlassGrid, GlassIcon, GlassKeyValue, GlassNotice, GlassState, GlassTextArea,
} from '../../design-system/aimp-glass';
import { formatAud } from '../../../lib/aimp/catalogue/pricing';
import { catalogueAction } from '../actions';
import { centsToInput, inputToCents, journeyRoute, statusText } from '../journey';
import { JourneyShell, LoadingState, NeedBusiness, useJourney } from '../journey-client';
import type { CatalogueOp, CatalogueState, ListingRow } from '../journey-types';

interface Form { title: string; shortDescription: string; longDescription: string; price: string }
type Run = (key: string, op: CatalogueOp) => Promise<void>;

function Listing({ row, busy, run }: { row: ListingRow; busy: string; run: Run }) {
  const latest = row.latest!;
  const saved: Form = { title: latest.title, shortDescription: latest.shortDescription, longDescription: latest.longDescription, price: centsToInput(latest.priceMinor) };
  const [form, setForm] = useState<Form>(saved);
  const stamp = `${latest.id}:${latest.updatedAt}`;
  const seen = useRef(stamp);
  if (seen.current !== stamp) { seen.current = stamp; setForm(saved); } // the server saved something: show exactly what it holds
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  const cents = inputToCents(form.price);
  const priceError = Number.isNaN(cents) ? 'Enter a price in dollars and cents, like 14.50.' : undefined;
  const isDraft = latest.status === 'draft';
  const id = row.listingId;
  const saveOp: CatalogueOp = { kind: 'save', listingId: id, version: latest.version, title: form.title, shortDescription: form.shortDescription, longDescription: form.longDescription, priceMinor: cents };
  const s = row.suggestion;
  const f = row.fees;
  const idle = busy === '';

  return (
    <GlassCard heading="h2" data-testid="listing" highlighted={isDraft}
      eyebrow={`Listing version ${latest.version} · sells product version ${latest.productVersion}`} title={latest.title}
      badges={<><span data-testid="listing-status"><GlassBadge tone={isDraft ? 'warn' : 'success'}>{isDraft ? 'Draft' : statusText(latest.status)}</GlassBadge></span><GlassBadge>{latest.editedBySeller ? 'Edited by you' : 'As generated'}</GlassBadge></>}
      footer={<>
        {isDraft && !dirty ? <GlassButton variant="primary" onClick={() => run(`approve-${id}`, { kind: 'approve', listingId: id, version: latest.version })} loading={busy === `approve-${id}`} loadingLabel="Approving…" disabled={!idle && busy !== `approve-${id}`}>Approve this listing</GlassButton> : null}
        <GlassButton variant={dirty ? 'primary' : 'secondary'} onClick={() => run(`save-${id}`, saveOp)} loading={busy === `save-${id}`} loadingLabel="Saving…" disabled={!dirty || Boolean(priceError) || (!idle && busy !== `save-${id}`)}>Save my changes</GlassButton>
      </>}>
      <p className="plg-text" data-testid="checkout-price">
        {row.checkout ? <><strong>Checkout would charge <span data-testid="stored-price">{formatAud(row.checkout.priceMinor)}</span>.</strong> That is the stored price of approved version {row.checkout.listingVersion}; a price sent by a browser is ignored.</> : <><strong>Not on sale.</strong> {row.checkoutReason}</>}
      </p>
      {row.productVersionBehind ? (
        <GlassNotice tone="warn" title={`Your product is now at version ${row.productApprovedVersion}`} live="none"
          action={isDraft ? <GlassButton block={false} onClick={() => run(`repin-${id}`, { kind: 'repin', listingId: id })} loading={busy === `repin-${id}`} disabled={!idle && busy !== `repin-${id}`}>Sell the new product version</GlassButton> : undefined}>
          <p>This listing still sells product version {latest.productVersion}.{isDraft ? '' : ' Save a change to start a new draft, then you can switch it.'}</p>
        </GlassNotice>
      ) : null}

      <form className="plg-stack" data-gap="4" aria-label={`Edit the listing for ${latest.title}`} onSubmit={(e) => { e.preventDefault(); if (dirty && !priceError) void run(`save-${id}`, saveOp); }} noValidate>
        {!isDraft ? <p className="plg-note">Saving a change starts a new draft. The approved wording and price stay in use until you approve the draft.</p> : null}
        <GlassField label="Title" name="title" value={form.title} onChange={set('title')} autoComplete="off" />
        <GlassTextArea label="Short description" name="shortDescription" rows={2} value={form.shortDescription} onChange={set('shortDescription')} />
        <GlassTextArea label="Long description" name="longDescription" rows={5} value={form.longDescription} onChange={set('longDescription')} />
        <GlassField label="Price (AUD)" name="price" inputMode="decimal" value={form.price} onChange={set('price')} autoComplete="off" icon={<GlassIcon name="dollar" />} error={priceError}
          hint={s ? <>Suggested {formatAud(s.suggestedMinor)} (estimate). Range {formatAud(s.lowMinor)} to {formatAud(s.highMinor)}; below {formatAud(s.floorMinor)} a sale leaves too little.</> : undefined} />
        {s && cents !== s.suggestedMinor ? <p><button type="button" className="plg-link" data-target="large" onClick={() => setForm((x) => ({ ...x, price: centsToInput(s.suggestedMinor) }))}>Use the suggested price</button></p> : null}
        <button type="submit" className="plg-sr" tabIndex={-1} aria-hidden="true">Save</button>
      </form>
      <p className="plg-note">Cover image: {latest.cover ? 'a placeholder cover record is attached. No image has been generated yet.' : 'none attached.'}</p>

      {f ? (
        <div className="plg-stack" data-gap="2">
          <p className="plg-eyebrow">Per sale at the saved price of {formatAud(f.priceMinor)} (estimate)</p>
          <GlassKeyValue data-testid="fees" items={[
            { label: 'Card fee (Stripe)', value: `− ${formatAud(f.stripeFeeMinor)}` },
            { label: 'Platform fee', value: `− ${formatAud(f.platformFeeMinor)}` },
            { label: 'You receive', value: formatAud(f.sellerNetMinor) },
            { label: 'Share of setup cost', value: `− ${formatAud(f.costPerSaleMinor)}` },
            { label: 'Margin per sale', value: `${formatAud(f.marginMinor)} (${f.marginBp / 100}%)` },
          ]} />
          <p className="plg-note">An estimate per sale, not a forecast of how many sales you will make.</p>
        </div>
      ) : null}
      {s ? <GlassDisclosure summary="How the suggested price was worked out"><ul className="plg-list" data-testid="reasons">{s.reasons.map((r) => <li key={r}>{r}</li>)}</ul></GlassDisclosure> : null}
      <GlassDisclosure summary={`Versions and changes (${row.versions.length})`}>
        <GlassKeyValue data-testid="versions" items={row.versions.map((v) => ({ key: String(v.version), label: `Version ${v.version} · ${formatAud(v.priceMinor)}`, value: <GlassBadge tone={v.status === 'approved' ? 'success' : 'neutral'}>{statusText(v.status)}</GlassBadge> }))} />
        <ul className="plg-list">{latest.history.map((h, i) => <li key={i}>{h.kind} (version {h.version}){h.changes.length ? `: ${h.changes.map((c) => c.field).join(', ')}` : ''}</li>)}</ul>
      </GlassDisclosure>
    </GlassCard>
  );
}

export function CatalogueView() {
  const { ready, journey } = useJourney();
  const [state, setState] = useState<CatalogueState | null>(null);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string; errors: string[] } | null>(null);
  const [busy, setBusy] = useState('');
  const busyRef = useRef(false);
  const businessId = journey?.businessId ?? '';

  useEffect(() => {
    if (!journey) return;
    let live = true;
    catalogueAction(journey.businessId, { kind: 'load' }).then((r) => { if (!live) return; setState(r.state); if (!r.ok) setNotice({ ok: false, text: r.message, errors: r.errors }); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [journey]);

  const run: Run = async (key, op) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(key); setNotice(null);
    try { const r = await catalogueAction(businessId, op); setState(r.state); setNotice({ ok: r.ok, text: r.message, errors: r.errors }); }
    catch { setNotice({ ok: false, text: 'We could not reach the server, so nothing was changed. Try again.', errors: [] }); }
    finally { busyRef.current = false; setBusy(''); }
  };

  const shell = { step: 'catalogue' as const, backHref: journeyRoute('products'), backLabel: 'Back to your products' };
  if (!ready) return <JourneyShell {...shell}><LoadingState title="Loading your listings…" /></JourneyShell>;
  if (!journey) return <JourneyShell {...shell}><NeedBusiness /></JourneyShell>;
  if (failed) return <JourneyShell {...shell}><GlassState kind="error" title="We could not load your listings" action={<GlassButton block={false} onClick={() => window.location.reload()}>Try again</GlassButton>}><p>The server did not answer. Nothing was changed.</p></GlassState></JourneyShell>;
  if (!state) return <JourneyShell {...shell}><LoadingState title="Loading your listings…" /></JourneyShell>;

  const anyApproved = state.rows.some((r) => r.approved);
  const footer = (
    <>
      {anyApproved ? <GlassButton variant="primary" href={journeyRoute('store')} icon={<GlassIcon name="spark" size={22} tone="deep" />}>Continue to your store</GlassButton> : null}
      <GlassButton variant="secondary" href={journeyRoute('products')}>Back to your products</GlassButton>
      {!anyApproved && state.rows.length > 0 ? <p className="plg-note">Approve a listing to continue. A store needs at least one approved listing.</p> : null}
    </>
  );

  return (
    <JourneyShell {...shell} footer={footer}>
      <AppIntro eyebrow={journey.idea.niche} title="Write your listings and set prices">
        <p>Each approved product gets a listing: the wording buyers see and the price checkout charges. Nothing is on sale until you approve it.</p>
      </AppIntro>
      <p className="plg-badges" data-testid="connection-state">
        <GlassBadge dot>Payments: {statusText(state.payments.status)} · fees are estimates</GlassBadge>
        <GlassBadge dot>Demo storage on the server · resets when it restarts</GlassBadge>
      </p>
      {!state.available ? <GlassNotice tone="warn" title="This step is not switched on here"><p>{state.reason}</p></GlassNotice> : null}
      {notice?.text ? <GlassNotice tone={notice.ok ? 'success' : 'error'} title={notice.text} data-testid="message">{notice.errors.length ? <ul className="plg-list">{notice.errors.map((e) => <li key={e}>{e}</li>)}</ul> : null}</GlassNotice> : null}
      {state.available && !state.brandApproved ? <GlassNotice tone="warn" title="Approve your brand first" live="none" action={<a className="plg-link" data-target="large" href={journeyRoute('brand')}>Go to your brand</a>}><p>Listing wording comes from the approved brand.</p></GlassNotice> : null}

      {state.available && state.rows.length === 0 ? (
        <GlassState kind="empty" title="No products to list yet" data-testid="empty" action={<GlassButton variant="primary" block={false} href={journeyRoute('products')}>Go to your products</GlassButton>}>
          <p>Build and approve a product first. If you already did, the demo server may have restarted and cleared it.</p>
        </GlassState>
      ) : null}

      <GlassGrid min={420}>
        {state.rows.map((row) => row.latest ? <Listing key={row.listingId} row={row} busy={busy} run={run} /> : (
          <GlassCard key={row.listingId} heading="h2" eyebrow="No listing yet" title={row.productTitle}
            badges={<GlassBadge tone={row.productApprovedVersion === null ? 'warn' : 'success'}>{row.productApprovedVersion === null ? 'Product not approved' : `Product version ${row.productApprovedVersion} approved`}</GlassBadge>}
            footer={row.productApprovedVersion === null ? <GlassButton variant="secondary" href={journeyRoute('products')}>Approve the product first</GlassButton>
              : <GlassButton variant="primary" data-testid="start" onClick={() => run(`start-${row.productId}`, { kind: 'start', productId: row.productId })} loading={busy === `start-${row.productId}`} loadingLabel="Writing the listing…" disabled={!state.brandApproved || (busy !== '' && busy !== `start-${row.productId}`)} icon={<GlassIcon name="spark" size={22} tone="deep" />}>Write the listing</GlassButton>}>
            <p className="plg-text">{row.productApprovedVersion === null ? 'A listing can only sell an approved product.' : 'We write a first draft from your approved product and brand and suggest a price. You can change all of it.'}</p>
          </GlassCard>
        ))}
      </GlassGrid>
    </JourneyShell>
  );
}
