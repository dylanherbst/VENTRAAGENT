'use client';
import { useEffect, useRef, useState } from 'react';
import { blankWebsitePage, moveWebsitePageSection, removeWebsitePageSection, persistWebsitePage, projectWebsitePage, restoreWebsitePage, websitePageLimits as limits, websitePageStorageKey } from '../../lib/local-website-page';
import { createWebsitePageStarter, websitePageStarters } from '../../lib/local-website-page-templates';
import type { WebsitePageStarterId } from '../../lib/local-website-page-templates';
import type { WebsitePageDraft, WebsitePageInput } from '../../lib/local-website-page';
import { LauncherAccountSync } from './launcher-account-sync';

export default function WebsitePageDraftEditor({ profileId }: { profileId: string }) {
  const [starter, setStarter] = useState<WebsitePageStarterId>('blank');
  const [saved, setSaved] = useState<WebsitePageDraft | null>(null);
  const [input, setInput] = useState<WebsitePageInput | null>(null);
  const [preview, setPreview] = useState<WebsitePageInput | null>(null);
  const [previewKind, setPreviewKind] = useState('Saved');
  const [ready, setReady] = useState(false);
  const [writable, setWritable] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [confirmReload, setConfirmReload] = useState(false);
  const raw = useRef<string | null>(null);
  const editorHeading = useRef<HTMLHeadingElement>(null);
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const launchButton = useRef<HTMLButtonElement>(null);
  const previewButton = useRef<HTMLButtonElement>(null);
  const savedPreviewButton = useRef<HTMLButtonElement>(null);
  const errorNode = useRef<HTMLParagraphElement>(null);
  const sectionHeadings = useRef<Array<HTMLInputElement | null>>([]);
  const sectionActionNumber = useRef(0);
  const pendingSectionFocus = useRef<number | null>(null);
  const returnToLaunch = useRef(false);
  const returnFromPreview = useRef(false);

  function load() {
    try {
      const nextRaw = window.localStorage.getItem(websitePageStorageKey(profileId));
      const next = restoreWebsitePage(nextRaw, profileId);
      raw.current = nextRaw; setSaved(next); setWritable(true); setError('');
      setStatus(next ? 'Saved website page restored from this browser.' : 'No saved website page yet.');
    } catch {
      setSaved(null); setWritable(false); setStatus('');
      setError('Saved website page could not be read. Nothing was overwritten. Repair browser storage outside this editor, then reload.');
    }
    setReady(true);
  }
  useEffect(() => { load(); }, [profileId]);
  useEffect(() => { if (input) editorHeading.current?.focus(); else if (returnToLaunch.current) { returnToLaunch.current = false; launchButton.current?.focus(); } }, [!!input]);
  useEffect(() => {
    if (preview) previewHeading.current?.focus();
    else if (returnFromPreview.current) { returnFromPreview.current = false; (input ? previewButton : savedPreviewButton).current?.focus(); }
  }, [preview]);
  useEffect(() => { if (error) errorNode.current?.focus(); }, [error]);
  useEffect(() => {
    if (pendingSectionFocus.current !== null) {
      sectionHeadings.current[pendingSectionFocus.current]?.focus();
      pendingSectionFocus.current = null;
    }
  }, [input]);
  const dirty = input !== null && JSON.stringify(input) !== JSON.stringify(saved ? projectWebsitePage(saved) : blankWebsitePage());
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  function patch(patch: Partial<WebsitePageInput>) { setInput(current => current ? { ...current, ...patch } : current); setError(''); setConfirmReload(false); }
  function moveSection(index: number, direction: -1 | 1) {
    if (!input || index + direction < 0 || index + direction >= input.sections.length) return;
    pendingSectionFocus.current = index + direction;
    patch(moveWebsitePageSection(input, index, direction));
    setStatus(`Text section ${index + 1} moved to position ${index + direction + 1}. Unsaved changes. Action ${++sectionActionNumber.current}.`);
  }
  function removeSection(index: number) {
    if (!input || input.sections.length <= 1) return;
    pendingSectionFocus.current = Math.min(index, input.sections.length - 2);
    const clearsButton = input.ctaTarget === `section-${index + 1}`;
    patch(removeWebsitePageSection(input, index));
    setStatus(`Text section ${index + 1} removed.${clearsButton ? ' Page button cleared because its destination was removed.' : ''} Unsaved changes. Action ${++sectionActionNumber.current}.`);
  }
  function closeEditor(message: string) { setPreview(null); setInput(null); setError(''); setConfirmReload(false); setStatus(message); returnToLaunch.current = true; }
  function showPreview(value: unknown, kind: string) {
    try { setPreview(projectWebsitePage(value)); setPreviewKind(kind); setError(''); setConfirmReload(false); }
    catch (issue) { setError((issue as Error).message); }
  }
  function reload() { closeEditor(''); load(); }
  return <section className="website-page-draft" aria-labelledby="website-page-title">
    <div className="section-heading"><h3 id="website-page-title">Website page</h3><span className="status-badge">Unpublished · browser only</span></div>
    <p>Shape one original page with text sections and an optional button to a section on the same page. No public address or hosting is created.</p>
    {status && <p role="status">{status}</p>}
    {error && <p ref={errorNode} tabIndex={-1} className="error" role="alert">{error}</p>}
    {!ready ? <p role="status">Loading website page…</p> : <>
      {!input && !saved && !preview && writable && <fieldset><legend>Choose a starting point</legend><label>New page starter<select value={starter} onChange={event => setStarter(event.target.value as WebsitePageStarterId)}>{websitePageStarters.map(choice => <option key={choice.id} value={choice.id}>{choice.label}</option>)}</select></label><p>{websitePageStarters.find(choice => choice.id === starter)?.description}</p><p>Original text prompts, ready to edit. Applied only when you create a new page; nothing is saved automatically.</p></fieldset>}
      {!input && <div className="setup-actions"><button ref={launchButton} disabled={!writable || !!preview} onClick={() => { setInput(saved ? projectWebsitePage(saved) : createWebsitePageStarter(starter)); setStatus(''); setError(''); }}>{saved ? 'Edit website page' : 'Create website page'}</button>{saved && <button ref={savedPreviewButton} disabled={!!preview} onClick={() => showPreview(saved, 'Saved')}>Preview saved website page</button>}</div>}
      <button type="button" disabled={!!preview} onClick={() => { if (input) setConfirmReload(true); else reload(); }}>Reload saved website page</button>
      {confirmReload && <div className="notice" role="group" aria-label="Reload website page confirmation"><p>Reload will discard the open editor, including unsaved changes. The saved page is not changed.</p><div className="setup-actions"><button onClick={reload}>Discard edits and reload page</button><button onClick={() => { setConfirmReload(false); editorHeading.current?.focus(); }}>Keep editing website page</button></div></div>}
      {input && <form hidden={!!preview} onSubmit={event => {
        event.preventDefault();
        try {
          const result = persistWebsitePage(window.localStorage, profileId, raw.current, input);
          raw.current = result.raw; setSaved(result.draft); closeEditor('Website page saved in this browser. Still unpublished.');
        } catch (issue) { setError(`Save failed. Your edits are kept. ${(issue as Error).message}`); }
      }}>
        <h4 ref={editorHeading} tabIndex={-1}>{saved ? 'Edit website page draft' : 'New website page draft'}</h4>
        <p>{dirty ? 'Unsaved changes' : 'No changes yet'} · Title, introduction and section text are required. Nothing saves automatically.</p>
        <label>Page title<input required maxLength={limits.title} value={input.title} onChange={e => patch({ title: e.target.value })} /></label>
        <label>Page introduction<textarea required rows={3} maxLength={limits.intro} value={input.intro} onChange={e => patch({ intro: e.target.value })} /></label>
        {input.sections.map((section, index) => <fieldset key={index}><legend>Text section {index + 1}</legend>
          <label>Section {index + 1} heading<input ref={node => { sectionHeadings.current[index] = node; }} required maxLength={limits.heading} value={section.heading} onChange={e => patch({ sections: input.sections.map((row, i) => i === index ? { ...row, heading: e.target.value } : row) })} /></label>
          <label>Section {index + 1} text<textarea required rows={4} maxLength={limits.body} value={section.body} onChange={e => patch({ sections: input.sections.map((row, i) => i === index ? { ...row, body: e.target.value } : row) })} /></label>
          <div className="setup-actions"><button type="button" disabled={index === 0} onClick={() => moveSection(index, -1)}>Move section {index + 1} up</button><button type="button" disabled={index === input.sections.length - 1} onClick={() => moveSection(index, 1)}>Move section {index + 1} down</button>{input.sections.length > 1 && <button type="button" onClick={() => removeSection(index)}>Remove text section {index + 1}</button>}</div>
        </fieldset>)}
        <div className="setup-actions"><button type="button" disabled={input.sections.length >= limits.sections} onClick={() => patch({ sections: [...input.sections, { heading: '', body: '' }] })}>Add text section</button></div>
        <p>Keep one to four sections. Removal is unsaved until you save. Removing a button’s destination clears the button; otherwise it follows the same section.</p>
        <div className="setup-fields"><label>Page button label (optional)<input maxLength={limits.ctaLabel} value={input.ctaLabel} onChange={e => patch({ ctaLabel: e.target.value })} /></label><label>Page button destination<select value={input.ctaTarget} onChange={e => patch({ ctaTarget: e.target.value })}><option value="">No button</option>{input.sections.map((_, index) => <option key={index} value={`section-${index + 1}`}>Section {index + 1}</option>)}</select></label></div>
        <div className="setup-actions"><button type="submit" className="primary-button" disabled={!writable}>Save website page</button><button ref={previewButton} type="button" onClick={() => showPreview(input, 'Unsaved')}>Preview unsaved website page</button><button type="button" onClick={() => closeEditor('Website page changes discarded. Saved page unchanged.')}>Cancel website page changes</button></div>
      </form>}
      {preview && <section className="website-page-owner-preview" aria-label="Website page owner preview">
        <h4 ref={previewHeading} tabIndex={-1}>{previewKind} owner preview · unpublished</h4><p>Only your page text is shown. This is not a public page. The button is a visual preview and does not navigate.</p>
        <article className="website-page-canvas"><p className="eyebrow">YOUR NEXT CHAPTER</p><h2>{preview.title}</h2><p className="prose">{preview.intro}</p>
          {preview.ctaLabel && <div className="website-page-cta"><button type="button" disabled>{preview.ctaLabel}</button><p>Destination: {preview.ctaTarget.replace('section-', 'Section ')}</p></div>}
          {preview.sections.map((section, index) => <section key={index}><span className="subtle-label">{String(index + 1).padStart(2, '0')}</span><h3>{section.heading}</h3><p className="prose">{section.body}</p></section>)}
        </article><button type="button" onClick={() => { returnFromPreview.current = true; setPreview(null); }}>Close website page preview</button>
      </section>}
    </>}
    <p className="panel-note">Local draft only, not an account or private hosted page. Browser data can be read by other users of this browser. No publishing, domain, payments or external links.</p>
    <LauncherAccountSync kind="website-page" label="Website page" readLocal={() => localStorage.getItem(websitePageStorageKey(profileId))} validate={raw => { restoreWebsitePage(raw, profileId); }} onApply={raw => { localStorage.setItem(websitePageStorageKey(profileId), raw); window.location.reload(); }} />
  </section>;
}
