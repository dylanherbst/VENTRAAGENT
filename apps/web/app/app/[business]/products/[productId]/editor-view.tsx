'use client';
// Product editor and asset review (screen 13) on the Peach & Lavender glass library. Everything the owner does here goes through
// `editProductAction`, which checks the request and then runs the existing /start actions (product service: approve, build a new
// version; catalogue service: write, save, update, approve the listing). The page then reloads what the services now say.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { AppIntro, AppLayout, GlassBadge, GlassButton, GlassCard, GlassField, GlassGrid, GlassIcon, GlassKeyValue, GlassNotice, GlassTextArea } from '../../../../design-system/aimp-glass';
import { editProductAction } from './actions';
import type { EditorOp } from './_server/editor-guard';
import { COMING_SOON_ITEMS, DEMO_NOTE, exportHref, formFromListing, isFormDirty, parsePrice, productsHref } from './view-model';
import type { EditorVM, ListingForm, ListingVM, QaVM } from './view-model';
import './editor.css';

const UNREACHABLE = 'We could not reach the server, so nothing was changed. Try again.';
type Run = (op: EditorOp, busyKey: string) => Promise<void>;
const statusTone = { active: 'success', draft: 'neutral', archived: 'neutral' } as const;
const listingTone = { draft: 'neutral', approved: 'success', superseded: 'neutral' } as const;

/** Field limits come from the catalogue validator, passed in by the server page so this client file imports no lib code. */
export interface FieldLimits { title: number; short: number; long: number }

function QaList({ qa }: { qa: QaVM }) {
  return (
    <ul className="ape-rows">
      {qa.checks.map((c) => (
        <li key={c.id}>
          <span>{c.label}{c.reasons.length ? <><br /><span className="plg-note">{c.reasons.join(' ')}</span></> : null}</span>
          <GlassBadge tone={c.passed ? 'success' : 'danger'}>{c.passed ? 'Pass' : 'Fail'}</GlassBadge>
        </li>
      ))}
    </ul>
  );
}

function ListingCard({ editor, listing, run, busy, limits }: { editor: EditorVM; listing: ListingVM; run: Run; busy: string; limits: FieldLimits }) {
  const [form, setForm] = useState<ListingForm>(formFromListing(listing));
  const price = parsePrice(form.price);
  const dirty = isFormDirty(form, listing);
  const locked = editor.archived || busy !== '';
  const set = (k: keyof ListingForm) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = () => { if (price.ok) void run({ kind: 'save_listing', version: listing.version, title: form.title, shortDescription: form.shortDescription, longDescription: form.longDescription, priceMinor: price.minor }, 'save'); };

  return (
    <GlassCard heading="h2" id="listing" eyebrow={`${listing.statusLabel} · listing version ${listing.version}`} title="Listing and price" data-testid="listing"
      badges={<GlassBadge tone={listingTone[listing.status]}>{listing.statusLabel}</GlassBadge>}>
      <p className="plg-note">
        Sells product version {listing.productVersion}.
        {listing.status === 'draft' && listing.approvedPrice ? ` The approved price, ${listing.approvedPrice}, stays in use until you approve this draft.` : ''}
        {listing.status === 'approved' ? ' Changes you save here start a new draft. The approved listing stays in use until you approve the draft.' : ''}
      </p>
      <form className="plg-stack" data-gap="4" aria-label="Edit the listing" onSubmit={(e) => { e.preventDefault(); save(); }} noValidate>
        <GlassField label="Title" name="title" value={form.title} onChange={set('title')} autoComplete="off" maxLength={limits.title} disabled={editor.archived} />
        <GlassTextArea label="Short description" name="shortDescription" rows={2} maxLength={limits.short} showCount value={form.shortDescription} onChange={set('shortDescription')} disabled={editor.archived} />
        <GlassTextArea label="Long description" name="longDescription" rows={5} maxLength={limits.long} showCount value={form.longDescription} onChange={set('longDescription')} disabled={editor.archived} />
        <GlassField label="Price (AUD)" name="price" inputMode="decimal" value={form.price} onChange={set('price')} autoComplete="off" disabled={editor.archived}
          error={price.ok ? undefined : price.message} hint="Whole dollars or dollars and cents. The catalogue checks the price when you save." />
        <button type="submit" className="plg-sr" tabIndex={-1} aria-hidden="true">Save listing</button>
      </form>
      <div className="ape-actions">
        <GlassButton variant={dirty ? 'primary' : 'secondary'} onClick={save} loading={busy === 'save'} loadingLabel="Saving…" disabled={!dirty || !price.ok || locked}>Save listing</GlassButton>
        {listing.status === 'draft' && listing.behind ? (
          <GlassButton variant="secondary" onClick={() => { void run({ kind: 'repin_listing' }, 'repin'); }} loading={busy === 'repin'} loadingLabel="Updating…" disabled={locked}>
            Update the draft to the approved product version
          </GlassButton>
        ) : null}
        {listing.status === 'draft' ? (
          <GlassButton variant={dirty ? 'secondary' : 'primary'} onClick={() => { void run({ kind: 'approve_listing', version: listing.version }, 'approve_listing'); }} loading={busy === 'approve_listing'}
            loadingLabel="Approving…" disabled={dirty || locked} icon={<GlassIcon name="spark" size={22} tone="deep" />}>Approve this listing</GlassButton>
        ) : null}
      </div>
      <p className="plg-note">{dirty ? 'Save your changes first. A listing is approved exactly as it was saved.' : listing.status === 'draft' ? 'This draft is saved. Approving it makes the store use this wording and price.' : 'Nothing has changed since the approved listing.'}</p>
    </GlassCard>
  );
}

export function ProductEditorView({ businessId, editor, limits }: { businessId: string; editor: EditorVM; limits: FieldLimits }) {
  const router = useRouter();
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState<{ ok: boolean; text: string; errors: string[] } | null>(null);
  const busyRef = useRef(false);

  const run: Run = async (op, key) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(key); setNotice(null);
    try {
      const r = await editProductAction(businessId, editor.id, op);
      setNotice({ ok: r.ok, text: r.message || (r.ok ? 'Done.' : 'Nothing was changed.'), errors: r.errors });
      if (r.ok) router.refresh();
    } catch { setNotice({ ok: false, text: UNREACHABLE, errors: [] }); }
    finally { busyRef.current = false; setBusy(''); }
  };

  const { next, listing, qa, current, newer } = editor;
  const locked = editor.archived || busy !== '';
  const file = current?.file ?? null;

  return (
    <AppLayout width="wide">
      <AppIntro eyebrow={editor.type} title={editor.name}
        badges={<><GlassBadge tone="demo" dot data-testid="page-mode">DEMO</GlassBadge><GlassBadge tone={statusTone[editor.status]} data-testid="product-status">{editor.statusLabel}</GlassBadge></>}>
        <p>Make this product ready to sell, and see exactly which file buyers receive.</p>
        <p className="plg-note" data-testid="demo-note">{DEMO_NOTE}</p>
        <Link href={productsHref(businessId)} className="plg-link ape-back" data-target="large" data-testid="back-to-products">Back to your products</Link>
      </AppIntro>

      {notice ? (
        <GlassNotice tone={notice.ok ? 'success' : 'error'} title={notice.text} data-testid={notice.ok ? 'done' : 'failed'}>
          {notice.errors.length ? <ul className="plg-list">{notice.errors.map((e) => <li key={e}>{e}</li>)}</ul> : null}
        </GlassNotice>
      ) : null}

      <GlassCard heading="h2" highlighted eyebrow="Your next step" title={next.title} data-testid="next-step">
        <p className="plg-text">{next.text}</p>
        {next.id === 'approve_version' && editor.pending ? (
          <GlassButton variant="primary" onClick={() => { void run({ kind: 'approve_version', versionId: editor.pending!.id }, 'approve_version'); }} loading={busy === 'approve_version'}
            loadingLabel="Approving…" disabled={locked} icon={<GlassIcon name="spark" size={22} tone="deep" />}>Approve product version {editor.pending.version}</GlassButton>
        ) : null}
        {next.id === 'rebuild' && editor.regen.can ? (
          <GlassButton variant="primary" onClick={() => { void run({ kind: 'regenerate' }, 'regenerate'); }} loading={busy === 'regenerate'} loadingLabel="Building…" disabled={locked}>Build a new version</GlassButton>
        ) : null}
        {next.id === 'start_listing' ? (
          <GlassButton variant="primary" onClick={() => { void run({ kind: 'start_listing' }, 'start_listing'); }} loading={busy === 'start_listing'} loadingLabel="Writing…" disabled={locked}>Write the listing draft</GlassButton>
        ) : null}
        {next.id === 'approve_listing' || next.id === 'update_listing' ? <GlassButton variant="primary" href="#listing">Go to the listing</GlassButton> : null}
      </GlassCard>

      {newer ? (
        <GlassCard heading="h2" eyebrow={`Version ${newer.version} · ${newer.statusLabel}`} title={`Version ${newer.version}: checks and file`} data-testid="newer-version"
          badges={<GlassBadge tone={newer.qa.allPassed ? 'success' : 'danger'}>{newer.qa.allPassed ? 'All passed' : 'Needs fixing'}</GlassBadge>}>
          <p className="plg-text">
            {current?.status === 'approved' ? `Buyers still get version ${current.version} until you approve this one. ` : ''}
            This is what you are looking at before you decide on version {newer.version}.
          </p>
          <QaList qa={newer.qa} />
          {newer.file ? (
            <>
              <GlassKeyValue items={[
                { label: 'File', value: newer.file.name },
                { label: 'Size', value: newer.file.size },
                { label: 'Length', value: newer.file.pages },
                { label: 'Fingerprint', value: <span className="ape-hash" title={newer.file.hash}>{newer.file.shortHash}…</span> },
              ]} />
              {newer.contents.length ? (
                <>
                  <h3 className="plg-text"><strong>What is inside version {newer.version}</strong></h3>
                  <ul className="plg-list" data-testid="newer-contents">{newer.contents.map((s) => <li key={s.title}>{s.title} ({s.pages} {s.pages === 1 ? 'page' : 'pages'})</li>)}</ul>
                </>
              ) : null}
            </>
          ) : <p className="plg-text">No file could be built for version {newer.version}.</p>}
        </GlassCard>
      ) : null}

      <GlassGrid min={340}>
        {listing ? <ListingCard key={`${listing.version}-${listing.status}-${listing.productVersion}`} editor={editor} listing={listing} run={run} busy={busy} limits={limits} /> : (
          <GlassCard heading="h2" title="Listing and price" badges={<GlassBadge>Not written yet</GlassBadge>} data-testid="listing">
            <p className="plg-text">There is no listing yet, so there is no price. {editor.current?.status === 'approved' ? 'Write the draft from the next-step card above.' : 'Approve a product version first.'}</p>
          </GlassCard>
        )}

        <GlassCard heading="h2" eyebrow={current ? `Version ${current.version} · ${current.statusLabel}${current.status === 'approved' ? ' · what buyers get now' : ''}` : undefined} title="The file buyers receive" data-testid="buyer-file"
          badges={current ? <GlassBadge tone={current.tone}>{current.statusLabel}</GlassBadge> : undefined}>
          {file && current ? (
            <>
              <p className="plg-text">{current.status === 'approved' ? 'This is the approved file. New buyers receive exactly this.' : 'No version is approved yet, so buyers receive nothing. This is the newest version, shown for review.'}</p>
              <GlassKeyValue items={[
                { label: 'File', value: file.name },
                { label: 'Size', value: file.size },
                { label: 'Length', value: file.pages },
                { label: 'Fingerprint', value: <span className="ape-hash" title={file.hash}>{file.shortHash}…</span> },
              ]} />
              {editor.contents.length ? (
                <>
                  <h3 className="plg-text"><strong>What is inside</strong></h3>
                  <ul className="plg-list" data-testid="contents">{editor.contents.map((s) => <li key={s.title}>{s.title} ({s.pages} {s.pages === 1 ? 'page' : 'pages'})</li>)}</ul>
                </>
              ) : null}
              {editor.includes.length ? (
                <>
                  <h3 className="plg-text"><strong>What the listing may say it includes</strong></h3>
                  <ul className="plg-list" data-testid="includes">{editor.includes.map((c) => <li key={c}>{c}</li>)}</ul>
                </>
              ) : null}
              <p className="plg-note">{editor.generatorNote}</p>
            </>
          ) : <p className="plg-text">No file could be built for this version, so there is nothing to review.</p>}
        </GlassCard>

        <GlassCard heading="h2" eyebrow={qa ? `Checks on version ${qa.version}${current?.status === 'approved' ? ' · the version buyers get now' : ''}` : undefined} title="Quality checks" data-testid="qa"
          badges={qa ? <GlassBadge tone={qa.allPassed ? 'success' : 'danger'}>{qa.allPassed ? 'All passed' : 'Needs fixing'}</GlassBadge> : undefined}>
          {qa ? <QaList qa={qa} /> : <p className="plg-text">No checks have run yet.</p>}
          <p className="plg-note">These are the product service&apos;s own checks. A version can only be approved when every check passes.</p>
        </GlassCard>
      </GlassGrid>

      <GlassCard heading="h2" title="Versions" data-testid="versions"
        footer={
          <div className="ape-actions">
            <GlassButton variant="secondary" onClick={() => { void run({ kind: 'regenerate' }, 'regenerate'); }} loading={busy === 'regenerate'} loadingLabel="Building…" disabled={!editor.regen.can || locked}>Build a new version</GlassButton>
          </div>
        }>
        <ul className="ape-rows" data-testid="version-list">
          {editor.versions.map((v) => (
            <li key={v.id} data-status={v.status} className={v.isCurrent ? 'ape-current' : undefined}>
              <span>
                <strong>Version {v.version}</strong>{v.isCurrent ? ' · shown above' : ''}<br />
                <span className="plg-note">{v.note}</span><br />
                <span className="plg-note">Built {v.created}{v.approved ? ` · approved ${v.approved}` : ''}</span>
                {v.file ? <><br /><span className="plg-note">{v.file.name} · <span className="ape-hash">{v.file.shortHash}…</span></span></> : null}
              </span>
              <GlassBadge tone={v.tone}>{v.statusLabel}</GlassBadge>
            </li>
          ))}
        </ul>
        <p className="plg-note">
          Building a new version never changes an approved one, and approving a new version never takes the file away from someone who already bought.
          {' '}{editor.regen.left} {editor.regen.left === 1 ? 'rebuild' : 'rebuilds'} left for this product.
        </p>
      </GlassCard>

      {current ? (
        <GlassCard heading="h2" title="Download" data-testid="downloads">
          <p className="plg-text">Save a copy of {current.status === 'approved' ? 'the approved' : 'the newest'} version, version {current.version}, to your computer.</p>
          <ul className="ape-rows ape-downloads">
            {editor.canExportXlsx ? (
              <li><a className="plg-link" data-target="large" download href={exportHref(businessId, editor.id, 'xlsx')} data-testid="download-xlsx">Spreadsheet (.xlsx)</a></li>
            ) : null}
            <li><a className="plg-link" data-target="large" download href={exportHref(businessId, editor.id, 'png')} data-testid="download-png">Cover image (.png)</a></li>
            <li><a className="plg-link" data-target="large" download href={exportHref(businessId, editor.id, 'png', 'licence')} data-testid="download-licence">Licence note (text)</a></li>
            <li><span className="plg-note" data-testid="download-jpg-note">JPG is not available yet.</span></li>
          </ul>
          <p className="plg-note">{editor.canExportXlsx ? '' : 'This product has no tracker or checklist pages, so there is no spreadsheet. '}The licence note says how the file may be used. It is also written inside each download.</p>
        </GlassCard>
      ) : null}

      <GlassCard heading="h2" title="Not available yet" badges={<GlassBadge>Coming soon</GlassBadge>} data-testid="coming-soon">
        <ul className="plg-list">{COMING_SOON_ITEMS.map((i) => <li key={i.title}><strong>{i.title}.</strong> {i.text}</li>)}</ul>
      </GlassCard>
    </AppLayout>
  );
}
