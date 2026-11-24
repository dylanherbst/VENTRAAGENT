'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { FeatureTileGroup, GlassButton, GlassField, GlassIcon, GlassSurface, OnboardingHeader, OnboardingLayout } from '../../design-system/aimp-glass';
import type { ControlIconName, FeatureIconName } from '../../design-system/aimp-glass';
import { answerText, formatAud, isAnswered, parseStepText, setAnswer, stepIds, steps, toProfile } from '../../../lib/aimp/onboarding/model';
import type { Answers, Effort, StepId } from '../../../lib/aimp/onboarding/model';
import { createLocalStorageStore } from '../../../lib/aimp/onboarding/store';
import type { DraftStep, LoadResult } from '../../../lib/aimp/onboarding/store';
import { START_DRAFT_KEY, flowStepNumber, flowTotal, startRoutes } from '../flow';

// The goal questionnaire. All rules (steps, validation, progress, the finished profile) come from
// lib/aimp/onboarding/model and saving/resuming from lib/aimp/onboarding/store, both unchanged. Answers are saved in
// this browser after every valid change, so leaving and coming back resumes at the first unanswered question.
const fieldIcon: Record<StepId, ControlIconName> = { budget: 'dollar', hours: 'clock', interests: 'heart', skills: 'tools', effort: 'check' };
const effortIcon: Record<Effort, FeatureIconName> = { low: 'leaf', medium: 'bars', high: 'spark' };
const effortLabel: Record<Effort, string> = Object.fromEntries(
  (steps.find((s) => s.id === 'effort')?.options ?? []).map((o) => [o.value, o.label]),
) as Record<Effort, string>;

export function GoalsFlow() {
  const router = useRouter();
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
    const r = store.load(START_DRAFT_KEY);
    setAnswers(r.answers);
    setStep(r.step);
    if (r.step !== 'review') setText(answerText(r.answers, r.step));
    setNotice(r.status === 'empty' ? null : r);
    setReady(true);
  }, [store]);

  const remember = (at: DraftStep, a: Answers) => {
    const r = store.save(START_DRAFT_KEY, at, a);
    setSaved(r.ok ? 'Saved on this device.' : r.message);
  };

  function go(next: DraftStep, a: Answers) {
    setStep(next);
    setError('');
    setKept(false);
    setNotice(null); // the welcome-back note has done its job once the person moves on
    setText(next === 'review' ? '' : answerText(a, next));
    remember(next, a);
    queueMicrotask(() => heading.current?.focus());
  }

  function change(id: StepId, value: string) {
    setText(value);
    setError('');
    const r = parseStepText(id, value);
    if (r.ok) {
      const { answers: a } = setAnswer(answers, id, r.value);
      setAnswers(a);
      remember(id, a);
      setKept(false);
    } else {
      setSaved('');
      setKept(isAnswered(answers, id));
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

  function back() {
    const i = step === 'review' ? stepIds.length : stepIds.indexOf(step);
    if (i > 0) go(stepIds[i - 1], answers);
    else router.push(startRoutes.tour);
  }

  function startAgain() {
    store.clear(START_DRAFT_KEY);
    setAnswers({});
    setNotice(null);
    setSaved('');
    setKept(false);
    setStep('budget');
    setError('');
    setText('');
    queueMicrotask(() => heading.current?.focus());
  }

  const info = step === 'review' ? null : steps.find((s) => s.id === step) ?? null;
  const index = step === 'review' ? stepIds.length : stepIds.indexOf(step);
  const profile = toProfile(answers);
  const header = <OnboardingHeader onBack={back} backLabel={index === 0 ? 'Back to the overview' : 'Previous question'} step={flowStepNumber('goals')} totalSteps={flowTotal} />;
  const status = <p className="plg-note start-saved" role="status" aria-live="polite">{kept ? 'That entry is not valid yet, so your last valid answer is kept.' : saved}</p>;

  if (!ready) {
    return (
      <OnboardingLayout align="end" header={header}>
        <p className="plg-lede" role="status">Loading your saved answers…</p>
      </OnboardingLayout>
    );
  }

  const resume = notice ? (
    <GlassSurface tone="raised" padding="compact" role="status" className="start-notice">
      <div className="start-notice-body">
        <GlassIcon name="info" />
        <div className="plg-stack" data-gap="1">
          <p>{notice.message}{notice.needsReentry.length ? ` Please enter again: ${notice.needsReentry.join(', ')}.` : ''}</p>
          <p><button type="button" className="plg-link" data-target="large" onClick={startAgain}>Start again</button></p>
        </div>
      </div>
    </GlassSurface>
  ) : null;

  if (info) {
    const isLast = index === stepIds.length - 1;
    const submit = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); next(info.id); };
    return (
      <OnboardingLayout
        align="end"
        header={header}
        footer={
          <>
            <GlassButton variant="primary" icon={<GlassIcon name="spark" size={22} tone="deep" />} aria-describedby="start-goal-count" onClick={() => next(info.id)}>
              {isLast ? 'Review my answers' : 'Next'}
            </GlassButton>
            {status}
          </>
        }
      >
        {resume}
        <form className="plg-stack" data-gap="4" onSubmit={submit} noValidate>
          <div className="plg-stack" data-gap="2">
            <p className="plg-eyebrow" id="start-goal-count">Question {index + 1} of {stepIds.length}</p>
            <h1 className="plg-title" ref={heading} tabIndex={-1}>{info.question}</h1>
          </div>
          {info.kind === 'choice' ? (
            <>
              <FeatureTileGroup<Effort>
                legend={info.question}
                legendHidden
                name="effort"
                layout="list"
                value={(text as Effort) || ''}
                onChange={(v) => change(info.id, v)}
                aria-describedby={error ? 'start-goal-hint start-goal-error' : 'start-goal-hint'}
                invalid={Boolean(error)}
                options={(info.options ?? []).map((o) => ({
                  value: o.value,
                  title: o.label,
                  detail: o.detail,
                  icon: (selected: boolean) => <GlassIcon name={effortIcon[o.value]} size={36} tone={selected ? 'pearl' : 'gradient'} />,
                }))}
              />
              <p className="plg-note" id="start-goal-hint">{info.hint}</p>
              {error ? <p className="plg-field-error" id="start-goal-error" role="alert">{error}</p> : null}
            </>
          ) : (
            <GlassField
              key={info.id}
              label={`${info.title}${info.optional ? ' (optional)' : ''}`}
              name={info.id}
              value={text}
              onChange={(e) => change(info.id, e.target.value)}
              inputMode={info.kind === 'list' ? 'text' : info.kind === 'money' ? 'decimal' : 'numeric'}
              autoComplete="off"
              enterKeyHint="next"
              placeholder={info.id === 'budget' ? 'e.g. 250' : info.id === 'hours' ? 'e.g. 5' : info.id === 'interests' ? 'pets, home decor' : 'writing, design'}
              icon={<GlassIcon name={fieldIcon[info.id]} />}
              hint={info.hint}
              error={error || undefined}
            />
          )}
        </form>
      </OnboardingLayout>
    );
  }

  return (
    <OnboardingLayout
      align="end"
      header={header}
      footer={
        <>
          {profile.ok ? (
            <GlassButton variant="primary" href={startRoutes.about} icon={<GlassIcon name="spark" size={22} tone="deep" />}>Next: a few more details</GlassButton>
          ) : (
            <GlassButton variant="primary" onClick={() => go(profile.missing[0], answers)}>Finish the missing answers</GlassButton>
          )}
          <GlassButton variant="secondary" onClick={startAgain}>Start again</GlassButton>
          {status}
        </>
      }
    >
      {resume}
      <div className="plg-stack" data-gap="2">
        <p className="plg-eyebrow">All {stepIds.length} questions answered</p>
        <h1 className="plg-title" ref={heading} tabIndex={-1}>Check your answers</h1>
        <p className="plg-lede">Next you will see business ideas scored against these answers. They are suggestions to research, not income forecasts.</p>
      </div>
      {profile.ok ? (
        <GlassSurface tone="raised" padding="none" as="dl" className="start-summary">
          {([
            ['budget', 'Budget', formatAud(profile.profile.budgetMinor)],
            ['hours', 'Hours a week', String(profile.profile.weeklyHours)],
            ['interests', 'Interests', profile.profile.interests.join(', ')],
            ['skills', 'Skills', profile.profile.skills.length ? profile.profile.skills.join(', ') : 'None yet'],
            ['effort', 'Effort', effortLabel[profile.profile.preferredEffort as Effort] ?? profile.profile.preferredEffort],
          ] as const).map(([id, label, value]) => (
            <div className="start-summary-row" key={id}>
              <dt>{label}</dt>
              <dd>{value}</dd>
              <dd className="start-summary-action">
                <button type="button" className="plg-link" data-target="large" aria-label={`Change ${label.toLowerCase()}`} onClick={() => go(id, answers)}>Change</button>
              </dd>
            </div>
          ))}
        </GlassSurface>
      ) : (
        <p className="plg-field-error" role="alert">Still to answer: {profile.missing.join(', ')}.</p>
      )}
    </OnboardingLayout>
  );
}
