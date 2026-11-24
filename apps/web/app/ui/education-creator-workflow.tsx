'use client';
import { useEffect, useRef, useState } from 'react';
import type { Profile } from '../../lib/onboarding';
import { offerCurrencies } from '../../lib/local-offers';
import {
  approveOfferForCurriculumPlanning,
  blankCreatorInterview,
  blankCreatorWorkflow,
  creatorInterviewErrors,
  creatorWorkflowGeneratorVersion,
  educationCreatorWorkflowStorageKey,
  addSuggestedLesson,
  generateSuggestedOutline,
  importOutlineToCourseStorage,
  offerProposalRevisionHash,
  persistCreatorWorkflow,
  proposedOfferFromInterview,
  removeSuggestedLessonAt,
  reorderSuggestedLessons,
  restoreCreatorWorkflow,
  saveSuggestedOutlineToWorkflow,
  suggestedOutlineMatchesSaved,
  syncInterviewToWorkflow,
  updateProposedOfferOnWorkflow,
  type CreatorInterviewInput,
  type CreatorProposedOffer,
  type CreatorWorkflowRecord,
  type SuggestedLesson,
} from '../../lib/local-education-creator-workflow';
import {
  educationCourseLessonLimit,
  educationCourseStorageKey,
  quizBearingLessonsDroppedOnReplaceImport,
  restoreEducationCourseDraft,
} from '../../lib/local-education-course';

type Step = 'interview' | 'offer' | 'curriculum';

const interviewSections: { title: string; fields: { key: keyof CreatorInterviewInput; label: string; rows?: number; optional?: boolean }[] }[] = [
  {
    title: '1. Expertise and evidence (self-reported)',
    fields: [
      { key: 'expertiseSummary', label: 'What can you teach?', rows: 2 },
      { key: 'evidenceExample', label: 'One relevant example or result', rows: 2 },
      { key: 'outsideCompetence', label: 'What is outside your competence?', rows: 2 },
    ],
  },
  {
    title: '2. Learner and starting point',
    fields: [
      { key: 'learnerProfile', label: 'Who is this for?', rows: 2 },
      { key: 'prerequisites', label: 'Prerequisites', rows: 2, optional: true },
      { key: 'learnerProblem', label: 'Recurring problem they face', rows: 2 },
      { key: 'priorKnowledge', label: 'What they already know', rows: 2, optional: true },
    ],
  },
  {
    title: '3. Outcome',
    fields: [
      { key: 'observableOutcome', label: 'One achievable observable result', rows: 2 },
      { key: 'proofArtifact', label: 'Exercise or artifact that proves it', rows: 2 },
    ],
  },
  {
    title: '4. Delivery constraints',
    fields: [
      { key: 'deliveryFormat', label: 'Format (course, workshop, coaching, etc.)' },
      { key: 'learnerTime', label: 'Learner time commitment', optional: true },
      { key: 'creatorSupport', label: 'Creator support included', rows: 2, optional: true },
      { key: 'accessibilityNeeds', label: 'Accessibility or material needs', rows: 2, optional: true },
    ],
  },
  {
    title: '5. Offer assumptions (not market validation)',
    fields: [
      { key: 'offerTitle', label: 'Proposed offer title' },
      { key: 'offerOutcome', label: 'Promised outcome', rows: 2 },
      { key: 'includedSupport', label: 'Included support', rows: 2, optional: true },
      { key: 'excludedSupport', label: 'Excluded support', rows: 2, optional: true },
      { key: 'proposedPrice', label: 'Proposed one-time price (0 for free)', optional: true },
      { key: 'assumptionsAndUnknowns', label: 'Evidence and unknowns', rows: 3 },
    ],
  },
];

export default function EducationCreatorWorkflow({ profile }: { profile: Profile }) {
  const profileId = profile.id;
  const [workflow, setWorkflow] = useState<CreatorWorkflowRecord | null>(null);
  const [interview, setInterview] = useState<CreatorInterviewInput>(() => blankCreatorInterview(profile));
  const [offer, setOffer] = useState<CreatorProposedOffer>(() => proposedOfferFromInterview(blankCreatorInterview(profile)));
  const [outline, setOutline] = useState<SuggestedLesson[]>([]);
  const [step, setStep] = useState<Step>('interview');
  const [rawRef, setRawRef] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [writable, setWritable] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [replaceQuizLossPrompt, setReplaceQuizLossPrompt] = useState<
    { id: string; title: string }[] | null
  >(null);
  const heading = useRef<HTMLHeadingElement>(null);

  function hydrate(record: CreatorWorkflowRecord | null) {
    if (!record) {
      setWorkflow(null);
      setInterview(blankCreatorInterview(profile));
      setOffer(proposedOfferFromInterview(blankCreatorInterview(profile)));
      setOutline([]);
      setStep('interview');
      setStatus('No saved creator workflow yet. Answers stay in this browser until you save.');
      return;
    }
    setWorkflow(record);
    setInterview(record.interview);
    setOffer(record.proposedOffer);
    setOutline(record.suggestedOutline ?? []);
    setStep(record.suggestedOutline?.length ? 'curriculum' : record.approvedOfferRevisionHash ? 'curriculum' : 'offer');
    setStatus(`Workflow saved in this browser · revision ${record.revision}. Not published, not sold, not hosted.`);
  }

  function load() {
    try {
      const raw = window.localStorage.getItem(educationCreatorWorkflowStorageKey(profileId));
      const restored = raw === null ? null : restoreCreatorWorkflow(raw, profileId);
      setRawRef(raw);
      hydrate(restored);
      setWritable(true);
      setError('');
    } catch (issue) {
      setWritable(false);
      setError(issue instanceof Error ? issue.message : 'Creator workflow could not be restored.');
    }
    setReady(true);
  }

  useEffect(() => {
    load();
  }, [profileId]);

  useEffect(() => {
    heading.current?.focus();
  }, [step]);

  useEffect(() => {
    setReplaceQuizLossPrompt(null);
  }, [outline]);

  function persist(next: CreatorWorkflowRecord, message: string) {
    const raw = persistCreatorWorkflow(window.localStorage, profileId, rawRef, next);
    setRawRef(raw);
    setWorkflow(next);
    hydrate(next);
    setStatus(message);
    setError('');
  }

  function ensureWorkflow(): CreatorWorkflowRecord {
    if (workflow) return workflow;
    const created = blankCreatorWorkflow(profile, window.crypto.randomUUID());
    setWorkflow(created);
    return created;
  }

  function saveInterview() {
    try {
      const base = ensureWorkflow();
      const next = syncInterviewToWorkflow(base, interview);
      setOffer(next.proposedOffer);
      persist(next, 'Interview saved. Review the proposed offer — saving is not approval to publish or sell.');
      setStep('offer');
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Could not save interview.');
    }
  }

  function saveOfferEdits() {
    try {
      const base = ensureWorkflow();
      const next = updateProposedOfferOnWorkflow(base, offer);
      persist(next, 'Offer proposal saved. Approve for curriculum planning when the revision looks right.');
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Could not save offer proposal.');
    }
  }

  function approveOffer() {
    try {
      const base = ensureWorkflow();
      const synced = updateProposedOfferOnWorkflow(base, offer);
      const next = approveOfferForCurriculumPlanning(synced);
      persist(
        next,
        'Offer approved for curriculum planning only — not publication, checkout, or learner access.',
      );
      setStep('curriculum');
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Could not approve offer.');
    }
  }

  function runGenerateOutline() {
    try {
      const base = ensureWorkflow();
      const next = generateSuggestedOutline(base);
      setOutline(next.suggestedOutline ?? []);
      persist(
        next,
        `Suggested outline ready (${creatorWorkflowGeneratorVersion}). Label: suggestions from your answers, not AI or market validation.`,
      );
      setStep('curriculum');
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Could not generate outline.');
    }
  }

  function saveOutline() {
    try {
      const base = ensureWorkflow();
      const next = saveSuggestedOutlineToWorkflow(base, outline);
      persist(
        next,
        'Suggested outline saved in this browser. Import copies into the course draft only when you choose replace or append.',
      );
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Could not save suggested outline.');
    }
  }

  function discardOutlineEdits() {
    setOutline(workflow?.suggestedOutline ?? []);
    setError('');
    setStatus(
      workflow?.suggestedOutline?.length
        ? 'Reverted to last saved suggested outline.'
        : 'Outline edits cleared.',
    );
  }

  function importReadiness() {
    const base = ensureWorkflow();
    if (!suggestedOutlineMatchesSaved(base.suggestedOutline, outline)) {
      throw new Error('Save your outline edits before importing into the course draft.');
    }
    if (!base.suggestedOutline?.length) throw new Error('Generate and save a suggested outline before importing.');
    const courseKey = educationCourseStorageKey(profileId);
    const courseExpectedRaw = window.localStorage.getItem(courseKey);
    const existing =
      courseExpectedRaw === null ? null : restoreEducationCourseDraft(courseExpectedRaw, profileId);
    const courseId = existing?.id ?? window.crypto.randomUUID();
    return { base, courseExpectedRaw, existing, courseId };
  }

  function importToCourse(mode: 'replace' | 'merge') {
    try {
      const { base, courseExpectedRaw, courseId } = importReadiness();
      const result = importOutlineToCourseStorage(
        window.localStorage,
        profileId,
        courseExpectedRaw,
        base,
        mode,
        courseId,
      );
      const workflowRaw = persistCreatorWorkflow(window.localStorage, profileId, rawRef, result.workflow);
      setRawRef(workflowRaw);
      setWorkflow(result.workflow);
      hydrate(result.workflow);
      setReplaceQuizLossPrompt(null);
      const quizNote =
        result.preservedQuizLessonIds.length > 0
          ? ` Kept ${result.preservedQuizLessonIds.length} saved lesson quiz(es) where lesson IDs matched the import.`
          : '';
      const quizRemovedNote =
        result.removedQuizLessonIds.length > 0
          ? ` ${result.removedQuizLessonIds.length} lesson quiz(es) were on lessons removed by this replace — review in the course editor.`
          : '';
      setStatus(
        mode === 'replace'
          ? `Imported into your local course outline draft. Open “Edit course outline” below to review and save explicitly.${quizNote}${quizRemovedNote}`
          : `Merged into your local course outline draft. Review lessons in the course editor before saving.${quizNote}`,
      );
      setError('');
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Import did not complete. Course draft unchanged.');
    }
  }

  function beginReplaceImport() {
    try {
      const { base, existing } = importReadiness();
      if (existing && base.suggestedOutline?.length) {
        const atRisk = quizBearingLessonsDroppedOnReplaceImport(
          base.suggestedOutline,
          existing.lessons,
        );
        if (atRisk.length) {
          setReplaceQuizLossPrompt(atRisk);
          setError('');
          setStatus('');
          return;
        }
      }
      importToCourse('replace');
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Import did not complete. Course draft unchanged.');
    }
  }

  function confirmReplaceImportAfterQuizLossAck() {
    setReplaceQuizLossPrompt(null);
    importToCourse('replace');
  }

  const interviewErrors = creatorInterviewErrors(interview);
  const offerHash = offerProposalRevisionHash(offer);
  const approvalCurrent = workflow?.approvedOfferRevisionHash === offerHash;
  const outlineDirty = workflow
    ? !suggestedOutlineMatchesSaved(workflow.suggestedOutline, outline)
    : outline.length > 0;
  const workflowId = workflow?.workflowId ?? '';

  return (
    <section className="education-creator-workflow card" aria-labelledby="education-creator-workflow-title">
      <div className="section-heading">
        <h2 id="education-creator-workflow-title">Education creator planning</h2>
        <span className="status-badge">Browser-only · suggestions</span>
      </div>
      <p>
        Structured expertise interview, editable offer proposal, and a deterministic lesson outline for {profile.name}.
        Your shared profile, offer library, and course draft stay unchanged until you explicitly save or import.
      </p>
      {status && <p role="status">{status}</p>}
      {error && <p role="alert" className="error">{error}</p>}
      {!ready ? (
        <p role="status">Loading creator workflow…</p>
      ) : (
        <>
          <div className="setup-actions">
            <button type="button" disabled={!writable} onClick={() => setStep('interview')}>Interview</button>
            <button type="button" disabled={!writable} onClick={() => setStep('offer')}>Offer review</button>
            <button type="button" disabled={!writable} onClick={() => setStep('curriculum')}>Curriculum</button>
            <button type="button" disabled={!writable} onClick={load}>Reload saved workflow</button>
          </div>
          {step === 'interview' && (
            <form
              className="education-creator-interview"
              onSubmit={event => {
                event.preventDefault();
                saveInterview();
              }}
            >
              <h3 ref={heading} tabIndex={-1}>Expertise interview</h3>
              <p className="panel-note">Self-reported evidence only. Profile fields above are suggestions, not auto-saved into your profile.</p>
              {interviewSections.map(section => (
                <fieldset key={section.title}>
                  <legend>{section.title}</legend>
                  {section.fields.map(field => (
                    <label key={field.key}>
                      {field.label}
                      {field.key === 'proposedPrice' ? (
                        <input
                          inputMode="decimal"
                          value={interview.proposedPrice}
                          onChange={e => setInterview({ ...interview, proposedPrice: e.target.value })}
                        />
                      ) : field.key === 'currency' ? null : (
                        <textarea
                          required={!field.optional}
                          rows={field.rows ?? 1}
                          value={interview[field.key] as string}
                          onChange={e => setInterview({ ...interview, [field.key]: e.target.value })}
                        />
                      )}
                    </label>
                  ))}
                  {section.title.startsWith('5.') && (
                    <label>
                      Currency
                      <select
                        value={interview.currency}
                        onChange={e => setInterview({ ...interview, currency: e.target.value as CreatorInterviewInput['currency'] })}
                      >
                        {offerCurrencies.map(currency => (
                          <option key={currency}>{currency}</option>
                        ))}
                      </select>
                    </label>
                  )}
                </fieldset>
              ))}
              {interviewErrors.length > 0 && (
                <p className="error" role="alert">{interviewErrors.join(' ')}</p>
              )}
              <div className="setup-actions">
                <button className="primary-button" type="submit" disabled={!writable || interviewErrors.length > 0}>
                  Save interview &amp; build offer proposal
                </button>
              </div>
            </form>
          )}
          {step === 'offer' && (
            <div className="education-creator-offer">
              <h3 ref={heading} tabIndex={-1}>Offer proposal review</h3>
              <p className="panel-note">
                Edit freely. Saving updates the proposal only. Approval binds revision <code>{offerHash}</code> for curriculum planning — not publishing or payments.
              </p>
              <div className="setup-fields">
                <label>Offer title<input required value={offer.name} onChange={e => setOffer({ ...offer, name: e.target.value })} /></label>
                <label>Audience<input required value={offer.audience} onChange={e => setOffer({ ...offer, audience: e.target.value })} /></label>
                <label>Currency
                  <select value={offer.currency} onChange={e => setOffer({ ...offer, currency: e.target.value as CreatorProposedOffer['currency'] })}>
                    {offerCurrencies.map(currency => <option key={currency}>{currency}</option>)}
                  </select>
                </label>
                <label>One-time price<input inputMode="decimal" value={offer.price} onChange={e => setOffer({ ...offer, price: e.target.value })} /></label>
              </div>
              <label>Outcome<textarea required rows={3} value={offer.outcome} onChange={e => setOffer({ ...offer, outcome: e.target.value })} /></label>
              <label>Delivery details<textarea required rows={4} value={offer.delivery} onChange={e => setOffer({ ...offer, delivery: e.target.value })} /></label>
              <label>Assumptions and unknowns<textarea rows={3} value={offer.assumptionsAndUnknowns} onChange={e => setOffer({ ...offer, assumptionsAndUnknowns: e.target.value })} /></label>
              <div className="setup-actions">
                <button type="button" disabled={!writable} onClick={saveOfferEdits}>Save offer proposal</button>
                <button type="button" className="primary-button" disabled={!writable} onClick={approveOffer}>
                  Approve offer for curriculum planning
                </button>
              </div>
              {workflow?.approvedOfferRevisionHash && !approvalCurrent && (
                <p role="alert" className="error">Offer changed since last approval. Approve again before generating curriculum.</p>
              )}
              {approvalCurrent && (
                <p role="status">Current revision approved for curriculum planning at {workflow?.approvedAt ?? '—'}.</p>
              )}
            </div>
          )}
          {step === 'curriculum' && (
            <div className="education-creator-curriculum">
              <h3 ref={heading} tabIndex={-1}>Suggested curriculum outline</h3>
              <p className="panel-note">
                Suggested outline from your answers ({creatorWorkflowGeneratorVersion}). Not AI-generated; not market-validated.
                Import copies into the editable course draft below — it does not publish or host.
              </p>
              {!approvalCurrent && (
                <p role="alert" className="error">Approve the current offer revision before generating or importing an outline.</p>
              )}
              {outlineDirty && (
                <p role="status">Unsaved outline edits — save before import or reload.</p>
              )}
              {workflow?.lastApplyCommandKey && outlineDirty && (
                <p role="alert" className="error">
                  Outline changed since the last import. Save, then choose replace or append to review updates in the course draft.
                </p>
              )}
              {replaceQuizLossPrompt && (
                <div role="alert" className="education-quiz-replace-preflight">
                  <p>
                    Replace import will remove {replaceQuizLossPrompt.length} saved lesson quiz
                    {replaceQuizLossPrompt.length === 1 ? '' : 'es'} on lessons no longer in this outline:
                  </p>
                  <ul>
                    {replaceQuizLossPrompt.map(lesson => (
                      <li key={lesson.id}>{lesson.title}</li>
                    ))}
                  </ul>
                  <div className="setup-actions">
                    <button
                      type="button"
                      className="primary-button"
                      onClick={confirmReplaceImportAfterQuizLossAck}
                    >
                      Confirm replace and discard these quizzes
                    </button>
                    <button type="button" onClick={() => setReplaceQuizLossPrompt(null)}>
                      Cancel replace import
                    </button>
                  </div>
                </div>
              )}
              <div className="setup-actions">
                <button type="button" disabled={!writable || !approvalCurrent} onClick={runGenerateOutline}>
                  Generate suggested outline
                </button>
                <button
                  type="button"
                  className="primary-button"
                  disabled={!writable || !approvalCurrent || !outline.length || !outlineDirty}
                  onClick={saveOutline}
                >
                  Save suggested outline
                </button>
                <button type="button" disabled={!writable || !outlineDirty} onClick={discardOutlineEdits}>
                  Discard outline edits
                </button>
                <button
                  type="button"
                  disabled={!writable || !approvalCurrent || !outline.length || outlineDirty}
                  onClick={beginReplaceImport}
                >
                  Import into course draft (replace lessons)
                </button>
                <button
                  type="button"
                  disabled={!writable || !approvalCurrent || !outline.length || outlineDirty}
                  onClick={() => importToCourse('merge')}
                >
                  Import into course draft (append lessons)
                </button>
              </div>
              {outline.map((lesson, index) => (
                <article key={lesson.id} className="education-lesson-row">
                  <p className="subtle-label">Suggested lesson {index + 1}</p>
                  <label>Title<input value={lesson.title} onChange={e => {
                    const next = [...outline];
                    next[index] = { ...lesson, title: e.target.value };
                    setOutline(next);
                  }} /></label>
                  <label>Objective<textarea rows={2} value={lesson.objective} onChange={e => {
                    const next = [...outline];
                    next[index] = { ...lesson, objective: e.target.value };
                    setOutline(next);
                  }} /></label>
                  <label>Lesson draft<textarea rows={4} value={lesson.content} onChange={e => {
                    const next = [...outline];
                    next[index] = { ...lesson, content: e.target.value };
                    setOutline(next);
                  }} /></label>
                  <label>Practice task<textarea rows={2} value={lesson.practiceTask} onChange={e => {
                    const next = [...outline];
                    next[index] = { ...lesson, practiceTask: e.target.value };
                    setOutline(next);
                  }} /></label>
                  <label>
                    Duration (optional minutes)
                    <input
                      inputMode="numeric"
                      maxLength={3}
                      placeholder="e.g. 12"
                      value={lesson.durationMinutes}
                      onChange={e => {
                        const next = [...outline];
                        next[index] = { ...lesson, durationMinutes: e.target.value };
                        setOutline(next);
                      }}
                    />
                  </label>
                  <span className="education-lesson-order">
                    <button
                      type="button"
                      aria-label={`Move suggested lesson ${index + 1} up`}
                      disabled={index === 0}
                      onClick={() => setOutline(reorderSuggestedLessons(outline, index, -1))}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label={`Move suggested lesson ${index + 1} down`}
                      disabled={index === outline.length - 1}
                      onClick={() => setOutline(reorderSuggestedLessons(outline, index, 1))}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      disabled={outline.length <= 1}
                      onClick={() => {
                        try {
                          setOutline(removeSuggestedLessonAt(outline, index));
                        } catch (issue) {
                          setError(issue instanceof Error ? issue.message : 'Could not remove lesson.');
                        }
                      }}
                    >
                      Remove suggested lesson
                    </button>
                  </span>
                </article>
              ))}
              <button
                type="button"
                disabled={!writable || !workflowId || outline.length >= educationCourseLessonLimit}
                onClick={() => {
                  try {
                    setOutline(addSuggestedLesson(workflowId, outline));
                  } catch (issue) {
                    setError(issue instanceof Error ? issue.message : 'Could not add lesson.');
                  }
                }}
              >
                Add suggested lesson
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
