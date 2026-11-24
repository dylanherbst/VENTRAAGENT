'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AppIntro, GlassBadge, GlassButton, GlassCard, GlassField, GlassGrid, GlassIcon, GlassKeyValue, GlassNotice, GlassState,
} from '../../../design-system/aimp-glass';
import type { OpportunityIdea } from '../../../../lib/aimp/opportunities/types';
import { aud, buildPreview, ideaIdOf } from '../../../../lib/aimp/selection/preview';
import type { SelectionIssue, SelectionPreview } from '../../../../lib/aimp/selection/preview';
import { editSelection, loadSelection, selectIdea } from '../../../../lib/aimp/selection/select';
import type { SelectDeps, SelectionRecord } from '../../../../lib/aimp/selection/select';
import { findIdeasAction } from '../../actions';
import { startRoutes } from '../../flow';
import { IDEAS_CACHE_KEY, centsToInput, inputToCents, journeyRoute, looksLikeIdea } from '../../journey';
import { JourneyShell, WORKSPACE, readJourney, readProfile, selectionDeps, writeJourney } from '../../journey-client';

type Form = { niche: string; audience: string; price: string; hours: string; budget: string };
const toForm = (i: SelectionPreview['inputs']): Form => ({
  niche: String(i.niche), audience: String(i.audience), price: centsToInput(Number(i.pricePointMinor)), hours: String(i.weeklyHours), budget: centsToInput(Number(i.budgetMinor)),
});
const toInputs = (f: Form) => ({ niche: f.niche, audience: f.audience, pricePointMinor: inputToCents(f.price), weeklyHours: Number(f.hours), budgetMinor: inputToCents(f.budget) });
const fieldOf: Record<string, keyof Form> = { niche: 'niche', audience: 'audience', pricePointMinor: 'price', weeklyHours: 'hours', budgetMinor: 'budget' };

/** The idea, from this browser's last finder results, the saved choice, or a fresh finder run on the saved answers. */
async function findIdea(ideaId: string): Promise<OpportunityIdea | null> {
  const match = (list: unknown): OpportunityIdea | null => (Array.isArray(list) ? list.filter(looksLikeIdea).find((i) => ideaIdOf(i) === ideaId) ?? null : null);
  try { const cached = match(JSON.parse(window.sessionStorage.getItem(IDEAS_CACHE_KEY) ?? '[]')); if (cached) return cached; } catch { /* fall through */ }
  const journey = readJourney();
  if (journey && journey.ideaId === ideaId) return journey.idea;
  const profile = readProfile(window.location.search);
  if (profile.source === 'none') return null;
  const r = await findIdeasAction(profile.profile);
  return r.ok ? match(r.result.ideas) : null;
}

export function IdeaPreview({ ideaId }: { ideaId: string }) {
  const [idea, setIdea] = useState<OpportunityIdea | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [selection, setSelection] = useState<SelectionRecord | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [errors, setErrors] = useState<SelectionIssue[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<'' | 'select' | 'save'>('');
  const [isCurrent, setIsCurrent] = useState(false);
  const busyRef = useRef(false);
  const depsRef = useRef<SelectDeps | null>(null);
  const deps = () => (depsRef.current ??= selectionDeps());

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const found = await findIdea(ideaId);
        if (!live) return;
        setIdea(found);
        if (!found) return;
        const saved = await loadSelection(WORKSPACE, found, deps());
        if (!live) return;
        if (saved) { setSelection(saved.selection); setForm(toForm(saved.preview.inputs)); setIsCurrent(readJourney()?.ideaId === ideaId); return; }
        // Start from the customer's own budget and hours (their goal answers) rather than the idea's minimums; if those
        // do not fit the blueprint's limits, fall back to the lib defaults the test page uses.
        const profile = readProfile(window.location.search);
        const own = profile.source === 'none' ? null : buildPreview(found, { budgetMinor: profile.profile.budgetMinor, weeklyHours: profile.profile.weeklyHours });
        const p = own?.ok ? own : buildPreview(found);
        setForm(p.ok ? toForm(p.preview.inputs) : null);
      } catch { if (live) setFailed(true); }
    })();
    return () => { live = false; };
  }, [ideaId]);

  const built = useMemo(() => (idea && form ? buildPreview(idea, toInputs(form)) : null), [idea, form]);
  const lastGood = useRef<SelectionPreview | null>(null);
  if (built?.ok) lastGood.current = built.preview;
  const preview = built?.ok ? built.preview : lastGood.current;
  const liveIssues = built && !built.ok ? built.errors : [];
  const shown = errors.length ? errors : liveIssues;
  const errorFor = (k: keyof Form) => shown.find((e) => fieldOf[e.field] === k)?.message;
  const otherErrors = shown.filter((e) => !fieldOf[e.field]);
  const set = (k: keyof Form) => (e: { target: { value: string } }) => { setErrors([]); setMessage(''); setForm((f) => (f ? { ...f, [k]: e.target.value } : f)); };

  async function guard(kind: 'select' | 'save', fn: () => Promise<void>) {
    if (busyRef.current) return; // double-click guard; the store is also idempotent
    busyRef.current = true; setBusy(kind);
    try { await fn(); } finally { busyRef.current = false; setBusy(''); }
  }
  const remember = (record: SelectionRecord) => {
    if (!idea) return;
    setIsCurrent(writeJourney({ ideaId, businessId: record.business.id, idea, savedAt: new Date().toISOString() }));
  };
  const onSelect = () => guard('select', async () => {
    if (!idea) return;
    const r = await selectIdea(WORKSPACE, idea, form ? toInputs(form) : undefined, deps());
    if (!r.ok) { setErrors(r.errors); return; }
    setErrors([]); setSelection(r.selection); setForm(toForm(r.selection.inputs)); remember(r.selection);
    setMessage(r.created ? 'Chosen. One business and one build job were created.' : 'You had already chosen this idea. Showing the existing business; nothing new was created.');
  });
  const onSave = () => guard('save', async () => {
    if (!idea || !form) return;
    const r = await editSelection(WORKSPACE, idea, toInputs(form), deps());
    if (!r.ok) { setErrors(r.errors); return; }
    setErrors([]); setSelection(r.selection); setForm(toForm(r.selection.inputs));
    setMessage(`Changes saved on the same business (revision ${r.selection.revision}).`);
  });

  const back = { backHref: startRoutes.ideas, backLabel: 'Back to your ideas' };
  if (failed) return <JourneyShell step="choose" {...back}><GlassState kind="error" title="We could not load this idea" action={<GlassButton block={false} href={startRoutes.ideas}>Back to your ideas</GlassButton>}><p>The server did not answer. Nothing was changed.</p></GlassState></JourneyShell>;
  if (idea === undefined) return <JourneyShell step="choose" {...back}><GlassState kind="loading" title="Building the preview…" /></JourneyShell>;
  if (idea === null) {
    return (
      <JourneyShell step="choose" {...back}>
        <GlassState kind="empty" title="That idea is not in your list" data-testid="no-idea" action={<GlassButton variant="primary" block={false} href={startRoutes.ideas}>See my business ideas</GlassButton>}>
          <p>Ideas are scored for your answers in this browser, so a link from another device or an older list may not match.</p>
        </GlassState>
      </JourneyShell>
    );
  }

  const chosen = Boolean(selection) && isCurrent;
  const footer = (
    <>
      {chosen ? <GlassButton variant="primary" href={journeyRoute('brand')} icon={<GlassIcon name="spark" size={22} tone="deep" />}>Continue to your brand</GlassButton>
        : <GlassButton variant="primary" onClick={onSelect} loading={busy === 'select'} loadingLabel="Saving your choice…" disabled={!form || busy === 'save'} icon={<GlassIcon name="spark" size={22} tone="deep" />}>{selection ? 'Set up this business' : 'Choose this business'}</GlassButton>}
      {selection ? <GlassButton variant="secondary" onClick={onSave} loading={busy === 'save'} loadingLabel="Saving…" disabled={busy === 'select'}>Save my changes</GlassButton> : null}
      <GlassButton variant="secondary" href={startRoutes.ideas}>Back to all ideas</GlassButton>
      <p className="plg-note">Choosing is free and changes nothing outside this browser. Nothing is published or charged.</p>
    </>
  );

  return (
    <JourneyShell step="choose" {...back} footer={footer}>
      <AppIntro eyebrow={`Idea ${idea.rank} of 5 · fit score ${idea.fitScore} out of 100`} title={idea.niche}>
        <p>{idea.whatToSell}, for {idea.whoToSellTo.charAt(0).toLowerCase() + idea.whoToSellTo.slice(1)}.</p>
      </AppIntro>
      <p data-testid="connection-state"><GlassBadge dot>Saved in this browser only · database not connected</GlassBadge></p>
      {preview ? <GlassNotice tone="info" title="This is a sample preview" live="none"><p>{preview.label}. The ideas are demo data from the Opportunity Finder, not market research.</p></GlassNotice> : null}

      {message ? <GlassNotice tone="success" title={message} data-testid="message" /> : null}
      {otherErrors.length > 0 ? <GlassNotice tone="error" title="Please fix this first" data-testid="errors"><ul className="plg-list">{otherErrors.map((e) => <li key={e.field + e.message}>{e.message}</li>)}</ul></GlassNotice> : null}

      {selection ? (
        <GlassCard heading="h2" highlighted={chosen} title={chosen ? 'This is the business you are setting up' : 'You chose this idea earlier'} data-testid="result"
          badges={<GlassBadge tone="success">Chosen</GlassBadge>}>
          <p className="plg-text">{chosen ? 'The next steps build its brand, products, listings and store from the details on this page.' : 'Another idea is the one you are setting up now. Press “Set up this business” to switch to this one.'}</p>
          <GlassKeyValue layout="stack" items={[
            { label: 'Business record', value: <span className="plg-mono" data-testid="business-id">{selection.business.id}</span> },
            { label: 'Build job', value: <><span className="plg-mono" data-testid="job-id">{selection.job.id}</span> (queued; nothing runs it yet)</> },
            { label: 'Saved changes', value: <>Revision <span data-testid="revision">{selection.revision}</span></> },
          ]} />
        </GlassCard>
      ) : null}

      {preview ? (
        <GlassGrid min={340}>
          <GlassCard heading="h2" eyebrow="Sample product" title={preview.sampleProduct.title} data-testid="preview">
            <p className="plg-text" data-testid="product-title">{preview.sampleProduct.summary}</p>
            <GlassKeyValue items={[
              { label: 'Pages', value: String(preview.sampleProduct.totalPages) },
              { label: 'Format', value: preview.sampleProduct.formats.join(' + ') },
              { label: 'Made for', value: preview.sampleProduct.audience },
            ]} />
            <ul className="plg-list">{preview.sampleProduct.sections.map((s) => <li key={s.title}>{s.title}: {s.pages} {s.pages === 1 ? 'page' : 'pages'}</li>)}</ul>
          </GlassCard>

          <GlassCard heading="h2" eyebrow="Startup costs" title={`About ${aud(preview.costs.totalMinor)} to set up`}
            badges={<GlassBadge tone={preview.costs.withinBudget ? 'success' : 'warn'}>{preview.costs.withinBudget ? 'Within your budget' : `${aud(preview.costs.shortfallMinor)} over budget`}</GlassBadge>}>
            <GlassKeyValue items={preview.costs.lines.map((l) => ({ key: l.label, label: <>{l.label}<br /><span className="plg-note">{l.note}</span></>, value: aud(l.amountMinor) }))} />
            <p className="plg-text" data-testid="cost-total"><strong>Total about {aud(preview.costs.totalMinor)}</strong> of your {aud(preview.costs.budgetMinor)} budget{preview.costs.withinBudget ? '.' : `; ${aud(preview.costs.shortfallMinor)} short.`}</p>
          </GlassCard>

          <GlassCard heading="h2" eyebrow="Price assumptions" title={`${aud(preview.priceAssumptions.priceMinor)} incl. GST`}>
            <p className="plg-note" data-testid="price-label">{preview.priceAssumptions.label}</p>
            <GlassKeyValue items={[
              { label: 'Card fee per sale', value: `about ${aud(preview.priceAssumptions.cardFeeMinor)}` },
              { label: 'Left per sale', value: aud(preview.priceAssumptions.afterCardFeeMinor) },
              { label: 'Left if GST-registered', value: aud(preview.priceAssumptions.afterCardFeeAndGstMinor) },
              { label: 'Sales to cover setup', value: preview.priceAssumptions.salesToCoverCost === null ? 'Not possible at this price' : `about ${preview.priceAssumptions.salesToCoverCost}` },
            ]} />
            <ul className="plg-list">{preview.priceAssumptions.notes.map((n) => <li key={n}>{n}</li>)}</ul>
          </GlassCard>

          <GlassCard heading="h2" eyebrow="Brand" title={preview.brand.name} badges={<GlassBadge>Placeholder</GlassBadge>}>
            <p className="plg-text" data-testid="brand">{preview.brand.note}</p>
          </GlassCard>

          <GlassCard heading="h2" eyebrow="Storefront" title="What your store would show" badges={<GlassBadge>Sketch</GlassBadge>}>
            <ul className="plg-list" data-testid="storefront">{preview.storefront.blocks.map((b) => <li key={b.block}><strong>{b.block}:</strong> {b.shows}</li>)}</ul>
            <p className="plg-note">{preview.storefront.note}</p>
          </GlassCard>

          <GlassCard heading="h2" eyebrow="Your part" title={`About ${preview.schedule.totalHours} hours over ${preview.schedule.weeksToLaunch} ${preview.schedule.weeksToLaunch === 1 ? 'week' : 'weeks'}`}>
            <ol className="plg-list" data-kind="steps" data-testid="owner-actions">{preview.ownerActions.map((a) => <li key={a.order}><strong>{a.title}:</strong> {a.ownerAction} (about {a.hours} h, week {a.finishesInWeek})</li>)}</ol>
          </GlassCard>
        </GlassGrid>
      ) : null}

      {form ? (
        <GlassCard heading="h2" eyebrow="Make it yours" title="Adjust the details">
          <p className="plg-text">The preview above updates as you type. {selection ? 'Press “Save my changes” to keep them.' : 'They are saved when you choose this business.'}</p>
          <form className="plg-grid" style={{ ['--plg-grid-min' as string]: '260px' }} onSubmit={(e) => { e.preventDefault(); if (selection) void onSave(); else void onSelect(); }} aria-label="Adjust the details" noValidate>
            <GlassField label="Niche" name="niche" value={form.niche} onChange={set('niche')} autoComplete="off" error={errorFor('niche')} />
            <GlassField label="Who it is for" name="audience" value={form.audience} onChange={set('audience')} autoComplete="off" error={errorFor('audience')} />
            <GlassField label="Price (AUD incl. GST)" name="price" inputMode="decimal" value={form.price} onChange={set('price')} autoComplete="off" icon={<GlassIcon name="dollar" />} error={errorFor('price')} />
            <GlassField label="Hours a week" name="hours" inputMode="numeric" value={form.hours} onChange={set('hours')} autoComplete="off" icon={<GlassIcon name="clock" />} error={errorFor('hours')} />
            <GlassField label="Launch budget (AUD)" name="budget" inputMode="decimal" value={form.budget} onChange={set('budget')} autoComplete="off" icon={<GlassIcon name="dollar" />} error={errorFor('budget')} />
            <button type="submit" className="plg-sr" tabIndex={-1} aria-hidden="true">Save</button>
          </form>
        </GlassCard>
      ) : <GlassNotice tone="error" title="This idea cannot be previewed"><p>Its blueprint is not available. Go back and pick another idea.</p></GlassNotice>}
    </JourneyShell>
  );
}
