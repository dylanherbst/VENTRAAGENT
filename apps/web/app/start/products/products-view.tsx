'use client';
import { useEffect, useRef, useState } from 'react';
import {
  AppIntro, GlassBadge, GlassButton, GlassCard, GlassDisclosure, GlassGrid, GlassIcon, GlassKeyValue, GlassNotice, GlassState,
} from '../../design-system/aimp-glass';
import type { GlassBadgeTone } from '../../design-system/aimp-glass';
import { loadSelection } from '../../../lib/aimp/selection/select';
import type { SelectionRecord } from '../../../lib/aimp/selection/select';
import { productsAction } from '../actions';
import { formatWhen, ideaHref, journeyRoute, statusText } from '../journey';
import { JourneyShell, LoadingState, NeedBusiness, WORKSPACE, selectionDeps, useJourney } from '../journey-client';
import type { ProductView, ProductsOp, ProductsState, VersionView } from '../journey-types';

const tone: Record<VersionView['status'], GlassBadgeTone> = { draft: 'neutral', in_review: 'warn', qa_failed: 'danger', approved: 'success', superseded: 'neutral' };
const kb = (bytes: number | null) => (bytes ? `${Math.max(1, Math.round(bytes / 1024))} KB` : 'no file');

function Checks({ v }: { v: VersionView }) {
  return (
    <ul className="start-checks">
      {v.qa.map((q) => (
        <li key={q.id} data-testid="qa" data-passed={q.passed}>
          <span>{q.label}{q.reasons.length > 0 ? <><br /><span className="plg-note">{q.reasons.join(' ')}</span></> : null}</span>
          <GlassBadge tone={q.passed ? 'success' : 'danger'}>{q.passed ? 'Passed' : 'Failed'}</GlassBadge>
        </li>
      ))}
    </ul>
  );
}

export function ProductsView() {
  const { ready, journey } = useJourney();
  const [selection, setSelection] = useState<SelectionRecord | null | undefined>(undefined);
  const [state, setState] = useState<ProductsState | null>(null);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string; errors: string[] } | null>(null);
  const [busy, setBusy] = useState('');
  const busyRef = useRef(false);
  const businessId = journey?.businessId ?? '';

  useEffect(() => {
    if (!journey) return;
    let live = true;
    (async () => {
      try {
        const saved = await loadSelection(WORKSPACE, journey.idea, selectionDeps());
        const r = await productsAction(journey.businessId, { kind: 'load' });
        if (!live) return;
        setSelection(saved?.selection ?? null); setState(r.state);
        if (!r.ok) setNotice({ ok: false, text: r.message, errors: r.errors });
      } catch { if (live) setFailed(true); }
    })();
    return () => { live = false; };
  }, [journey]);

  async function run(key: string, op: ProductsOp) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(key); setNotice(null);
    try {
      const r = await productsAction(businessId, op);
      setState(r.state); setNotice({ ok: r.ok, text: r.message, errors: r.errors });
    } catch { setNotice({ ok: false, text: 'We could not reach the server, so nothing was changed. Try again.', errors: [] }); }
    finally { busyRef.current = false; setBusy(''); }
  }

  const shell = { step: 'products' as const, backHref: journeyRoute('brand'), backLabel: 'Back to your brand' };
  if (!ready) return <JourneyShell {...shell}><LoadingState title="Loading your products…" /></JourneyShell>;
  if (!journey) return <JourneyShell {...shell}><NeedBusiness /></JourneyShell>;
  if (failed) return <JourneyShell {...shell}><GlassState kind="error" title="We could not load your products" action={<GlassButton block={false} onClick={() => window.location.reload()}>Try again</GlassButton>}><p>The server did not answer. Nothing was changed.</p></GlassState></JourneyShell>;
  if (!state || selection === undefined) return <JourneyShell {...shell}><LoadingState title="Loading your products…" /></JourneyShell>;

  const mode = state.connection.status === 'live' ? 'LIVE' : 'DEMO';
  const anyApproved = state.products.some((p) => p.approvedVersion !== null);
  const canBuild = state.available && selection !== null && state.products.length < state.maxProducts;
  const build = () => selection && run('create', { kind: 'create', blueprintId: selection.business.blueprintId, inputs: selection.inputs });
  const fileHref = (q: string) => `/start/products/file?b=${encodeURIComponent(businessId)}&${q}`;

  const card = (p: ProductView, first: boolean) => {
    const latest = p.versions[0];
    const older = p.versions.slice(1);
    return (
      <GlassCard key={p.id} heading="h2" data-testid="product" highlighted={first && latest.status === 'in_review'}
        eyebrow={`Version ${latest.version} · built ${formatWhen(latest.createdAt)}`} title={latest.title}
        badges={<><span data-testid="version-status"><GlassBadge tone={tone[latest.status]}>{statusText(latest.status)}</GlassBadge></span>{latest.mode === 'demo' ? <GlassBadge tone="demo">DEMO wording</GlassBadge> : null}</>}
        footer={<>
          {latest.status === 'in_review' ? <GlassButton variant="primary" onClick={() => run(`approve-${latest.id}`, { kind: 'approve', versionId: latest.id })} loading={busy === `approve-${latest.id}`} loadingLabel="Approving…" disabled={busy !== '' && busy !== `approve-${latest.id}`}>Approve this version</GlassButton> : null}
          <GlassButton variant="secondary" onClick={() => run(`regen-${p.id}`, { kind: 'regenerate', productId: p.id })} loading={busy === `regen-${p.id}`} loadingLabel="Building a new version…" disabled={(busy !== '' && busy !== `regen-${p.id}`) || p.regenerationsLeft === 0}>Build a new version</GlassButton>
        </>}>
        <p className="plg-text" data-testid="product-state">
          {p.approvedVersion !== null ? <><strong>Buyers would receive version {p.approvedVersion}.</strong> That exact file is locked to its approval.</> : <><strong>Not approved yet.</strong> Buyers cannot receive any file until you approve a version.</>}
        </p>
        {latest.mode === 'demo' ? <p className="plg-note" data-testid="demo-note">DEMO sample: the wording is placeholder content, not written by a live AI model. The layout, page count and checks are real.</p> : <p className="plg-note">{latest.note}</p>}
        <GlassKeyValue items={[
          { label: 'Pages per PDF', value: latest.pageCount === null ? 'Could not be built' : String(latest.pageCount) },
          { label: 'Paper sizes', value: 'A4 and US Letter' },
          { label: 'File', value: `ZIP, ${kb(latest.fileBytes)}` },
        ]} />
        {latest.fileHash ? <p><a className="plg-link" data-target="large" data-testid="sample" href={fileHref(`version=${encodeURIComponent(latest.id)}&sample=1`)} target="_blank" rel="noreferrer">Open the free sample (PDF, a few pages)</a></p> : null}
        {latest.fileHash ? <p><a className="plg-link" data-target="large" data-testid="preview" href={fileHref(`version=${encodeURIComponent(latest.id)}`)}>Download this exact file to check it (ZIP)</a></p> : null}
        <div className="plg-stack" data-gap="2">
          <p className="plg-eyebrow">Automatic checks</p>
          <Checks v={latest} />
          {latest.status === 'qa_failed' ? <p className="plg-note">It cannot be approved until every check passes. Build a new version to try again.</p> : null}
        </div>
        <GlassDisclosure summary="What is inside and what the listing will claim">
          <p className="plg-eyebrow">Sections</p>
          <ul className="plg-list">{latest.sections.map((s) => <li key={s.title}>{s.title}: {s.pages} {s.pages === 1 ? 'page' : 'pages'}</li>)}</ul>
          <p className="plg-eyebrow">Listing claims (each one is backed by real pages)</p>
          <ul className="plg-list">{latest.claims.map((c) => <li key={c} data-testid="claim">{c}</li>)}</ul>
        </GlassDisclosure>
        {older.length > 0 ? (
          <GlassDisclosure summary={`Earlier versions (${older.length})`}>
            <GlassKeyValue items={older.map((v) => ({
              key: v.id,
              label: <>Version {v.version} · {v.pageCount ?? 0} pages{v.fileHash ? <> · <a className="plg-link" href={fileHref(`version=${encodeURIComponent(v.id)}`)}>ZIP</a></> : null}</>,
              value: <GlassBadge tone={tone[v.status]}>{statusText(v.status)}</GlassBadge>,
            }))} />
          </GlassDisclosure>
        ) : null}
        {p.approvedVersion !== null ? <p><a className="plg-link" data-target="large" data-testid="buyer-download" href={fileHref(`product=${encodeURIComponent(p.id)}`)}>Download what buyers would receive (version {p.approvedVersion})</a></p> : null}
        <p className="plg-note">{p.regenerationsLeft === 0 ? 'This product has used all its rebuilds.' : `${p.regenerationsLeft} ${p.regenerationsLeft === 1 ? 'rebuild' : 'rebuilds'} left for this product.`}</p>
      </GlassCard>
    );
  };

  const footer = (
    <>
      {anyApproved ? <GlassButton variant="primary" href={journeyRoute('catalogue')} icon={<GlassIcon name="spark" size={22} tone="deep" />}>Continue to listings and pricing</GlassButton> : null}
      {state.products.length > 0 && canBuild ? <GlassButton variant="secondary" onClick={() => { void build(); }} loading={busy === 'create'} loadingLabel="Building your product…" disabled={busy !== '' && busy !== 'create'}>Build another product</GlassButton> : null}
      <GlassButton variant="secondary" href={journeyRoute('brand')}>Back to your brand</GlassButton>
      {!anyApproved && state.products.length > 0 ? <p className="plg-note">Approve a version to continue. Listings can only sell an approved product.</p> : null}
    </>
  );

  return (
    <JourneyShell {...shell} mode={mode} footer={footer}>
      <AppIntro eyebrow={journey.idea.niche} title="Build and check your first product">
        <p>We build the printable from your idea, run automatic checks on the real file, and you approve the exact version buyers would get.</p>
      </AppIntro>
      <p className="plg-badges" data-testid="connection-state">
        <GlassBadge tone={state.connection.status === 'live' ? 'live' : 'neutral'} dot>AI: {statusText(state.connection.status)}</GlassBadge>
        <GlassBadge dot>Demo storage on the server · resets when it restarts</GlassBadge>
      </p>
      {!state.available ? <GlassNotice tone="warn" title="This step is not switched on here"><p>{state.reason}</p></GlassNotice> : null}
      {selection === null ? <GlassNotice tone="warn" title="Your chosen idea could not be read" action={<a className="plg-link" data-target="large" href={ideaHref(journey.ideaId)}>Open your idea</a>}><p>Open the idea and choose it again, then come back.</p></GlassNotice> : null}
      {notice?.text ? <GlassNotice tone={notice.ok ? 'success' : 'error'} title={notice.text} data-testid="message">{notice.errors.length ? <ul className="plg-list">{notice.errors.map((e) => <li key={e}>{e}</li>)}</ul> : null}</GlassNotice> : null}

      {state.products.length === 0 && state.available ? (
        busy === 'create' ? <GlassState kind="loading" title="Building your product and running the checks…"><p>This renders the real PDF pages, so it can take a few seconds.</p></GlassState> : (
          <GlassState kind="empty" title="No products yet" data-testid="empty"
            action={<GlassButton variant="primary" block={false} onClick={() => { void build(); }} disabled={!canBuild} icon={<GlassIcon name="spark" size={22} tone="deep" />}>Build my first product</GlassButton>}>
            <p>{selection ? <>It will be built for “{String(selection.inputs.niche)}”, for {String(selection.inputs.audience).toLowerCase()}. {state.connection.reason}</> : 'Choose your idea again to build from it.'}</p>
          </GlassState>
        )
      ) : null}
      {state.products.length > 0 ? <GlassGrid min={380}>{state.products.map((p, i) => card(p, i === 0))}</GlassGrid> : null}
    </JourneyShell>
  );
}
