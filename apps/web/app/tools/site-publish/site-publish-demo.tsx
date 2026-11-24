'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { validateStoreConfig } from '../../../lib/aimp/storefront/schema';
import {
  createSiteVersionStore, demoActorA, demoActorB, seedDemoSites,
  type Actor, type DraftPreview, type DraftView, type HistoryView, type PublicResolution, type SiteVersionStore,
} from '../../../lib/aimp/site-versions';

const field = { display: 'block', width: '100%', minHeight: 44, padding: 8, boxSizing: 'border-box' } as const;
const button = { minHeight: 44, minWidth: 44, padding: '8px 16px', marginRight: 8, marginBottom: 8 } as const;
const box = { border: '1px solid #888', padding: 12, marginTop: 16 } as const;

const ACTORS: Record<string, { label: string; actor: Actor }> = {
  a: { label: 'Workspace A (owns slow-morning)', actor: demoActorA },
  b: { label: 'Workspace B (owns iron-and-oak)', actor: demoActorB },
};
const SLUGS = ['slow-morning', 'iron-and-oak'];

// "Stricter rules" simulation: the hero heading must be 20 characters or fewer. Edits made earlier stay valid under
// the normal rules, so publishing fails on the second check while the live version keeps serving.
const STRICT_LIMIT = 20;

export function SitePublishDemo() {
  const storeRef = useRef<SiteVersionStore | null>(null);
  const flags = useRef({ strict: false, failStep: false });
  const [ready, setReady] = useState(false);
  const [who, setWho] = useState('a');
  const [slug, setSlug] = useState(SLUGS[0]);
  const [draft, setDraft] = useState<DraftView | null>(null);
  const [history, setHistory] = useState<HistoryView | null>(null);
  const [pub, setPub] = useState<PublicResolution | null>(null);
  const [preview, setPreview] = useState<DraftPreview | null>(null);
  const [heading, setHeading] = useState('');
  const [brand, setBrand] = useState('');
  const [note, setNote] = useState('');
  const [rollbackTo, setRollbackTo] = useState('1');
  const [strict, setStrict] = useState(false);
  const [failStep, setFailStep] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; lines: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const actor = ACTORS[who].actor;

  const refresh = useCallback(async (a: Actor, s: string) => {
    const store = storeRef.current;
    if (!store) return;
    const [d, h, p] = [await store.getDraft(a, s), await store.history(a, s), await store.resolvePublished(s)];
    setPub(p);
    setDraft(d.ok ? d.value : null);
    setHistory(h.ok ? h.value : null);
    if (d.ok) { setHeading(d.value.config.hero.heading); setBrand(d.value.config.brand.name); }
    else { setHeading(''); setBrand(''); }
    if (h.ok && h.value.liveVersion) setRollbackTo(String(Math.max(1, h.value.liveVersion - 1)));
  }, []);

  useEffect(() => {
    let cancelled = false; // StrictMode runs this effect twice in development: only the last run may seed and show.
    const store = createSiteVersionStore({
      validate: (input) => {
        const base = validateStoreConfig(input);
        if (base.ok && flags.current.strict && base.config.hero.heading.length > STRICT_LIMIT) {
          return { ok: false, errors: [`hero.heading: text 1-${STRICT_LIMIT} chars`] };
        }
        return base;
      },
      beforeCommit: () => { if (flags.current.failStep) throw new Error('Simulated failure'); },
    });
    storeRef.current = store;
    seedDemoSites(store).then(() => { if (cancelled) return undefined; setReady(true); return refresh(demoActorA, SLUGS[0]); });
    return () => { cancelled = true; };
  }, [refresh]);

  async function run(label: string, work: (store: SiteVersionStore) => Promise<{ ok: boolean; errors?: string[]; value?: unknown }>, keepPreview = false) {
    const store = storeRef.current;
    if (!store || busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try {
      const r = await work(store);
      const unchanged = r.ok && (r.value as { unchanged?: boolean } | undefined)?.unchanged === true;
      setMessage(unchanged ? { kind: 'ok', lines: [`${label}: nothing to publish, the draft matches the live version.`] }
        : r.ok ? { kind: 'ok', lines: [`${label}: done.`] } :{ kind: 'error', lines: [`${label}: not done.`, ...(r.errors ?? [])] });
      if (!keepPreview) setPreview(null);
      await refresh(actor, slug);
    } finally { busyRef.current = false; setBusy(false); }
  }

  function select(nextWho: string, nextSlug: string) {
    setWho(nextWho); setSlug(nextSlug); setPreview(null); setMessage(null);
    void refresh(ACTORS[nextWho].actor, nextSlug);
  }
  function toggleStrict(v: boolean) { flags.current.strict = v; setStrict(v); }
  function toggleFail(v: boolean) { flags.current.failStep = v; setFailStep(v); }

  const live = pub?.status === 'live' ? pub : null;

  return <div>
    <section aria-labelledby="who" style={box}>
      <h2 id="who">1. Who is acting, and on which store</h2>
      <label>Signed in as
        <select style={field} value={who} onChange={(e) => select(e.target.value, slug)} data-testid="who">
          {Object.entries(ACTORS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </label>
      <label>Store
        <select style={field} value={slug} onChange={(e) => select(who, e.target.value)} data-testid="slug">
          {SLUGS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      <p>Pick the other workspace&apos;s store to see access denied.</p>
    </section>

    <section aria-labelledby="draft" style={box}>
      <h2 id="draft">2. Draft (private)</h2>
      {!ready ? <p role="status">Loading demo stores…</p> : !draft ? <p role="status" data-testid="no-access">You do not have access to this store.</p> : <>
        <p data-testid="draft-state">Revision {draft.revision} · {draft.hasUnpublishedChanges ? 'has unpublished changes' : 'matches the live version'} · live version: {draft.liveVersion ?? 'none'}{draft.paused ? ' (paused)' : ''}</p>
        <label>Hero heading
          <input style={field} value={heading} onChange={(e) => setHeading(e.target.value)} data-testid="heading" />
        </label>
        <label>Brand name
          <input style={field} value={brand} onChange={(e) => setBrand(e.target.value)} data-testid="brand" />
        </label>
        <p>
          <button style={button} disabled={busy} data-testid="save-draft"
            onClick={() => run('Save draft', (s) => s.editDraft(actor, slug, (d) => { d.hero.heading = heading; d.brand.name = brand; }, { expectedRevision: draft.revision }))}>Save draft</button>
          <button style={button} disabled={busy} data-testid="preview"
            onClick={async () => {
              const r = await storeRef.current?.previewDraft(actor, slug);
              if (r?.ok) { setPreview(r.value); setMessage({ kind: 'ok', lines: ['Preview ready. Nothing was published.'] }); }
              else setMessage({ kind: 'error', lines: ['Preview not available.', ...(r?.ok === false ? r.errors : [])] });
            }}>Preview draft</button>
        </p>
        <p>Try typing &lt;b&gt; in the brand name or leaving the heading empty, then Save draft.</p>
        {preview && <div data-testid="preview-box" style={{ border: '1px dashed #888', padding: 8 }}>
          <strong>Preview (not public, not indexed)</strong>
          <p>Brand: {preview.config.brand.name}</p>
          <p>Heading: {preview.config.hero.heading}</p>
          <p>Accent colour: {preview.render.cssVars['--st-accent']} · robots: {preview.render.robots ? 'noindex' : 'indexable'}</p>
        </div>}
      </>}
    </section>

    <section aria-labelledby="actions" style={box}>
      <h2 id="actions">3. Publish, pause, roll back</h2>
      <label>Note for this version (optional)
        <input style={field} value={note} onChange={(e) => setNote(e.target.value)} data-testid="note" maxLength={200} />
      </label>
      <p>
        <button style={button} disabled={busy || !draft} data-testid="publish"
          onClick={() => run('Publish', (s) => s.publish(actor, slug, { note, expectedRevision: draft?.revision }))}>Publish draft</button>
        <button style={button} disabled={busy || !draft} data-testid="pause"
          onClick={() => run('Pause store', (s) => s.pause(actor, slug))}>Pause store</button>
        <button style={button} disabled={busy || !draft} data-testid="unpause"
          onClick={() => run('Unpause store', (s) => s.unpause(actor, slug))}>Unpause store</button>
      </p>
      <p>
        <label>Go back to version{' '}
          <input style={{ ...field, display: 'inline-block', width: 90 }} type="number" min={1} value={rollbackTo} onChange={(e) => setRollbackTo(e.target.value)} data-testid="rollback-to" />
        </label>
        <button style={{ ...button, marginLeft: 8 }} disabled={busy || !draft} data-testid="rollback"
          onClick={() => run('Roll back', (s) => s.rollback(actor, slug, Number(rollbackTo)))}>Roll back</button>
      </p>
      <fieldset>
        <legend>Make publishing fail on purpose (test only)</legend>
        <label style={{ display: 'block', minHeight: 44 }}>
          <input type="checkbox" checked={strict} onChange={(e) => toggleStrict(e.target.checked)} data-testid="strict" />
          {' '}Pretend the rules just got stricter (hero heading over {STRICT_LIMIT} characters is refused at publish)
        </label>
        <label style={{ display: 'block', minHeight: 44 }}>
          <input type="checkbox" checked={failStep} onChange={(e) => toggleFail(e.target.checked)} data-testid="fail-step" />
          {' '}Make a step fail halfway through publishing
        </label>
      </fieldset>
    </section>

    {message && <div role={message.kind === 'error' ? 'alert' : 'status'} data-testid="message" data-kind={message.kind} style={{ ...box, borderColor: message.kind === 'error' ? '#b00020' : '#2e7d32' }}>
      {message.lines.map((l, i) => <p key={i} style={{ margin: 0 }}>{l}</p>)}
    </div>}

    <section aria-labelledby="public" style={box}>
      <h2 id="public">Public site (what visitors get)</h2>
      <p data-testid="public-status">Status: <strong>{pub?.status ?? '…'}</strong>{live ? ` · version ${live.version}` : ''}</p>
      {live && <p data-testid="public-heading">Heading: {live.config.hero.heading} · Brand: {live.config.brand.name}</p>}
      {pub?.status === 'paused' && <p>Visitors see a &quot;temporarily unavailable&quot; page.</p>}
      {pub?.status === 'none' && <p>Visitors see a &quot;not found&quot; page.</p>}
    </section>

    <section aria-labelledby="history" style={box}>
      <h2 id="history">History</h2>
      {!history ? <p>No access.</p> : <>
        <ol data-testid="versions" style={{ paddingLeft: 24 }}>
          {history.versions.map((v) => <li key={v.version} data-testid={`version-${v.version}`}>
            Version {v.version}{v.version === history.liveVersion ? ' (live)' : ''} · {v.source.kind === 'rollback' ? `restored from version ${v.source.fromVersion}` : 'published'} · {v.publishedAt} · by {v.publishedBy}{v.note ? ` · ${v.note}` : ''}
          </li>)}
        </ol>
        <h3>Activity</h3>
        <ul data-testid="events" style={{ paddingLeft: 24 }}>
          {history.events.map((e, i) => <li key={i}>{e.at} · {e.kind}{e.version ? ` v${e.version}` : ''}</li>)}
        </ul>
      </>}
    </section>
  </div>;
}
