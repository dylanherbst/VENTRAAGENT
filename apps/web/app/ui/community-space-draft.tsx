'use client';
import { useEffect, useRef, useState } from 'react';
import { communityApiNotConnected, describeCommunityApiBoundary } from '../../lib/community-api-contract';
import type { Profile } from '../../lib/onboarding';
import {
  blankCommunitySpaceDraftInput,
  blankCommunityTopicInput,
  communityRulesLimit,
  communitySpaceDescriptionLimit,
  communitySpaceDraftFromInput,
  communitySpaceNameLimit,
  communitySpaceStorageKey,
  communityTopicDescriptionLimit,
  communityTopicNameLimit,
  editCommunitySpaceDraft,
  persistCommunitySpaceDraft,
  projectCommunityForMemberPreview,
  reorderTopicInputs,
  restoreCommunitySpaceDraft,
  saveCommunitySpaceDraft,
} from '../../lib/local-community-space';
import type {
  CommunityMemberSpaceProjection,
  CommunitySpaceDraft,
  CommunitySpaceDraftInput,
} from '../../lib/local-community-space';
import { LauncherAccountSync } from './launcher-account-sync';

type FocusTarget = 'create' | 'edit' | 'saved-preview' | 'unsaved-preview' | 'preview-heading';

export default function CommunitySpaceDraftEditor({ profile }: { profile: Profile }) {
  const profileId = profile.id;
  const apiStub = communityApiNotConnected();
  const [saved, setSaved] = useState<CommunitySpaceDraft | null>(null);
  const [input, setInput] = useState<CommunitySpaceDraftInput | null>(null);
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewProjection, setPreviewProjection] = useState<CommunityMemberSpaceProjection | null>(null);
  const [previewUnsaved, setPreviewUnsaved] = useState(false);
  const [ready, setReady] = useState(false);
  const [writable, setWritable] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const rawRef = useRef<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const createButton = useRef<HTMLButtonElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const previewButton = useRef<HTMLButtonElement>(null);
  const unsavedPreviewButton = useRef<HTMLButtonElement>(null);
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const pendingFocus = useRef<FocusTarget | null>(null);

  function applyRestore(raw: string | null, restored: CommunitySpaceDraft | null) {
    rawRef.current = raw;
    setSaved(restored);
    setPreviewOpen(false);
    setPreviewProjection(null);
    setPreviewUnsaved(false);
    setStorageError('');
    setWritable(true);
    setStatus(restored ? 'Saved community space draft restored.' : 'No saved community space draft yet.');
  }

  function markStorageUnavailable(priorRaw?: string | null) {
    if (priorRaw !== undefined) rawRef.current = priorRaw;
    setSaved(null);
    setPreviewOpen(false);
    setPreviewProjection(null);
    setPreviewUnsaved(false);
    setWritable(false);
    setStatus('');
    setStorageError('Saved community draft could not be restored or browser storage is unavailable. Nothing was overwritten.');
    setError('');
  }

  function load() {
    let raw: string | null | undefined;
    try {
      raw = window.localStorage.getItem(communitySpaceStorageKey(profileId));
      const restored = raw === null ? null : restoreCommunitySpaceDraft(raw, profileId);
      applyRestore(raw, restored);
      setError('');
    } catch (issue) {
      markStorageUnavailable(raw);
      setError(issue instanceof Error ? issue.message : 'Saved community draft could not be restored.');
    }
    setReady(true);
  }

  useEffect(() => {
    let raw: string | null | undefined;
    try {
      raw = window.localStorage.getItem(communitySpaceStorageKey(profileId));
      const restored = raw === null ? null : restoreCommunitySpaceDraft(raw, profileId);
      applyRestore(raw, restored);
    } catch (issue) {
      markStorageUnavailable(raw);
      setError(issue instanceof Error ? issue.message : 'Saved community draft could not be restored.');
    }
    setReady(true);
  }, [profileId]);

  useEffect(() => {
    if (editing) heading.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (!editing || !input) return;
    const baseline = saved ? editCommunitySpaceDraft(saved) : blankCommunitySpaceDraftInput();
    const dirty = JSON.stringify(input) !== JSON.stringify(baseline);
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [editing, input, saved]);

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    if (target === 'preview-heading') {
      if (!previewOpen) return;
      pendingFocus.current = null;
      previewHeading.current?.focus();
      return;
    }
    if (target === 'unsaved-preview') {
      if (!editing || previewOpen) return;
      pendingFocus.current = null;
      unsavedPreviewButton.current?.focus();
      return;
    }
    if (target === 'saved-preview') {
      if (editing || previewOpen) return;
      pendingFocus.current = null;
      previewButton.current?.focus();
      return;
    }
    if (editing || previewOpen) return;
    pendingFocus.current = null;
    const el = target === 'create' ? createButton.current : editButton.current;
    el?.focus();
  }, [editing, previewOpen]);

  function change<K extends keyof CommunitySpaceDraftInput>(key: K, value: CommunitySpaceDraftInput[K]) {
    setInput(current => (current ? { ...current, [key]: value } : current));
    setError('');
  }

  function openEditor(fromSaved?: CommunitySpaceDraft) {
    const base = fromSaved ? editCommunitySpaceDraft(fromSaved) : blankCommunitySpaceDraftInput();
    setInput(base);
    setSpaceId(fromSaved?.id ?? window.crypto.randomUUID());
    setEditing(true);
    setPreviewOpen(false);
    setPreviewProjection(null);
    setError('');
    setStatus(fromSaved ? 'Editing saved community draft. Changes are unsaved until you save.' : 'New community space. Add details and save explicitly.');
  }

  function closeEditor(message: string) {
    pendingFocus.current = saved ? 'edit' : 'create';
    setEditing(false);
    setInput(null);
    setSpaceId(null);
    setPreviewOpen(false);
    setPreviewProjection(null);
    setPreviewUnsaved(false);
    setError('');
    setStatus(message);
  }

  function openMemberPreview(unsaved: boolean) {
    try {
      const identity = { id: spaceId ?? saved!.id, profileId };
      const draft = unsaved ? communitySpaceDraftFromInput(input!, identity) : saved!;
      pendingFocus.current = 'preview-heading';
      setPreviewProjection(projectCommunityForMemberPreview(draft));
      setPreviewUnsaved(unsaved);
      setPreviewOpen(true);
      setError('');
      setStatus(
        unsaved
          ? 'Member preview from unsaved editor — not live, no members, posts or invites.'
          : 'Member preview from saved draft — read-only; not a hosted community.',
      );
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Preview failed.');
    }
  }

  function closeMemberPreview() {
    pendingFocus.current = previewUnsaved ? 'unsaved-preview' : 'saved-preview';
    setPreviewOpen(false);
    setPreviewProjection(null);
    setPreviewUnsaved(false);
  }

  return (
    <section className="community-space" aria-labelledby="community-space-title">
      <div className="section-heading">
        <h2 id="community-space-title">Local community space</h2>
        <span className="status-badge">Browser draft · not live</span>
      </div>
      <p>
        Draft how {profile.name || 'your project'} welcomes members — name, description, rules and optional discussion topics. No posts, messaging, invites, moderation or payments.
      </p>
      <p className="panel-note">
        {describeCommunityApiBoundary()} {apiStub.error}
      </p>
      {status && <p role="status">{status}</p>}
      {storageError && <p role="alert" className="error" id="community-storage-error">{storageError}</p>}
      {error && <p role="alert" className="error" id="community-error">{error}</p>}
      {!ready ? (
        <p role="status">Restoring community draft…</p>
      ) : (
        <>
          <div className="setup-actions">
            {!editing && (
              <>
                <button ref={createButton} type="button" disabled={!writable} onClick={() => openEditor()}>Create community space draft</button>
                {saved && (
                  <button ref={editButton} type="button" disabled={!writable} onClick={() => openEditor(saved)}>Edit community space draft</button>
                )}
              </>
            )}
            {!editing && saved && (
              <button ref={previewButton} type="button" onClick={() => openMemberPreview(false)}>Open member preview</button>
            )}
            <button type="button" disabled={editing} onClick={load}>Reload saved community draft</button>
          </div>
          {saved && !editing && (
            <p>
              Saved: <strong>{saved.name}</strong>
              {saved.topics.length ? ` · ${saved.topics.length} topic(s)` : ' · no topics yet'}
            </p>
          )}
          {editing && input && (
            <form
              className="community-space-editor"
              aria-describedby="community-space-editor-note"
              onSubmit={event => {
                event.preventDefault();
                try {
                  const draft = saveCommunitySpaceDraft(input, { id: spaceId!, profileId });
                  const raw = persistCommunitySpaceDraft(window.localStorage, profileId, rawRef.current, draft);
                  rawRef.current = raw;
                  setSaved(restoreCommunitySpaceDraft(raw, profileId));
                  closeEditor('Community space draft saved in this browser. Not published or hosted.');
                } catch (issue) {
                  setError(issue instanceof Error ? issue.message : 'Save failed. Your unsaved changes remain.');
                }
              }}
            >
              <h3 ref={heading} tabIndex={-1}>{saved ? 'Edit community space' : 'New community space'}</h3>
              <p id="community-space-editor-note">Unsaved until Save. Topics are optional; reorder with the arrow buttons.</p>
              <div className="setup-fields">
                <label>
                  Community name
                  <input required maxLength={communitySpaceNameLimit} value={input.name} onChange={e => change('name', e.target.value)} />
                </label>
              </div>
              <label>
                Community description
                <textarea required maxLength={communitySpaceDescriptionLimit} rows={3} value={input.description} onChange={e => change('description', e.target.value)} />
              </label>
              <label>
                Community rules
                <textarea required maxLength={communityRulesLimit} rows={5} value={input.rules} onChange={e => change('rules', e.target.value)} />
              </label>
              <fieldset>
                <legend>Topics (optional, in order)</legend>
                {input.topics.map((topic, index) => (
                  <div className="community-topic-row" key={topic.id || `new-${index}`}>
                    <p className="subtle-label">Topic {index + 1}</p>
                    <label>
                      Topic name
                      <input
                        maxLength={communityTopicNameLimit}
                        value={topic.name}
                        onChange={e => {
                          const topics = [...input.topics];
                          topics[index] = { ...topic, name: e.target.value };
                          change('topics', topics);
                        }}
                      />
                    </label>
                    <label>
                      Topic description (optional)
                      <textarea
                        maxLength={communityTopicDescriptionLimit}
                        rows={2}
                        value={topic.description}
                        onChange={e => {
                          const topics = [...input.topics];
                          topics[index] = { ...topic, description: e.target.value };
                          change('topics', topics);
                        }}
                      />
                    </label>
                    <span className="community-topic-order">
                      <button type="button" aria-label={`Move topic ${index + 1} up`} disabled={index === 0} onClick={() => change('topics', reorderTopicInputs(input.topics, index, -1))}>↑</button>
                      <button type="button" aria-label={`Move topic ${index + 1} down`} disabled={index === input.topics.length - 1} onClick={() => change('topics', reorderTopicInputs(input.topics, index, 1))}>↓</button>
                      <button type="button" onClick={() => change('topics', input.topics.filter((_, i) => i !== index))}>Remove topic</button>
                    </span>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    const next = blankCommunityTopicInput();
                    next.id = window.crypto.randomUUID();
                    change('topics', [...input.topics, next]);
                  }}
                >
                  Add topic
                </button>
              </fieldset>
              <div className="setup-actions">
                <button className="primary-button" type="submit" disabled={!writable}>Save local community draft</button>
                <button ref={unsavedPreviewButton} type="button" onClick={() => openMemberPreview(true)}>Preview unsaved member view</button>
                <button type="button" onClick={() => closeEditor('Changes discarded. Saved community draft is unchanged.')}>Cancel community changes</button>
              </div>
            </form>
          )}
          {previewOpen && previewProjection && (
            <article className="community-member-preview card" aria-labelledby="community-member-preview-title">
              <div className="section-heading">
                <h3 ref={previewHeading} id="community-member-preview-title" tabIndex={-1}>{previewProjection.name}</h3>
                <span className="status-badge">{previewUnsaved ? 'Unsaved preview' : 'Saved draft preview'}</span>
              </div>
              <p className="subtle-label">Read-only member view — not live, no feed, DMs, invites, roles or entitlements.</p>
              <p className="prose">{previewProjection.description}</p>
              <section aria-labelledby="community-rules-heading">
                <h4 id="community-rules-heading">Community rules</h4>
                <p className="prose community-rules-body">{previewProjection.rules}</p>
              </section>
              {previewProjection.topics.length > 0 && (
                <section aria-labelledby="community-topics-heading">
                  <h4 id="community-topics-heading">Topics</h4>
                  <ol className="community-topic-preview-list">
                    {previewProjection.topics.map(topic => (
                      <li key={topic.id}>
                        <strong>{topic.name}</strong>
                        {topic.description ? <p className="prose">{topic.description}</p> : null}
                      </li>
                    ))}
                  </ol>
                </section>
              )}
              <button type="button" onClick={closeMemberPreview}>Close member preview</button>
            </article>
          )}
        </>
      )}
      <LauncherAccountSync kind="community-space" label="Community space" readLocal={() => localStorage.getItem(communitySpaceStorageKey(profileId))} validate={raw => { restoreCommunitySpaceDraft(raw, profileId); }} onApply={raw => { localStorage.setItem(communitySpaceStorageKey(profileId), raw); window.location.reload(); }} />
    </section>
  );
}
