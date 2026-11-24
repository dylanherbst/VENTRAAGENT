'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { track } from '../../../lib/aimp/analytics';
import type { BusinessModel } from '../../../lib/aimp/contracts';
import { getBlueprint } from '../../../lib/aimp/preview/blueprints';
import { generatePreview } from '../../../lib/aimp/preview/generate';
import { ChooseStep } from './choose-step';
import { IconCheck } from './icons';
import { LaunchStep } from './launch-step';
import { PreviewStep } from './preview-step';
import { flowQuery, parseFlowState, steps, type FlowState, type PlanId, type Step } from './state';

const stepLabels: Record<Step, string> = { choose: 'Choose', preview: 'Preview', launch: 'Launch' };

export function BuildFlow({ initial }: { initial: FlowState }) {
  const [state, setState] = useState<FlowState>(initial);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const lastStep = useRef<Step>(initial.step);

  const update = (patch: Partial<FlowState>, mode: 'push' | 'replace' = 'replace') => {
    const next = { ...state, ...patch };
    setState(next);
    const url = `${window.location.pathname}${flowQuery(next)}`;
    if (mode === 'push') window.history.pushState(null, '', url);
    else window.history.replaceState(null, '', url);
  };

  // Browser back/forward moves between steps.
  useEffect(() => {
    const onPop = () => {
      const q = new URLSearchParams(window.location.search);
      setState(parseFlowState((k) => q.get(k)));
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // On a step change: move focus to the new heading, return to the top, and record the launch view.
  useEffect(() => {
    if (state.step === lastStep.current) return;
    lastStep.current = state.step;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    headingRef.current?.focus({ preventScroll: true });
    if (state.step === 'launch') track('launch_view');
  }, [state.step]);
  useEffect(() => { if (initial.step === 'launch') track('launch_view'); }, [initial.step]);

  const preview = useMemo(
    () => (state.model && state.niche ? generatePreview({ model: state.model, niche: state.niche, seed: state.seed }) : null),
    [state.model, state.niche, state.seed],
  );

  const ready = Boolean(preview);
  const currentIndex = steps.indexOf(state.step);
  const goTo = (step: Step) => update({ step }, 'push');

  const anotherNiche = () => {
    if (!state.model || !state.niche) return;
    const niches = getBlueprint(state.model).niches;
    const i = niches.findIndex((n) => n.id === state.niche);
    update({ niche: niches[(i + 1) % niches.length].id, seed: 0 });
  };

  return (
    <main className="bp-main">
      <div className="bp-wrap">
        <nav className="bp-steps" aria-label="Progress">
          <ol>
            {steps.map((s, i) => {
              const current = s === state.step;
              const done = i < currentIndex;
              const reachable = !current && (s === 'choose' || ready);
              const inner = (
                <>
                  <span className="bp-step-dot" aria-hidden="true">{done ? <IconCheck size={14} /> : i + 1}</span>
                  <span className="bp-step-name">{stepLabels[s]}</span>
                  {done ? <span className="bp-sr"> (done)</span> : null}
                </>
              );
              return (
                <li key={s} className={`bp-step${current ? ' is-current' : ''}${done ? ' is-done' : ''}`}>
                  {reachable
                    ? <button type="button" onClick={() => goTo(s)}>{inner}</button>
                    : <span className="bp-step-static" aria-current={current ? 'step' : undefined}>{inner}</span>}
                </li>
              );
            })}
          </ol>
        </nav>

        <div key={state.step} className="bp-stage">
          {state.step === 'choose' || !preview ? (
            <ChooseStep
              headingRef={headingRef}
              model={state.model}
              niche={state.niche}
              onModel={(model: BusinessModel) => update({ model, niche: state.model === model ? state.niche : null, seed: 0 })}
              onNiche={(niche) => update({ niche, seed: 0 })}
              onRecommended={(model, niche) => update({ model, niche, seed: 0 })}
              onContinue={() => {
                if (!state.model || !state.niche) return;
                track('preview_start', { model: state.model, niche: state.niche });
                goTo('preview');
              }}
            />
          ) : state.step === 'preview' ? (
            <PreviewStep
              key={`${state.model}-${state.niche}-${state.seed}`}
              headingRef={headingRef}
              preview={preview}
              onBack={() => goTo('choose')}
              onAnotherName={() => update({ seed: state.seed + 1 })}
              onAnotherNiche={anotherNiche}
              onLaunch={() => goTo('launch')}
            />
          ) : (
            <LaunchStep
              headingRef={headingRef}
              preview={preview}
              plan={state.plan}
              onPlan={(plan: PlanId) => { track('plan_select', { plan }); update({ plan }); }}
              onBack={() => goTo('preview')}
            />
          )}
        </div>
      </div>
    </main>
  );
}
