import type { Metadata } from 'next';
import { site } from '../../lib/aimp/site-config';
import { blueprints } from '../../lib/aimp/preview/blueprints';
import { StoryCanvas } from './_scene/story-canvas';
import { WatchDemo } from './watch-demo';
import { TrackedLink } from './tracked-link';
import { HeroHeadline } from './hero-headline';
import './tokens.css';
import './plant.css';
import { fontVars } from './fonts';
import { primaryEntry } from '../../lib/aimp/entry';
import { planButton, sitePages } from '../../lib/aimp/plant/site-pages';


export const metadata: Metadata = {
  title: `${site.name} · Build a business from the AI boom`,
  description: 'Turn an idea into an online business with AI building your offer, website and marketing, and helping automate the work that follows.',
  robots: { index: false, follow: false }, // lab route until approved for the homepage
};

const BUILD = '/plant-lab/build';

/** Authored stills of the live scene (captured from the same three.js render) for first paint, no-JS and reduced motion. */
function Still({ stage, alt }: { stage: string; alt: string }) {
  return (
    <picture className="amp-still">
      <source media="(max-width: 899px)" srcSet={`/plant/stage-${stage}-mobile.webp`} />
      <img src={`/plant/stage-${stage}-desktop.webp`} alt={alt} loading={stage === 'seed' ? 'eager' : 'lazy'} decoding="async" />
    </picture>
  );
}

function Check() {
  return <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" className="amp-icon"><path d="M4.5 10.5l3.5 3.5 7.5-8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

const after = [
  { title: 'Your store goes live', body: 'A branded storefront on its own web address, with product pages, policies and a contact page.', status: 'Live now' },
  { title: 'Payments go to you', body: 'Customers pay through Stripe straight into your own account. You complete Stripe’s identity check yourself.', status: 'In pilot' },
  { title: 'Orders deliver themselves', body: 'Once a payment is confirmed, the buyer gets a secure download link by email. Exactly once, every time.', status: 'In pilot' },
  { title: 'Marketing runs on schedule', body: 'Pinterest posts you have approved go out on a schedule you set. Pause any time.', status: 'Coming soon' },
];

const faqs = [
  { q: 'Do I need technical or design skills?', a: 'No. You make the decisions: which business, which name, which products, when to publish. The platform does the setup work: product files, store pages, checkout and scheduling.' },
  { q: 'Will this make me money?', a: 'We can’t promise that, and nobody honest can. We help you start and run a low-cost business with far less work. Sales depend on your niche, your products and your marketing. We show you real numbers as they come in, never estimates dressed up as results.' },
  { q: 'What does it cost to start?', a: 'The preview is free. Paid plans start at A$79 a month during the pilot, and you can cancel any time. Stripe charges card fees per sale (about 1.65% + 30c for Australian cards). Custom domains and any advertising are optional extras.' },
  { q: 'Who owns the store and products?', a: 'You do. The products are made for your business, payments go to your Stripe account, and you can export your files.' },
  { q: 'What happens before anything goes public?', a: 'Nothing is published, posted or charged without your approval. You review the brand, the first products, the store and every marketing campaign first.' },
];

export default function PlantLabHome() {
  const featured = blueprints;
  return (
    <div className={`amp amp-home ${fontVars}`}>
      <a className="amp-skip" href="#how">Skip animation</a>
      <a className="amp-skip" href="#main">Skip to content</a>
      <header className="amp-header">
        <div className="amp-wrap amp-header-inner">
          <a className="amp-logo" href="/plant-lab" aria-label={`${site.name} home`}>
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 21c0-5 0-8 4.5-12.5C18.5 6.5 20 6 21 6c0 1-.5 2.5-2.5 4.5C14 15 12 16 12 21Zm0 0c0-3.5-1-6-4-8.5C6.5 11.3 5 11 4 11c0 1 .4 2.3 2 3.8C8.6 17.4 12 18 12 21Z" fill="currentColor" /></svg>
            {site.name}
          </a>
          <nav className="amp-nav" aria-label="Main">
            <a href="#how">How it works</a>
            <a href="#build">What you can build</a>
            <a href="#pricing">Pricing</a>
            <a href="#faq">FAQ</a>
          </nav>
          <TrackedLink className="amp-btn amp-btn-primary amp-btn-sm" href={primaryEntry.href} event={{ cta: 'header' }}>{primaryEntry.label}</TrackedLink>
        </div>
      </header>

      <main id="main">
        <section id="story" className="amp-story" aria-label="From seed to business">
          <div className="amp-stage" aria-hidden="true">
            <Still stage="seed" alt="" />
            <StoryCanvas storyId="story" />
            <div className="amp-cue"><span>Scroll to grow</span><i /></div>
          </div>

          <div className="amp-chapter amp-chapter-hero" data-chapter="potential">
            <Still stage="seed" alt="A floating white seed with a glowing lavender glass core" />
            <div className="amp-wrap amp-chapter-inner">
              <div className="amp-copy">
                <p className="amp-eyebrow">The next wave of online business</p>
                <HeroHeadline control="Your 6-figure business is just a few clicks away." />
                <p className="amp-lead">No coding. No complicated setup. Just choose an idea and our AI will build your online business from start to launch, with our niche and product finder guided by our Profitability Calculator.</p>
                <p className="amp-journey">Your journey from 9–5 to financial freedom starts here…</p>
                <div className="amp-actions">
                  <TrackedLink className="amp-btn amp-btn-primary" href={primaryEntry.href} event={{ cta: 'hero_primary' }}>{primaryEntry.label}</TrackedLink>
                  <TrackedLink className="amp-btn amp-btn-secondary" href="#watch" event={{ cta: 'hero_secondary' }}>Watch AI Build a Business</TrackedLink>
                </div>
                <p className="amp-reassure">Simple setup. Guided launch. You stay in control.</p>
                <ul className="amp-facts" aria-label="Side hustles and online stores">
                  <li><strong>40%</strong> of side hustlers want to turn theirs into a full-time business</li>
                  <li><strong>Top 25%</strong> of established online stores bring in <strong>US$59,000+</strong> a month in revenue</li>
                  <li>On average, established online stores bring in <strong>US$258,000</strong> a year in revenue</li>
                </ul>
                <p className="amp-source">Full-time goal: QuickBooks 2026 Entrepreneurship Study, 3,000 US adults, December 2025. Store revenue: profitable e-commerce businesses 3+ years old listed for sale on Flippa, 2022–2024 (revenue, not profit). These are market figures, not {site.name} customer results or a promise of earnings.</p>
              </div>
            </div>
          </div>

          <div className="amp-chapter" data-chapter="foundation">
            <Still stage="planted" alt="The seed planted in a soft white landscape" />
            <div className="amp-wrap amp-chapter-inner">
              <div className="amp-copy">
                <h2 className="amp-h2">Your idea. A complete business in the making.</h2>
                <p className="amp-lead">Tell us your budget, your spare hours and what you enjoy. You get researched business ideas with their costs and assumptions shown, then you pick the one that fits.</p>
                <TrackedLink className="amp-btn amp-btn-secondary" href="#how" event={{ cta: 'stage_foundation' }}>See How It Works</TrackedLink>
              </div>
            </div>
          </div>

          <div className="amp-chapter" data-chapter="creation">
            <Still stage="sprout" alt="A lavender glass sprout with two leaves" />
            <div className="amp-wrap amp-chapter-inner">
              <div className="amp-copy">
                <h2 className="amp-h2">Built to launch. Designed to sell.</h2>
                <p className="amp-lead">Real, downloadable products. A branded store on its own web address. Checkout into your own Stripe account. You approve all of it before it goes live.</p>
                <TrackedLink className="amp-btn amp-btn-primary" href={primaryEntry.href} event={{ cta: 'stage_creation' }}>{primaryEntry.label}</TrackedLink>
              </div>
            </div>
          </div>

          <div className="amp-chapter" data-chapter="growth">
            <Still stage="tree" alt="A luminous three-leaf glass tree" />
            <div className="amp-wrap amp-chapter-inner">
              <div className="amp-copy">
                <h2 className="amp-h2">Build once. Automate what comes next.</h2>
                <p className="amp-lead">Paid orders deliver themselves. Approved posts go out on schedule. A daily check tells you what needs your attention, and you can pause anything.</p>
                <TrackedLink className="amp-btn amp-btn-primary" href={primaryEntry.href} event={{ cta: 'stage_growth' }}>{primaryEntry.label}</TrackedLink>
                <p className="amp-note">Checkout and automatic delivery are in pilot testing with a small group first. Scheduled posting and daily checks are planned and not available yet.</p>
              </div>
            </div>
          </div>
        </section>

        <section id="watch" className="amp-section amp-watch" aria-labelledby="watch-h">
          <div className="amp-wrap">
            <div className="amp-section-head">
              <h2 id="watch-h" className="amp-h2">Watch AI build a business</h2>
              <p className="amp-lead">This is the real preview builder running one request, not a video. Step through it, or try your own.</p>
            </div>
            <WatchDemo />
          </div>
        </section>

        <section id="how" className="amp-section" aria-labelledby="how-h">
          <div className="amp-wrap amp-how">
            <div className="amp-section-head">
              <h2 id="how-h" className="amp-h2">Two clicks to see your business</h2>
              <p className="amp-lead">No long forms first. See what you would get, then decide.</p>
            </div>
            <ol className="amp-steps">
              <li>
                <span className="amp-step-n" aria-hidden="true">1</span>
                <h3>Choose a business</h3>
                <p>Pick a business model, or answer three quick questions and let AI recommend one.</p>
              </li>
              <li>
                <span className="amp-step-n" aria-hidden="true">2</span>
                <h3>See a working preview</h3>
                <p>A sample business with its name, products, store design, pricing and first marketing posts.</p>
              </li>
              <li>
                <span className="amp-step-n" aria-hidden="true">3</span>
                <h3>Save and launch</h3>
                <p>See the real price, what you will connect and what needs your approval. Then sign up.</p>
              </li>
            </ol>
            <div className="amp-after">
              <h3 className="amp-h3">After you launch</h3>
              <ul>
                {after.map((a) => (
                  <li key={a.title}>
                    <div><strong>{a.title}</strong><p>{a.body}</p></div>
                    <span className={`amp-status amp-status-${a.status === 'Live now' ? 'live' : a.status === 'In pilot' ? 'pilot' : 'soon'}`}>{a.status}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section id="build" className="amp-section amp-models-section" aria-labelledby="build-h">
          <div className="amp-wrap">
            <div className="amp-section-head">
              <h2 id="build-h" className="amp-h2">Businesses you can start</h2>
              <p className="amp-lead">Digital products only, so there is no stock, no shipping and delivery can be automatic.</p>
            </div>
            <ul className="amp-models">
              {featured.map((b) => (
                <li key={b.id}>
                  <h3>{b.title}</h3>
                  <p>{b.description}</p>
                  <p className="amp-models-eg">{b.exampleProducts.slice(0, 3).join(' · ')}</p>
                  <dl>
                    <div><dt>To start</dt><dd>{b.startupCost}</dd></div>
                    <div><dt>Your time</dt><dd>{b.weeklyHours}</dd></div>
                  </dl>
                  <TrackedLink className="amp-link" href={`${BUILD}?model=${b.id}`} event={{ cta: 'model_card', model: b.id }}>Preview this business</TrackedLink>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="pricing" className="amp-section" aria-labelledby="pricing-h">
          <div className="amp-wrap">
            <div className="amp-section-head">
              <h2 id="pricing-h" className="amp-h2">Clear pricing. Cancel any time.</h2>
              <p className="amp-lead">Pilot pricing, being tested with our first users. Prices in AUD including GST. Card fees per sale are charged by Stripe.</p>
            </div>
            <ul className="amp-plans">
              {site.plans.map((plan) => (
                <li key={plan.id} className={plan.id === 'launch' ? 'is-recommended' : undefined}>
                  <h3>{plan.name}{plan.id === 'launch' ? <span className="amp-tag">Most people start here</span> : null}</h3>
                  <p className="amp-price">{plan.priceAud === 0 ? 'Free' : <>A${plan.priceAud}<span>/month</span></>}</p>
                  <p className="amp-plan-blurb">{plan.blurb}</p>
                  <ul>{plan.includes.map((i) => <li key={i}><Check />{i}</li>)}</ul>
                  <TrackedLink className={`amp-btn ${plan.id === 'launch' ? 'amp-btn-primary' : 'amp-btn-secondary'}`} href={planButton(plan).href} event={{ cta: 'pricing', plan: plan.id }}>
                    {planButton(plan).label}
                  </TrackedLink>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="amp-section amp-promise" aria-labelledby="promise-h">
          <div className="amp-wrap amp-promise-inner">
            <h2 id="promise-h" className="amp-h2">What we will never promise</h2>
            <ul>
              <li><strong>Guaranteed income.</strong> Automation saves you work. It does not guarantee sales.</li>
              <li><strong>Fake urgency.</strong> No countdown timers, no invented testimonials, no made-up earnings.</li>
              <li><strong>Hidden actions.</strong> Nothing is published, posted, charged or spent without your approval.</li>
            </ul>
          </div>
        </section>

        <section id="faq" className="amp-section" aria-labelledby="faq-h">
          <div className="amp-wrap amp-faq">
            <h2 id="faq-h" className="amp-h2">Questions</h2>
            <div>
              {faqs.map((f) => (
                <details key={f.q}>
                  <summary>{f.q}<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M5 8l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg></summary>
                  <p>{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="amp-final" aria-labelledby="final-h">
          <Still stage="tree" alt="" />
          <div className="amp-wrap amp-final-inner">
            <h2 id="final-h" className="amp-display">Your next business starts here.</h2>
            <p className="amp-lead">See your business before you pay for anything.</p>
            <TrackedLink className="amp-btn amp-btn-primary" href={primaryEntry.href} event={{ cta: 'final' }}>{primaryEntry.label}</TrackedLink>
          </div>
        </section>
      </main>

      <footer className="amp-footer">
        <div className="amp-wrap amp-footer-inner">
          <p className="amp-logo">{site.name}</p>
          <nav className="amp-footer-links" aria-label="Footer">
            {sitePages.map((p) => <a key={p.id} href={p.href}>{p.label}</a>)}
          </nav>
          <p>Questions? <a href={`mailto:${site.supportEmail}`}>{site.supportEmail}</a></p>
          <p className="amp-small">Pilot pricing and features are being tested and may change. Nothing on this site is financial advice.</p>
        </div>
      </footer>
    </div>
  );
}
