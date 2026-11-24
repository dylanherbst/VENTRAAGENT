'use client';
// Products (screen 12) on the Peach & Lavender glass library. The list is read from the product and catalogue services on the
// server; "Add a product" runs the existing product builder through `createProductAction` and then reloads the list.
// Archive and Restore (AMP-097) go through `archiveProductAction`. Archive is a two-step confirm inside the product's own row:
// "Archive" opens the question and moves focus to "Keep it"; Escape or "Keep it" closes it and returns focus to "Archive";
// after an archive or restore the row leaves the list, so focus moves to the result message at the top.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { AppIntro, AppLayout, GlassBadge, GlassButton, GlassCard, GlassIcon, GlassNotice, GlassState } from '../../../design-system/aimp-glass';
import { archiveProductAction, createProductAction } from './actions';
import {
  BUNDLES_NOTE, LIMIT_COUNTS_ARCHIVED, applyFilter, archivedHint, confirmArchiveText, emptyCopy, filterCounts, filterHref, filterNames, productHref, statusFilters,
} from './view-model';
import type { CreatePlan, ProductRow, StatusFilter } from './view-model';

const UNREACHABLE = 'We could not reach the server, so nothing was added. Try again.';
const UNREACHABLE_CHANGE = 'We could not reach the server, so nothing was changed. Try again.';
const statusTone = { active: 'success', draft: 'neutral', archived: 'neutral' } as const;

interface Notice { ok: boolean; text: string; errors: string[]; storeNote: string; storeTone: 'warn' | 'info'; websiteHref: string | null; testid: string }
const plain = (ok: boolean, text: string, testid: string, errors: string[] = []): Notice => ({ ok, text, errors, storeNote: '', storeTone: 'info', websiteHref: null, testid });

const focusId = (id: string) => { document.getElementById(id)?.focus(); };

export function ProductsView({ businessId, rows, create, filter }: { businessId: string; rows: ProductRow[]; create: CreatePlan; filter: StatusFilter }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  /** The product whose "Archive?" question is open. */
  const [confirming, setConfirming] = useState<string | null>(null);
  /** The product an archive or restore is running for. */
  const [changing, setChanging] = useState<string | null>(null);
  const busyRef = useRef(false);
  const focusResult = useRef(false);
  /** The product whose Archive button gets focus back when its question closes without an archive. */
  const returnFocusTo = useRef<string | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const shown = applyFilter(rows, filter);
  const counts = filterCounts(rows);
  const empty = emptyCopy(filter, rows.length, counts.archived);
  const hint = filter === 'archived' ? '' : archivedHint(counts.archived);

  // Opening the question moves focus to the safe choice. Closing it with "Keep it" or Escape returns focus to that row's Archive
  // button, once it is rendered again.
  useEffect(() => {
    if (confirming) { focusId(`keep-${confirming}`); return; }
    const back = returnFocusTo.current;
    returnFocusTo.current = null;
    if (back) focusId(`archive-${back}`);
  }, [confirming]);
  // After an archive or restore the row is gone from this list, so focus goes to the message that says what happened.
  useEffect(() => { if (notice && focusResult.current) { focusResult.current = false; resultRef.current?.focus(); } }, [notice]);

  async function add() {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setNotice(null);
    try {
      const r = await createProductAction(businessId);
      setNotice(plain(r.ok, r.message || (r.ok ? 'Product added.' : 'Nothing was added.'), r.ok ? 'created' : 'create-failed', r.errors));
      if (r.ok) router.refresh();
    } catch { setNotice(plain(false, UNREACHABLE, 'create-failed')); }
    finally { busyRef.current = false; setBusy(false); }
  }

  function closeConfirm(productId: string) {
    // The Archive button is only back in the page after the re-render, so the effect above moves focus to it.
    returnFocusTo.current = productId;
    setConfirming(null);
  }

  async function change(productId: string, kind: 'archive' | 'restore') {
    if (busyRef.current) return;
    busyRef.current = true; setChanging(productId); setNotice(null);
    try {
      const r = await archiveProductAction(businessId, productId, kind === 'archive' ? { kind, confirm: true } : { kind });
      focusResult.current = true;
      setConfirming(null);
      setNotice({
        ok: r.ok, text: r.message || (r.ok ? 'Done.' : 'Nothing was changed.'), errors: [], storeNote: r.storeNote,
        storeTone: r.republish === 'needed' ? 'warn' : 'info', websiteHref: r.websiteHref, testid: r.ok ? (kind === 'archive' ? 'archived' : 'restored') : 'change-failed',
      });
      if (r.ok) router.refresh();
    } catch { focusResult.current = true; setNotice(plain(false, UNREACHABLE_CHANGE, 'change-failed')); }
    finally { busyRef.current = false; setChanging(null); }
  }

  return (
    <AppLayout width="wide">
      <AppIntro title="Products" badges={<GlassBadge tone="demo" dot data-testid="page-mode">DEMO</GlassBadge>}>
        <p>What you sell. A product is active once you have approved it and approved its listing and price.</p>
        <p className="plg-note" data-testid="demo-note">Demo storage on the server: products are kept in memory and are lost when the server restarts. Products are built by the built-in generator, not an AI model.</p>
        <Link href={`/app/${businessId}`} className="plg-link apr-back" data-target="large" data-testid="back-to-overview">Back to your overview</Link>
      </AppIntro>

      <div ref={resultRef} tabIndex={-1} className="apr-result" aria-live="polite" data-testid="result">
        {notice ? (
          <>
            <GlassNotice tone={notice.ok ? 'success' : 'error'} title={notice.text} data-testid={notice.testid}>
              {notice.errors.length ? <ul className="plg-list">{notice.errors.map((e) => <li key={e}>{e}</li>)}</ul> : null}
            </GlassNotice>
            {notice.storeNote ? (
              <GlassNotice tone={notice.storeTone} title={notice.storeNote} data-testid="store-note"
                action={notice.websiteHref ? <Link href={notice.websiteHref} className="plg-link apr-back" data-target="large" data-testid="go-to-website">Go to your Website page</Link> : undefined} />
            ) : null}
          </>
        ) : null}
      </div>

      <GlassCard heading="h2" title="Your products" data-testid="catalogue">
        <nav aria-label="Filter products by status">
          <ul className="apr-filters">
            {statusFilters.map((f) => (
              <li key={f}>
                <Link href={filterHref(businessId, f)} className="apr-filter" aria-current={f === filter ? 'page' : undefined} data-testid={`filter-${f}`}>
                  {filterNames[f]} <span aria-hidden="true">({counts[f]})</span><span className="plg-sr">, {counts[f]} products</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        {hint ? <p className="plg-note" data-testid="archived-hint">{hint}</p> : null}

        {shown.length ? (
          <ul className="apr-list" data-testid="product-list">
            {shown.map((p) => {
              const isArchived = p.status === 'archived';
              const asking = confirming === p.id;
              const working = changing === p.id;
              return (
                <li key={p.id} className="apr-item" data-testid="product-row" data-status={p.status}>
                  <h3>{p.name}</h3>
                  <div className="apr-meta">
                    <span>Type: {p.type}</span>
                    <span>Price: <strong>{p.price}</strong> <span className="plg-note">({p.priceNote})</span></span>
                    <GlassBadge tone={statusTone[p.status]}>{p.statusLabel}</GlassBadge>
                  </div>
                  <p className="plg-note">{p.detail}</p>
                  <Link href={productHref(businessId, p.id)} className="plg-link apr-back" data-target="large" data-testid="open-product">
                    {isArchived ? 'View' : 'Review and edit'}<span className="plg-sr"> {p.name}</span>
                  </Link>
                  {asking ? (
                    <div className="apr-confirm" role="group" aria-labelledby={`ask-${p.id}`} data-testid="confirm-archive"
                      onKeyDown={(e) => { if (e.key === 'Escape' && !working) { e.stopPropagation(); closeConfirm(p.id); } }}>
                      <p id={`ask-${p.id}`} className="plg-text">{confirmArchiveText(p.name)}</p>
                      <div className="apr-actions">
                        <GlassButton id={`keep-${p.id}`} variant="secondary" block={false} disabled={working} onClick={() => closeConfirm(p.id)} data-testid="confirm-no">Keep it</GlassButton>
                        <GlassButton variant="primary" block={false} loading={working} loadingLabel="Archiving…" onClick={() => { void change(p.id, 'archive'); }} data-testid="confirm-yes">
                          Yes, archive it<span className="plg-sr"> ({p.name})</span>
                        </GlassButton>
                      </div>
                    </div>
                  ) : (
                    <div className="apr-actions">
                      {isArchived ? (
                        <GlassButton variant="secondary" block={false} loading={working} loadingLabel="Restoring…" disabled={changing !== null && !working}
                          onClick={() => { void change(p.id, 'restore'); }} data-testid="restore-product">
                          Restore<span className="plg-sr"> {p.name}</span>
                        </GlassButton>
                      ) : (
                        <GlassButton id={`archive-${p.id}`} variant="secondary" block={false} disabled={changing !== null}
                          onClick={() => setConfirming(p.id)} data-testid="archive-product">
                          Archive<span className="plg-sr"> {p.name}</span>
                        </GlassButton>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <GlassState kind="empty" title={empty.title} data-testid="empty-state"><p>{empty.text}</p></GlassState>
        )}
      </GlassCard>

      <GlassCard heading="h2" highlighted eyebrow="Your next step" title="Add a product" data-testid="add-product">
        {create.canCreate ? (
          <p className="plg-text">Build another product from your business idea. It is checked before you can approve it. You can add {create.remaining} more in this demo.</p>
        ) : (
          <p className="plg-text" data-testid="create-blocked">{create.reason}</p>
        )}
        {counts.archived > 0 ? <p className="plg-note" data-testid="limit-note">{LIMIT_COUNTS_ARCHIVED}</p> : null}
        <GlassButton variant="primary" onClick={() => { void add(); }} loading={busy} loadingLabel="Building your product…" disabled={!create.canCreate || busy}
          icon={<GlassIcon name="spark" size={22} tone="deep" />}>Add a product</GlassButton>
        <p className="plg-note">New products are reviewed and approved in guided set-up.</p>
        <GlassButton variant="secondary" href="/start/products">Review and approve in guided set-up</GlassButton>
      </GlassCard>

      <GlassCard heading="h2" title="Bundles" badges={<GlassBadge>Coming soon</GlassBadge>} data-testid="bundles">
        <p className="plg-text">{BUNDLES_NOTE}</p>
      </GlassCard>
    </AppLayout>
  );
}
