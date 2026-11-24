'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { generatePreview, money, previewLabel } from '../../lib/aimp/preview/generate';
import { blueprints } from '../../lib/aimp/preview/blueprints';
import { site } from '../../lib/aimp/site-config';
import { track } from '../../lib/aimp/analytics';
import { Cover } from '../s/[store]/_ui/parts';
import '../s/[store]/store.css';

const steps = ['Choose', 'Preview', 'Launch'] as const;
const MODEL = 'digital-templates' as const;
const NICHE = 'teacher-planners';

/**
 * The real preview generator, run for one sample request and shown in three steps. The visitor steps through it or
 * presses Play (never autoplays). Under reduced motion the steps change without transitions.
 */
export function WatchDemo() {
  const preview = useMemo(() => generatePreview({ model: MODEL, niche: NICHE, seed: 0 }), []);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!playing) return;
    timer.current = window.setTimeout(() => {
      if (step < steps.length - 1) setStep(step + 1); else setPlaying(false);
    }, 3200);
    return () => window.clearTimeout(timer.current);
  }, [playing, step]);

  const go = (i: number) => { setPlaying(false); setStep(i); };
  const play = () => { track('preview_start', { source: 'watch_demo' }); if (step === steps.length - 1) setStep(0); setPlaying(true); };

  return (
    <div className="amp-demo">
      <div className="amp-demo-bar">
        <div role="tablist" aria-label="Demo steps" className="amp-demo-tabs">
          {steps.map((s, i) => (
            <button key={s} role="tab" type="button" aria-selected={step === i} aria-controls={`demo-${i}`} id={`demo-tab-${i}`} onClick={() => go(i)}>
              <span aria-hidden="true">{i + 1}</span>{s}
            </button>
          ))}
        </div>
        <button type="button" className="amp-btn amp-btn-secondary amp-btn-sm" onClick={playing ? () => setPlaying(false) : play} aria-pressed={playing}>
          {playing ? 'Pause' : step === steps.length - 1 ? 'Replay' : 'Play'}
        </button>
      </div>

      <div className="amp-demo-panel" role="tabpanel" id={`demo-${step}`} aria-labelledby={`demo-tab-${step}`} key={step}>
        {step === 0 ? (
          <div className="amp-demo-choose">
            <p className="amp-demo-say">“I have about four hours a week and I like getting organised.”</p>
            <ul>
              {blueprints.map((b) => (
                <li key={b.id} className={b.id === MODEL ? 'is-on' : undefined}>
                  <strong>{b.title}</strong><span>{b.exampleProducts.slice(0, 2).join(', ')}</span>
                </li>
              ))}
            </ul>
            <p className="amp-demo-out">Recommended: <strong>{preview.model.title}</strong> for <strong>{preview.niche.label.toLowerCase()}</strong>. {preview.niche.audience}</p>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="amp-demo-preview">
            <div className="amp-demo-brand">
              <p className="amp-demo-name">{preview.brand.name}</p>
              <p className="amp-demo-tagline">{preview.brand.tagline}</p>
              <p className="amp-demo-offer">{preview.offer.summary}</p>
              <p className="amp-demo-price">Launch price {money(preview.pricing.launchPriceMinor)} · range {money(preview.pricing.lowMinor)}–{money(preview.pricing.highMinor)}</p>
            </div>
            <ul className="amp-demo-products st" style={{ ['--st-soft' as string]: '#efeafc', ['--st-surface' as string]: '#fff', ['--st-line' as string]: '#e4dff0', ['--st-ink' as string]: '#1c1a24', ['--st-accent' as string]: '#8b6fe0', ['--st-font' as string]: 'var(--amp-display)' }}>
              {preview.products.slice(0, 4).map((p) => (
                <li key={p.slug}><Cover style={p.cover.style} label={p.cover.label} /><span>{p.title}</span><em>{money(p.priceMinor)}</em></li>
              ))}
            </ul>
            <ul className="amp-demo-pins">
              {preview.marketing.pins.map((pin) => <li key={pin.title}><strong>Pinterest</strong>{pin.title}</li>)}
            </ul>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="amp-demo-launch">
            <div>
              <h3>Before anything goes live, you approve:</h3>
              <ul className="amp-demo-checks">
                <li>The business and the name {preview.brand.name}</li>
                <li>The first {preview.products.length} products</li>
                <li>Publishing the store</li>
                <li>Each Pinterest campaign</li>
              </ul>
            </div>
            <div>
              <h3>You connect:</h3>
              <ul className="amp-demo-checks">
                <li>Your Stripe account, for payouts</li>
                <li>A Pinterest business account</li>
              </ul>
              <p className="amp-demo-price">From A${site.plans[1].priceAud}/month during the pilot. Cancel any time.</p>
            </div>
          </div>
        ) : null}
      </div>
      <div className="amp-demo-foot">
        <p className="amp-note">{previewLabel}.</p>
        <a className="amp-btn amp-btn-primary" href={`/plant-lab/build?model=${MODEL}`} onClick={() => track('cta_click', { cta: 'watch_try' })}>Try it with your own answers</a>
      </div>
    </div>
  );
}
