'use client';
import { useEffect, useRef, useState } from 'react';
import type { Profile } from '../../lib/onboarding';
import {
  blankSkillAssessmentDraftInput,
  blankSkillAssessmentSkillInput,
  editSkillAssessmentDraft,
  labelForConfidence,
  labelForExperience,
  persistSkillAssessmentDraft,
  projectSkillAssessmentSummary,
  restoreSkillAssessmentDraft,
  saveSkillAssessmentDraft,
  skillAssessmentDraftFromInput,
  skillAssessmentSkillLimit,
  skillAssessmentStorageKey,
  skillConfidenceLevels,
  skillEvidenceLimit,
  skillExperienceLevels,
  skillIntentOptions,
  skillNameLimit,
  suggestSkillNameFromProfile,
} from '../../lib/local-skill-assessment';
import type {
  SkillAssessmentDraft,
  SkillAssessmentDraftInput,
  SkillAssessmentSummaryProjection,
} from '../../lib/local-skill-assessment';

type FocusTarget = 'create' | 'edit' | 'summary' | 'summary-heading';

export default function SkillAssessmentDraftEditor({ profile }: { profile: Profile }) {
  const profileId = profile.id;
  const [saved, setSaved] = useState<SkillAssessmentDraft | null>(null);
  const [input, setInput] = useState<SkillAssessmentDraftInput | null>(null);
  const [editing, setEditing] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summaryProjection, setSummaryProjection] = useState<SkillAssessmentSummaryProjection | null>(null);
  const [summaryUnsaved, setSummaryUnsaved] = useState(false);
  const [ready, setReady] = useState(false);
  const [writable, setWritable] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const rawRef = useRef<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const createButton = useRef<HTMLButtonElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const summaryButton = useRef<HTMLButtonElement>(null);
  const unsavedSummaryButton = useRef<HTMLButtonElement>(null);
  const summaryHeading = useRef<HTMLHeadingElement>(null);
  const pendingFocus = useRef<FocusTarget | null>(null);
  const profileHint = suggestSkillNameFromProfile(profile);

  function applyRestore(raw: string | null, restored: SkillAssessmentDraft | null) {
    rawRef.current = raw;
    setSaved(restored);
    setSummaryOpen(false);
    setSummaryProjection(null);
    setSummaryUnsaved(false);
    setStorageError('');
    setWritable(true);
    setStatus(
      restored
        ? `Saved skill assessment restored (revision ${restored.revision}).`
        : 'No saved skill assessment yet.',
    );
  }

  function markStorageUnavailable(priorRaw?: string | null) {
    if (priorRaw !== undefined) rawRef.current = priorRaw;
    setSaved(null);
    setSummaryOpen(false);
    setSummaryProjection(null);
    setSummaryUnsaved(false);
    setWritable(false);
    setStatus('');
    setStorageError(
      'Saved skill assessment could not be restored or browser storage is unavailable. Nothing was overwritten.',
    );
    setError('');
  }

  function load() {
    let raw: string | null | undefined;
    try {
      raw = window.localStorage.getItem(skillAssessmentStorageKey(profileId));
      const restored = raw === null ? null : restoreSkillAssessmentDraft(raw, profileId);
      applyRestore(raw, restored);
      setError('');
    } catch (issue) {
      markStorageUnavailable(raw);
      setError(issue instanceof Error ? issue.message : 'Saved skill assessment could not be restored.');
    }
    setReady(true);
  }

  useEffect(() => {
    let raw: string | null | undefined;
    try {
      raw = window.localStorage.getItem(skillAssessmentStorageKey(profileId));
      const restored = raw === null ? null : restoreSkillAssessmentDraft(raw, profileId);
      applyRestore(raw, restored);
    } catch (issue) {
      markStorageUnavailable(raw);
      setError(issue instanceof Error ? issue.message : 'Saved skill assessment could not be restored.');
    }
    setReady(true);
  }, [profileId]);

  useEffect(() => {
    if (editing) heading.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (!editing || !input) return;
    const baseline = saved ? editSkillAssessmentDraft(saved) : blankSkillAssessmentDraftInput();
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
    if (target === 'summary-heading') {
      if (!summaryOpen) return;
      pendingFocus.current = null;
      summaryHeading.current?.focus();
      return;
    }
    if (target === 'summary') {
      if (editing || summaryOpen) return;
      pendingFocus.current = null;
      summaryButton.current?.focus();
      return;
    }
    if (editing || summaryOpen) return;
    pendingFocus.current = null;
    const el = target === 'create' ? createButton.current : editButton.current;
    el?.focus();
  }, [editing, summaryOpen]);

  function changeSkills(skills: SkillAssessmentDraftInput['skills']) {
    setInput(current => (current ? { ...current, skills } : current));
    setError('');
  }

  function openEditor(fromSaved?: SkillAssessmentDraft) {
    const base = fromSaved ? editSkillAssessmentDraft(fromSaved) : blankSkillAssessmentDraftInput();
    if (!base.skills.length) {
      const row = blankSkillAssessmentSkillInput();
      row.id = window.crypto.randomUUID();
      base.skills = [row];
    }
    setInput(base);
    setEditing(true);
    setSummaryOpen(false);
    setSummaryProjection(null);
    setError('');
    setStatus(
      fromSaved
        ? 'Editing saved assessment. Changes are unsaved until you save.'
        : 'Add specific skills you believe you have — ratings are self-reported.',
    );
  }

  function closeEditor(message: string) {
    pendingFocus.current = saved ? 'edit' : 'create';
    setEditing(false);
    setInput(null);
    setSummaryOpen(false);
    setSummaryProjection(null);
    setSummaryUnsaved(false);
    setError('');
    setStatus(message);
  }

  function openSummary(unsaved: boolean) {
    try {
      const draft = unsaved
        ? skillAssessmentDraftFromInput(input!, profileId, saved)
        : saved!;
      pendingFocus.current = 'summary-heading';
      setSummaryProjection(projectSkillAssessmentSummary(draft, profile));
      setSummaryUnsaved(unsaved);
      setSummaryOpen(true);
      setError('');
      setStatus(
        unsaved
          ? 'Summary from unsaved editor — self-reported only, not validation.'
          : 'Summary from saved assessment — self-reported only, not validation.',
      );
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Summary could not be generated.');
    }
  }

  function closeSummary() {
    pendingFocus.current = summaryUnsaved ? 'create' : 'summary';
    setSummaryOpen(false);
    setSummaryProjection(null);
    setSummaryUnsaved(false);
  }

  const pathwayLabel = profile.pathways.map(p => (p === 'education' ? 'Education' : 'Services')).join(' + ');

  return (
    <section className="skill-assessment card" aria-labelledby="skill-assessment-title">
      <div className="section-heading">
        <h2 id="skill-assessment-title">Skill self-assessment</h2>
        <span className="status-badge">Browser draft · self-reported</span>
      </div>
      <p>
        List up to {skillAssessmentSkillLimit} skills for {profile.name || 'your project'}, rate your own confidence and
        experience, and note optional evidence. This does not score you with AI, verify credentials, or predict market
        demand.
      </p>
      <p className="panel-note">
        Profile pathways: {pathwayLabel}. Your business profile expertise field is not changed by this tool. Offers are
        not created unless you save them separately below.
      </p>
      {status && <p role="status">{status}</p>}
      {storageError && (
        <p role="alert" className="error" id="skill-assessment-storage-error">{storageError}</p>
      )}
      {error && <p role="alert" className="error" id="skill-assessment-error">{error}</p>}
      {!ready ? (
        <p role="status">Restoring skill assessment…</p>
      ) : (
        <>
          <div className="setup-actions skill-assessment-actions">
            {!editing && (
              <button
                ref={saved ? editButton : createButton}
                type="button"
                className="primary-button"
                disabled={!writable}
                onClick={() => openEditor(saved ?? undefined)}
              >
                {saved ? 'Edit saved assessment' : 'Start skill assessment'}
              </button>
            )}
            {!editing && saved && (
              <button ref={summaryButton} type="button" onClick={() => openSummary(false)}>
                View saved summary
              </button>
            )}
            <button type="button" disabled={editing} onClick={load}>Reload saved assessment</button>
          </div>
          {!editing && !saved && (
            <div className="skill-assessment-empty">
              <h3 tabIndex={-1}>Useful empty state</h3>
              <p>
                Start by naming one skill you would honestly claim today — for example a craft, method, or client outcome.
                Rate how confident you feel and how much real-world use you have had. Add an optional example you could
                cite in conversation (portfolio piece, client result, certification study — not verified here).
              </p>
              {profileHint && (
                <p>
                  Your profile lists expertise as “{profileHint}”. You can use that as your first skill name when you
                  start — it will not update the profile automatically.
                </p>
              )}
              <p>
                Choose whether you want to teach the skill, offer it as a service, or both. After saving, open the
                summary for strengths, evidence gaps and suggested next steps toward Education or Services tools on this
                page.
              </p>
            </div>
          )}
          {saved && !editing && (
            <p>
              Saved: <strong>{saved.skills.length} skill(s)</strong> · revision {saved.revision}
            </p>
          )}
          {editing && input && (
            <form
              className="skill-assessment-editor"
              aria-describedby="skill-assessment-editor-note"
              onSubmit={event => {
                event.preventDefault();
                try {
                  const draft = saveSkillAssessmentDraft(input, profileId, saved);
                  const raw = persistSkillAssessmentDraft(window.localStorage, profileId, rawRef.current, draft);
                  rawRef.current = raw;
                  setSaved(restoreSkillAssessmentDraft(raw, profileId));
                  closeEditor('Skill assessment saved in this browser. Summary is deterministic from your ratings.');
                } catch (issue) {
                  setError(issue instanceof Error ? issue.message : 'Save failed. Your unsaved changes remain.');
                }
              }}
            >
              <h3 ref={heading} tabIndex={-1}>{saved ? 'Edit skill assessment' : 'New skill assessment'}</h3>
              <p id="skill-assessment-editor-note">
                Unsaved until Save. Confidence and experience use labelled 1–5 scales — pick what fits your honest
                self-report.
              </p>
              {input.skills.map((skill, index) => (
                <fieldset className="skill-assessment-row" key={skill.id || `new-${index}`}>
                  <legend>Skill {index + 1}</legend>
                  <label>
                    Skill name
                    <input
                      required
                      maxLength={skillNameLimit}
                      value={skill.name}
                      onChange={e => {
                        const skills = [...input.skills];
                        skills[index] = { ...skill, name: e.target.value };
                        changeSkills(skills);
                      }}
                    />
                  </label>
                  <label>
                    Confidence (1–5)
                    <select
                      value={skill.confidence}
                      onChange={e => {
                        const skills = [...input.skills];
                        skills[index] = { ...skill, confidence: Number(e.target.value) as typeof skill.confidence };
                        changeSkills(skills);
                      }}
                    >
                      {skillConfidenceLevels.map(level => (
                        <option key={level.value} value={level.value}>
                          {level.value} — {level.label}: {level.detail}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="subtle-label" aria-live="polite">
                    Selected confidence: {labelForConfidence(skill.confidence)}
                  </p>
                  <label>
                    Experience (1–5)
                    <select
                      value={skill.experience}
                      onChange={e => {
                        const skills = [...input.skills];
                        skills[index] = { ...skill, experience: Number(e.target.value) as typeof skill.experience };
                        changeSkills(skills);
                      }}
                    >
                      {skillExperienceLevels.map(level => (
                        <option key={level.value} value={level.value}>
                          {level.value} — {level.label}: {level.detail}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="subtle-label" aria-live="polite">
                    Selected experience: {labelForExperience(skill.experience)}
                  </p>
                  <label>
                    Evidence example (optional)
                    <textarea
                      maxLength={skillEvidenceLimit}
                      rows={2}
                      placeholder="e.g. Helped three clients improve onboarding completion."
                      value={skill.evidenceExample}
                      onChange={e => {
                        const skills = [...input.skills];
                        skills[index] = { ...skill, evidenceExample: e.target.value };
                        changeSkills(skills);
                      }}
                    />
                  </label>
                  <fieldset>
                    <legend>How you want to use this skill</legend>
                    {skillIntentOptions.map(option => (
                      <label key={option.value} className="skill-intent-option">
                        <input
                          type="radio"
                          name={`intent-${skill.id || index}`}
                          checked={skill.intent === option.value}
                          onChange={() => {
                            const skills = [...input.skills];
                            skills[index] = { ...skill, intent: option.value };
                            changeSkills(skills);
                          }}
                        />
                        <span>
                          <strong>{option.label}</strong> — {option.detail}
                        </span>
                      </label>
                    ))}
                  </fieldset>
                  <button
                    type="button"
                    disabled={input.skills.length <= 1}
                    onClick={() => changeSkills(input.skills.filter((_, i) => i !== index))}
                  >
                    Remove skill
                  </button>
                </fieldset>
              ))}
              <div className="setup-actions">
                <button
                  type="button"
                  disabled={input.skills.length >= skillAssessmentSkillLimit}
                  onClick={() => {
                    const row = blankSkillAssessmentSkillInput();
                    row.id = window.crypto.randomUUID();
                    changeSkills([...input.skills, row]);
                  }}
                >
                  Add another skill
                </button>
                {profileHint && !input.skills.some(s => s.name.trim() === profileHint) && (
                  <button
                    type="button"
                    onClick={() => {
                      const skills = [...input.skills];
                      const targetIndex = skills.findIndex(s => !s.name.trim());
                      const row = targetIndex >= 0 ? skills[targetIndex] : blankSkillAssessmentSkillInput();
                      if (!row.id) row.id = window.crypto.randomUUID();
                      row.name = profileHint;
                      if (targetIndex >= 0) skills[targetIndex] = row;
                      else skills.push(row);
                      changeSkills(skills);
                    }}
                  >
                    Use profile expertise as skill name
                  </button>
                )}
              </div>
              <div className="setup-actions">
                <button className="primary-button" type="submit" disabled={!writable}>Save local skill assessment</button>
                <button ref={unsavedSummaryButton} type="button" onClick={() => openSummary(true)}>
                  Preview unsaved summary
                </button>
                <button type="button" onClick={() => closeEditor('Changes discarded. Saved assessment is unchanged.')}>
                  Cancel assessment changes
                </button>
              </div>
            </form>
          )}
          {summaryOpen && summaryProjection && (
            <article className="skill-assessment-summary card" aria-labelledby="skill-assessment-summary-title">
              <div className="section-heading">
                <h3 ref={summaryHeading} id="skill-assessment-summary-title" tabIndex={-1}>
                  Your self-reported summary
                </h3>
                <span className="status-badge">{summaryUnsaved ? 'Unsaved summary' : 'Saved assessment'}</span>
              </div>
              <p className="subtle-label">{summaryProjection.disclaimer}</p>
              <section aria-labelledby="skill-strengths-heading">
                <h4 id="skill-strengths-heading">Relative strengths (by your ratings)</h4>
                {summaryProjection.strengths.length ? (
                  <ul>
                    {summaryProjection.strengths.map(item => (
                      <li key={item.name}>
                        <strong>{item.name}</strong> — confidence: {item.confidenceLabel}, experience:{' '}
                        {item.experienceLabel} (combined {item.compositeScore}/10)
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No skills met the strength threshold yet. That is fine — adjust ratings or add evidence as you reflect.</p>
                )}
              </section>
              {summaryProjection.developing.length > 0 && (
                <section aria-labelledby="skill-developing-heading">
                  <h4 id="skill-developing-heading">Developing (mid-range self-ratings)</h4>
                  <ul>
                    {summaryProjection.developing.map(name => (
                      <li key={name}>{name}</li>
                    ))}
                  </ul>
                </section>
              )}
              <section aria-labelledby="skill-gaps-heading">
                <h4 id="skill-gaps-heading">Evidence gaps (no example recorded)</h4>
                {summaryProjection.evidenceGaps.length ? (
                  <ul>
                    {summaryProjection.evidenceGaps.map(name => (
                      <li key={name}>{name}</li>
                    ))}
                  </ul>
                ) : (
                  <p>Every listed skill has an optional evidence example on file.</p>
                )}
              </section>
              <section aria-labelledby="skill-next-heading">
                <h4 id="skill-next-heading">Suggested next steps (conceptual links)</h4>
                <ol className="skill-next-steps">
                  {summaryProjection.nextSteps.map(step => (
                    <li key={step.title}>
                      <a href={step.anchor}>{step.title}</a>
                      <p className="prose">{step.detail}</p>
                    </li>
                  ))}
                </ol>
              </section>
              <button type="button" onClick={closeSummary}>Close summary</button>
            </article>
          )}
        </>
      )}
    </section>
  );
}
