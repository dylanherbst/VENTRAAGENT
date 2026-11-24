'use client';

import { useRef, useState, type RefObject } from 'react';
import { track } from '../../../lib/aimp/analytics';
import type { BusinessModel } from '../../../lib/aimp/contracts';
import { blueprints, findNiche, getBlueprint } from '../../../lib/aimp/preview/blueprints';
import {
  budgetOptions, hoursOptions, interestOptions, recommend,
  type Budget, type Interest, type Recommendation, type WeeklyHours,
} from '../../../lib/aimp/preview/recommend';
import { IconArrowRight, IconCheck, IconCompass, modelIcons } from './icons';

type Props = {
  headingRef: RefObject<HTMLHeadingElement | null>;
  model: BusinessModel | null;
  niche: string | null;
  onModel: (model: BusinessModel) => void;
  onNiche: (niche: string) => void;
  onRecommended: (model: BusinessModel, niche: string) => void;
  onContinue: () => void;
};

const budgetLabels: Record<Budget, string> = { '<$50': 'Under A$50', '$50–200': 'A$50–200', '$200+': 'A$200+' };
const hoursLabels: Record<WeeklyHours, string> = { '1–3': '1–3 hours', '4–8': '4–8 hours', '8+': '8+ hours' };
const interestLabels: Record<Interest, string> = {
  'organising & productivity': 'Organising & productivity', 'art & design': 'Art & design',
  'family & gifts': 'Family & gifts', 'business & marketing': 'Business & marketing',
};

function Taps<T extends string>({ legend, options, labels, value, onPick }: {
  legend: string; options: readonly T[]; labels: Record<T, string>; value: T | undefined; onPick: (v: T) => void;
}) {
  return (
    <fieldset className="bp-taps">
      <legend>{legend}</legend>
      <div className="bp-taps-row">
        {options.map((o) => (
          <button key={o} type="button" className="bp-tap" aria-pressed={value === o} onClick={() => onPick(o)}>
            {value === o ? <IconCheck size={16} /> : null}{labels[o]}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function ChooseStep({ headingRef, model, niche, onModel, onNiche, onRecommended, onContinue }: Props) {
  const [forMe, setForMe] = useState(false);
  const [budget, setBudget] = useState<Budget>();
  const [hours, setHours] = useState<WeeklyHours>();
  const [interest, setInterest] = useState<Interest>();
  const continueRef = useRef<HTMLButtonElement>(null);
  const nichesRef = useRef<HTMLDivElement>(null);

  const rec: Recommendation | null = budget && hours && interest ? recommend({ budget, hours, interest }) : null;
  const answer = <T,>(set: (v: T) => void, key: 'budget' | 'hours' | 'interest') => (v: T) => {
    set(v);
    const next = { budget, hours, interest, [key]: v };
    if (next.budget && next.hours && next.interest) track('recommend_request', { budget: next.budget, hours: next.hours, interest: next.interest } as Record<string, string>);
  };

  const pickModel = (id: BusinessModel) => {
    setForMe(false);
    track('model_select', { model: id });
    onModel(id);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    requestAnimationFrame(() => nichesRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'nearest' }));
  };

  const useRecommendation = () => {
    if (!rec) return;
    track('model_select', { model: rec.model, via: 'recommendation' });
    onRecommended(rec.model, rec.niche);
    setForMe(false);
    requestAnimationFrame(() => continueRef.current?.focus());
  };

  const blueprint = model ? getBlueprint(model) : null;
  const selectedNiche = model && niche ? findNiche(model, niche) : undefined;
  const recBlueprint = rec ? getBlueprint(rec.model) : null;
  const recNiche = rec ? findNiche(rec.model, rec.niche) : undefined;

  return (
    <section className="bp-step-body" aria-labelledby="bp-choose-h">
      <h1 id="bp-choose-h" ref={headingRef} tabIndex={-1}>What kind of business would you like to start?</h1>
      <p className="bp-lead">Pick a business model and we will put together a working sample: name, products, store, pricing and marketing. No signup needed.</p>

      <div className="bp-models" role="group" aria-label="Business models">
        {blueprints.map((b) => {
          const Icon = modelIcons[b.id];
          const selected = !forMe && model === b.id;
          return (
            <button key={b.id} type="button" className="bp-choice bp-model" aria-pressed={selected} onClick={() => pickModel(b.id)}>
              <span className="bp-model-icon"><Icon size={22} /></span>
              <span className="bp-choice-title">{b.title}</span>
              <span className="bp-choice-text">{b.description}</span>
              <span className="bp-choice-meta">For example: {b.exampleProducts.join(' · ')}</span>
              {selected ? <span className="bp-tick" aria-hidden="true"><IconCheck size={16} /></span> : null}
            </button>
          );
        })}
        <button type="button" className="bp-choice bp-forme" aria-pressed={forMe} aria-controls="bp-forme-panel" onClick={() => setForMe(true)}>
          <span className="bp-model-icon"><IconCompass size={22} /></span>
          <span>
            <span className="bp-choice-title">Choose for me</span>
            <span className="bp-choice-text">Answer three quick taps about budget, time and interests and get one recommendation.</span>
          </span>
          {forMe ? <span className="bp-tick" aria-hidden="true"><IconCheck size={16} /></span> : null}
        </button>
      </div>

      {forMe ? (
        <div id="bp-forme-panel" className="bp-panel">
          <h2>Three quick taps</h2>
          <Taps legend="Budget to start" options={budgetOptions} labels={budgetLabels} value={budget} onPick={answer(setBudget, 'budget')} />
          <Taps legend="Hours a week" options={hoursOptions} labels={hoursLabels} value={hours} onPick={answer(setHours, 'hours')} />
          <Taps legend="What interests you most" options={interestOptions} labels={interestLabels} value={interest} onPick={answer(setInterest, 'interest')} />
          <div aria-live="polite">
            {rec && recBlueprint && recNiche ? (
              <div className="bp-rec">
                <h3>{recNiche.label}</h3>
                <p className="bp-rec-model">{recBlueprint.title}</p>
                <p>{rec.reason}</p>
                <button type="button" className="amp-btn amp-btn-primary" onClick={useRecommendation}>Use this</button>
              </div>
            ) : (
              <p className="bp-muted">Answer all three to see your recommendation.</p>
            )}
          </div>
        </div>
      ) : null}

      {!forMe && blueprint ? (
        <div className="bp-niches" ref={nichesRef} role="group" aria-labelledby="bp-niche-h">
          <h2 id="bp-niche-h">Pick a niche for {blueprint.title.toLowerCase()}</h2>
          <div className="bp-niche-grid">
            {blueprint.niches.map((n) => {
              const selected = niche === n.id;
              return (
                <button key={n.id} type="button" className="bp-choice bp-niche" aria-pressed={selected} onClick={() => onNiche(n.id)}>
                  <span className="bp-choice-title">{n.label}</span>
                  <span className="bp-choice-text">{n.audience}</span>
                  {selected ? <span className="bp-tick" aria-hidden="true"><IconCheck size={16} /></span> : null}
                </button>
              );
            })}
          </div>
          <p className="bp-small bp-muted">{blueprint.startupCost} {blueprint.weeklyHours}</p>
        </div>
      ) : null}

      <div className="bp-actionbar">
        <p className="bp-actionbar-text" aria-live="polite">
          {selectedNiche && blueprint ? <><strong>{selectedNiche.label}</strong><span className="bp-muted"> · {blueprint.title}</span></> : <span className="bp-muted">Choose a model and a niche to continue</span>}
        </p>
        <button ref={continueRef} type="button" className="amp-btn amp-btn-primary" disabled={!selectedNiche} onClick={onContinue}>
          Show my preview <IconArrowRight size={18} />
        </button>
      </div>
    </section>
  );
}
