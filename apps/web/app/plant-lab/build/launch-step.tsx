'use client';

import type { RefObject } from 'react';
import { track } from '../../../lib/aimp/analytics';
import type { Preview } from '../../../lib/aimp/preview/generate';
import { signupHref } from '../../../lib/aimp/plant/handoff';
import { site } from '../../../lib/aimp/site-config';
import { IconArrowLeft, IconArrowRight, IconCheck, IconCheckCircle, IconClock, IconLink } from './icons';
import { recommendedPlan, type PlanId } from './state';

type Props = {
  headingRef: RefObject<HTMLHeadingElement | null>;
  preview: Preview;
  plan: PlanId;
  onPlan: (plan: PlanId) => void;
  onBack: () => void;
};

const connections = [
  { title: 'Stripe account for payouts', body: 'Sales are paid to your own Stripe account. Stripe checks your identity, not us.' },
  { title: 'Pinterest business account', body: 'Used to publish the pins you approve. Free to set up.' },
  { title: 'Custom domain (optional, later)', body: 'Your store starts on a free address; add your own domain whenever you like.' },
];
const approvals = ['Your business and brand', 'The first products', 'Publishing the store', 'Each marketing campaign', 'Any spending'];

export function LaunchStep({ headingRef, preview, plan, onPlan, onBack }: Props) {
  const chosen = site.plans.find((x) => x.id === plan) ?? site.plans[1];
  const signupLink = signupHref({ model: preview.model.id, niche: preview.niche.id, seed: preview.seed, plan: chosen.id });
  const subject = `Pilot: ${preview.model.title} – ${preview.niche.label} (${preview.brand.name})`;
  const mailto = `mailto:${site.supportEmail}?subject=${encodeURIComponent(subject)}`;

  return (
    <section className="bp-step-body" aria-labelledby="bp-launch-h">
      <button type="button" className="bp-back" onClick={onBack}><IconArrowLeft size={18} /> Back to preview</button>
      <h1 id="bp-launch-h" ref={headingRef} tabIndex={-1}>Save and launch {preview.brand.name}</h1>
      <p className="bp-lead">Choose a plan, see what you will connect and what you stay in control of. No surprises later.</p>

      <div className="bp-pricing-labels">
        <span className="bp-pill">Pilot pricing — being validated, cancel any time</span>
        <span className="bp-pill bp-pill-quiet">Prices in AUD incl. GST</span>
      </div>

      <div className="bp-plans" role="group" aria-label="Plans">
        {site.plans.map((pl) => {
          const selected = pl.id === plan;
          return (
            <button key={pl.id} type="button" className="bp-choice bp-plan" aria-pressed={selected} onClick={() => onPlan(pl.id)}>
              <span className="bp-plan-head">
                <span className="bp-choice-title">{pl.name}</span>
                {pl.id === recommendedPlan ? <span className="bp-badge">Recommended</span> : null}
              </span>
              <span className="bp-plan-price">
                {pl.priceAud === 0 ? 'Free' : <>A${pl.priceAud}<span className="bp-plan-per"> / month</span></>}
              </span>
              <span className="bp-choice-text">{pl.blurb}</span>
              <span className="bp-plan-list">
                {pl.includes.map((inc) => <span key={inc} className="bp-plan-li"><IconCheck size={16} />{inc}</span>)}
              </span>
              {selected ? <span className="bp-tick" aria-hidden="true"><IconCheck size={16} /></span> : null}
            </button>
          );
        })}
      </div>

      <div className="bp-columns">
        <section aria-labelledby="bp-connect-h">
          <h2 id="bp-connect-h">What you’ll connect</h2>
          <ul className="bp-list">
            {connections.map((c) => (
              <li key={c.title}><IconLink size={20} /><span><strong>{c.title}</strong><span className="bp-muted">{c.body}</span></span></li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="bp-approve-h">
          <h2 id="bp-approve-h">What needs your approval</h2>
          <ul className="bp-list">
            {approvals.map((a) => <li key={a}><IconCheckCircle size={20} /><span><strong>{a}</strong></span></li>)}
          </ul>
          <p className="bp-small bp-muted">Nothing is published, posted or paid for without your yes.</p>
        </section>
      </div>

      <div className="bp-status" role="note">
        <IconClock size={22} />
        <p><strong>Honest status:</strong> Checkout and automatic delivery are in final testing; we’re onboarding a small pilot group first.</p>
      </div>

      <div className="bp-actionbar bp-actionbar-end">
        <p className="bp-actionbar-text">
          <strong>{chosen.name}</strong>
          <span className="bp-muted"> · {chosen.priceAud === 0 ? 'Free' : `A$${chosen.priceAud} a month`}. This sample is not stored yet; you will confirm your business during setup.</span>
        </p>
        <div className="bp-actions">
          <a className="amp-btn amp-btn-primary" href={signupLink} onClick={() => track('signup_click', { plan: chosen.id })}>
            Save &amp; Launch My Business <IconArrowRight size={18} />
          </a>
          <a className="amp-btn amp-btn-secondary" href={mailto}>Join the pilot</a>
        </div>
      </div>
    </section>
  );
}
