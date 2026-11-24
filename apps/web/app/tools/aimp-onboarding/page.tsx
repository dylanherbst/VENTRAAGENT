'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { GlassCard } from '../../design-system/primitives';
import { answerText, formatAud, isAnswered, parseStepText, progress, setAnswer, stepIds, steps, toProfile } from '../../../lib/aimp/onboarding/model';
import type { Answers, StepId } from '../../../lib/aimp/onboarding/model';
import { DEMO_DRAFT_KEY, createLocalStorageStore } from '../../../lib/aimp/onboarding/store';
import type { DraftStep, LoadResult } from '../../../lib/aimp/onboarding/store';

// Isolated test page: the real onboarding model and save/resume store. Answers are saved in this
// browser only (localStorage) under a labelled demo key; no account or workspace is touched.
export default function AimpOnboardingTest() {
  const store = useMemo(() => createLocalStorageStore(), []);
  const [ready, setReady] = useState(false);
  const [answers, setAnswers] = useState<Answers>({});
  const [step, setStep] = useState<DraftStep>('budget');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [kept, setKept] = useState(false);
  const [notice, setNotice] = useState<LoadResult | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const r = store.load(DEMO_DRAFT_KEY);
    setAnswers(r.answers);
    setStep(r.step);
    if (r.step !== 'review') setText(answerText(r.answers, r.step));
    setNotice(r.status === 'empty' ? null : r);
    setReady(true);
  }, [store]);

  function go(next: DraftStep, a: Answers) {
    setStep(next);
    setError('');
    setKept(false);
    setText(next === 'review' ? '' : answerText(a, next));
    setSaved(store.save(DEMO_DRAFT_KEY, next, a).message);
    queueMicrotask(() => heading.current?.focus());
  }

  function change(info: StepId, value: string) {
    setText(value);
    setError('');
    const r = parseStepText(info, value);
    if (r.ok) {
      const { answers: a } = setAnswer(answers, info, r.value);
      setAnswers(a);
      setSaved(store.save(DEMO_DRAFT_KEY, info, a).message);
      setKept(false);
    } else {
      setSaved('');
      setKept(isAnswered(answers, info));
    }
  }

  function next(id: StepId) {
    const r = parseStepText(id, text);
    if (!r.ok) { setError(r.error); return; }
    const { answers: a } = setAnswer(answers, id, r.value);
    setAnswers(a);
    const i = stepIds.indexOf(id);
    go(i + 1 < stepIds.length ? stepIds[i + 1] : 'review', a);
  }

  function back(id: DraftStep) {
    const i = id === 'review' ? stepIds.length : stepIds.indexOf(id);
    if (i > 0) go(stepIds[i - 1], answers);
  }

  function startAgain() {
    store.clear(DEMO_DRAFT_KEY);
    setAnswers({});
    setNotice(null);
    setSaved('');
    setKept(false);
    setStep('budget');
    setError('');
    setText('');
    queueMicrotask(() => heading.current?.focus());
  }

  const p = progress(answers);
  const info = step === 'review' ? null : steps.find((s) => s.id === step);
  const profile = toProfile(answers);
  const index = step === 'review' ? stepIds.length : stepIds.indexOf(step);

  return <main className="v-onboarding-test">
    <h1>AiMoneyPrinter onboarding test</h1>
    <p><span className="v-status" data-testid="mode">DEMO · answers are stored in this browser only (demo user, no account)</span></p>
    {!ready ? <p role="status">Loading your saved answers…</p> : <>
      <GlassCard>
        <p data-testid="progress-text">{step === 'review' ? 'Review your answers' : `Step ${index + 1} of ${stepIds.length}`}</p>
        <progress value={p.answered} max={p.total} aria-label="Onboarding progress" data-testid="progress" />
        <p data-testid="progress-detail">{p.answered} of {p.total} answered ({p.percent}%)</p>
        {notice ? <p role="status" data-testid="resume-notice">{notice.message}{notice.needsReentry.length ? ` Please enter again: ${notice.needsReentry.join(', ')}.` : ''}</p> : null}
        {info ? <form onSubmit={(e) => { e.preventDefault(); next(info.id); }} noValidate>
          <h2 ref={heading} tabIndex={-1} data-testid="step-title">{info.question}</h2>
          {info.kind === 'choice' ? <fieldset aria-describedby="hint">
            <legend>{info.title}</legend>
            {info.options?.map((o) => <label className="v-radio" key={o.value}>
              <input type="radio" name="effort" value={o.value} checked={text === o.value} onChange={() => change(info.id, o.value)} />
              <span><strong>{o.label}</strong><small>{o.detail}</small></span>
            </label>)}
          </fieldset> : <label>
            <span>{info.title}{info.optional ? ' (optional)' : ''}</span>
            <input
              name={info.id}
              value={text}
              onChange={(e) => change(info.id, e.target.value)}
              inputMode={info.kind === 'list' ? 'text' : info.kind === 'money' ? 'decimal' : 'numeric'}
              autoComplete="off"
              aria-describedby={error ? 'hint err' : 'hint'}
              aria-invalid={error ? true : undefined}
              style={{ minHeight: 44, width: '100%' }}
            />
          </label>}
          <p id="hint"><small>{info.hint}</small></p>
          {error ? <p id="err" role="alert" data-testid="error">{error}</p> : null}
          <p>
            <button type="button" onClick={() => back(info.id)} disabled={index === 0} style={{ minHeight: 44, minWidth: 88 }}>Back</button>{' '}
            <button type="submit" style={{ minHeight: 44, minWidth: 88 }}>{index === stepIds.length - 1 ? 'Review' : 'Next'}</button>
          </p>
        </form> : <div>
          <h2 ref={heading} tabIndex={-1} data-testid="step-title">Check your answers</h2>
          {profile.ok ? <dl data-testid="summary">
            <dt>Budget</dt><dd>{formatAud(profile.profile.budgetMinor)}</dd>
            <dt>Hours a week</dt><dd>{profile.profile.weeklyHours}</dd>
            <dt>Interests</dt><dd>{profile.profile.interests.join(', ')}</dd>
            <dt>Skills</dt><dd>{profile.profile.skills.length ? profile.profile.skills.join(', ') : 'None yet'}</dd>
            <dt>Effort</dt><dd>{profile.profile.preferredEffort}</dd>
          </dl> : <p role="alert">Still to answer: {profile.missing.join(', ')}.</p>}
          <p>
            <button type="button" onClick={() => back('review')} style={{ minHeight: 44, minWidth: 88 }}>Back</button>{' '}
            {!profile.ok ? <button type="button" onClick={() => go(profile.missing[0], answers)} style={{ minHeight: 44 }}>Go to {profile.missing[0]}</button> : null}
          </p>
        </div>}
        <p role="status" aria-live="polite" data-testid="saved">{kept ? 'That entry is not valid yet, so your last valid answer is kept.' : saved}</p>
      </GlassCard>
      <GlassCard>
        <h2>Opportunity Finder input</h2>
        <pre data-testid="profile">{profile.ok ? JSON.stringify(profile.profile, null, 2) : 'Not complete yet'}</pre>
        <button type="button" onClick={startAgain} style={{ minHeight: 44 }}>Clear saved answers and start again</button>
      </GlassCard>
    </>}
  </main>;
}
