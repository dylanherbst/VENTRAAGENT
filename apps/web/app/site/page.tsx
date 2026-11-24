import { benefits, faqs, formatPrice, pillarById, pillars, plans } from '../../lib/site/content';
import { Footer, Nav } from './_ui/chrome';
import { InAction, ReceptionistDemo, SetterDemo, Workflow } from './_ui/demos';
import { GetStartedButton, PricingSeen } from './_ui/get-started';
import { Icon } from './_ui/icons';
import { HeroLine, Journeys } from './_ui/journey';
import { Reveal } from './_ui/reveal';
import { StatusPill } from './_ui/status';

const jsonLd = { '@context': 'https://schema.org', '@type': 'Organization', name: 'VENTRA', url: 'https://www.aiventra.com.au', email: 'founder@aiventrai.com', areaServed: 'AU', description: 'AI platform to start, run and grow a business, with AI employees that answer enquiries and book appointments.' };

export default function SitePage() {
  const receptionist = pillarById('receptionist'), setter = pillarById('setter');
  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
    <Nav />
    <main>
      {/* 1. Hero */}
      <section className="vs-hero vs-section" aria-labelledby="hero-title">
        <div className="vs-ambient" aria-hidden="true" />
        <div className="vs-wrap">
          <span className="vs-eyebrow">Your AI launchpad for financial freedom</span>
          <h1 id="hero-title">Build your business.<br />Let AI handle the rest.</h1>
          <HeroLine fallback="Launch your ideas, create products, find customers, answer calls, and book appointments — all from one intelligent platform." />
          <div className="vs-actions"><GetStartedButton from="hero" /><a className="vs-btn vs-btn-ghost" href="#ai-team">Explore VENTRA</a></div>
          <div className="vs-stage" aria-label="VENTRA dashboard preview">
            <div className="vs-glass vs-dash">
              <div className="vs-dash-top"><span className="vs-dots" aria-hidden="true"><i /><i /><i /></span><b>VENTRA</b> · Today</div>
              <div className="vs-dash-grid">
                <div className="vs-stat"><small>Enquiries</small><strong>Answered</strong></div>
                <div className="vs-stat"><small>Qualified</small><strong>Booked</strong></div>
                <div className="vs-stat"><small>Follow-ups</small><strong>On time</strong></div>
                <div className="vs-chart" aria-hidden="true"><svg viewBox="0 0 300 100" preserveAspectRatio="none"><path d="M0 80 C40 70 60 76 90 60 S150 42 180 46 240 22 300 18" fill="none" stroke="#14BAB8" strokeWidth="2.5" /><path d="M0 80 C40 70 60 76 90 60 S150 42 180 46 240 22 300 18 V100 H0Z" fill="url(#g)" opacity=".35" /><defs><linearGradient id="g" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#14BAB8" /><stop offset="1" stopColor="#14BAB8" stopOpacity="0" /></linearGradient></defs></svg></div>
              </div>
            </div>
            <div className="vs-glass vs-float vs-f1"><span className="vs-ico"><Icon name="rocket" /></span><span><b>Business Launcher</b><span>Plan ready to launch</span></span></div>
            <div className="vs-glass vs-float vs-f2"><span className="vs-ico"><Icon name="book" /></span><span><b>Course Creator</b><span>Module 3 drafted</span></span></div>
            <div className="vs-glass vs-float vs-f3"><span className="vs-ico"><Icon name="phone" /></span><span><b>AI Receptionist</b><span>Incoming call…</span></span></div>
            <div className="vs-glass vs-float vs-f4"><span className="vs-ico"><Icon name="calendar" /></span><span><b>AI Setter</b><span>Booked Thu 4:00 pm</span></span></div>
          </div>
          <p className="vs-note">Illustration with sample data.</p>
        </div>
      </section>

      {/* 2. AI team */}
      <section id="ai-team" className="vs-section" aria-labelledby="team-title"><div className="vs-wrap">
        <Reveal className="vs-center"><span className="vs-eyebrow">AI employees that work for you</span><h2 id="team-title">Meet your new AI team.</h2><p className="vs-lead">Two AI employees that answer, qualify and book, so every enquiry gets a reply.</p></Reveal>
        <div className="vs-team">
          <Reveal className="vs-glass vs-panel"><div className="vs-panel-head"><div><h3>{receptionist.name}</h3><p style={{ marginTop: 6 }}>Every call answered. Every opportunity captured.</p></div><StatusPill status={receptionist.status} /></div><ReceptionistDemo /></Reveal>
          <Reveal className="vs-glass vs-panel"><div className="vs-panel-head"><div><h3>{setter.name}</h3><p style={{ marginTop: 6 }}>More conversations. More qualified appointments.</p></div><StatusPill status={setter.status} /></div><SetterDemo /></Reveal>
        </div>
      </div></section>

      {/* 3. Journeys */}
      <section className="vs-section" aria-labelledby="journey-title" style={{ background: 'linear-gradient(180deg,#fff,#F5FAFA)' }}><div className="vs-wrap">
        <Reveal className="vs-center"><span className="vs-eyebrow">Your path</span><h2 id="journey-title">What do you want to achieve?</h2><p className="vs-lead">Pick one and the demos below follow your goal.</p></Reveal>
        <Journeys />
      </div></section>

      {/* 4. In action */}
      <section id="in-action" className="vs-section" aria-labelledby="action-title"><div className="vs-wrap">
        <Reveal className="vs-center"><span className="vs-eyebrow">See VENTRA in action</span><h2 id="action-title">Try it before you sign up.</h2><p className="vs-lead">Every preview is labelled: Live, Demo or Coming soon.</p></Reveal>
        <InAction />
      </div></section>

      {/* 5. Workflows */}
      <section className="vs-section" aria-labelledby="flow-title" style={{ background: 'linear-gradient(180deg,#F5FAFA,#fff)' }}><div className="vs-wrap">
        <Reveal className="vs-center"><span className="vs-eyebrow">One platform</span><h2 id="flow-title">Connected, so you don’t have to be.</h2><p className="vs-lead">Each step hands over to the next. No copying details between apps.</p></Reveal>
        <div className="vs-flows">
          <Workflow title="From a message to a meeting" steps={[{ label: 'Enquiry', icon: 'chat' }, { label: 'AI Setter', icon: 'spark' }, { label: 'Qualified', icon: 'check' }, { label: 'Booked', icon: 'calendar' }, { label: 'CRM updated', icon: 'users' }]} />
          <Workflow title="From a call to a confirmation" steps={[{ label: 'Incoming call', icon: 'phone' }, { label: 'AI Receptionist', icon: 'spark' }, { label: 'Customer helped', icon: 'check' }, { label: 'Calendar updated', icon: 'calendar' }, { label: 'Confirmation sent', icon: 'chat' }]} />
        </div>
      </div></section>

      {/* 6. Benefits */}
      <section className="vs-section" aria-labelledby="benefit-title"><div className="vs-wrap">
        <Reveal className="vs-center"><span className="vs-eyebrow">Why VENTRA</span><h2 id="benefit-title">Less admin. More business.</h2></Reveal>
        <div className="vs-benefits">{benefits.map(b => <Reveal key={b} className="vs-benefit">{b}</Reveal>)}</div>
      </div></section>

      {/* 7. Trust. Customer stories, case studies and results stay out until real, verified ones exist. */}
      <section className="vs-section" aria-labelledby="trust-title" style={{ background: '#F5FAFA' }}><div className="vs-wrap">
        <Reveal className="vs-center"><span className="vs-eyebrow">Trust</span><h2 id="trust-title">Built to be honest with your customers.</h2></Reveal>
        <div className="vs-trust">
          <Reveal className="vs-glass vs-card"><span className="vs-ico"><Icon name="shield" /></span><h3 style={{ marginTop: 14 }}>Says it’s an AI</h3><ul><li>Always identifies as an AI assistant</li><li>Hands over to a person on request</li><li>Never invents prices or promises</li></ul></Reveal>
          <Reveal className="vs-glass vs-card"><span className="vs-ico"><Icon name="check" /></span><h3 style={{ marginTop: 14 }}>Respects consent</h3><ul><li>STOP and unsubscribe work instantly</li><li>Only replies to people who contacted you</li><li>Follows Australian spam rules</li></ul></Reveal>
          <Reveal className="vs-glass vs-card"><span className="vs-ico"><Icon name="bolt" /></span><h3 style={{ marginTop: 14 }}>Works with</h3><ul><li>Google Calendar</li><li>SMS, web chat and email</li><li>Instagram, Messenger, WhatsApp (coming soon)</li></ul></Reveal>
        </div>
      </div></section>

      {/* 8. Pricing */}
      <section id="pricing" className="vs-section" aria-labelledby="price-title"><PricingSeen /><div className="vs-wrap">
        <Reveal className="vs-center"><span className="vs-eyebrow">Pricing</span><h2 id="price-title">Two plans. Nothing hidden.</h2><p className="vs-lead">Software on one line, usage on its own line, no setup surprises.</p></Reveal>
        <div className="vs-plans">{plans.map(p => <Reveal key={p.id} className={`vs-glass vs-plan ${p.id === 'grow' ? 'featured' : ''}`}>
          <div className="vs-row" style={{ justifyContent: 'space-between' }}><h3>{p.name}</h3>{p.id === 'grow' && <span className="vs-pill vs-pill-demo">Most popular</span>}</div>
          <p>{p.for}</p>
          <div className="vs-price">{formatPrice(p) ?? 'Founding price'}{formatPrice(p) && <small> / month</small>}</div>
          {!formatPrice(p) && <p style={{ fontSize: 14 }}>Confirmed on your free strategy call, in writing, before you pay anything.</p>}
          <ul>{p.includes.map(i => <li key={i}>{i}</li>)}</ul>
          {p.usage && <p style={{ fontSize: 14 }}>{p.usage}</p>}
          <GetStartedButton from={`pricing-${p.id}`} ghost={p.id !== 'grow'} />
        </Reveal>)}</div>
      </div></section>

      {/* Everything, with status */}
      <section className="vs-section" aria-labelledby="all-title" style={{ background: '#F5FAFA' }}><div className="vs-wrap">
        <Reveal className="vs-center"><span className="vs-eyebrow">What’s included</span><h2 id="all-title">Five products. One workspace.</h2></Reveal>
        <div className="vs-trust" style={{ marginTop: 36 }}>{pillars.map(p => <Reveal key={p.id} className="vs-glass vs-card"><div className="vs-row" style={{ justifyContent: 'space-between' }}><h3>{p.name}</h3><StatusPill status={p.status} /></div><p style={{ marginTop: 8, fontSize: 15 }}>{p.line}</p><ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 8 }}>{p.capabilities.map(c => <li key={c.text} className="vs-row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'nowrap' }}><span>{c.text}</span><StatusPill status={c.status} /></li>)}</ul></Reveal>)}</div>
      </div></section>

      {/* 9. FAQ */}
      <section id="faq" className="vs-section" aria-labelledby="faq-title"><div className="vs-wrap">
        <Reveal className="vs-center"><span className="vs-eyebrow">FAQ</span><h2 id="faq-title">Questions, answered.</h2></Reveal>
        <div className="vs-faq">{faqs.map(f => <details key={f.q}><summary>{f.q}</summary><p>{f.a}</p></details>)}</div>
      </div></section>

      {/* 10. Final CTA */}
      <section className="vs-final" aria-labelledby="final-title"><div className="vs-ambient" aria-hidden="true" /><div className="vs-wrap">
        <h2 id="final-title">Your business deserves a smarter way to grow.</h2>
        <p className="vs-lead" style={{ margin: '18px auto 0' }}>Start building, selling, and growing with VENTRA.</p>
        <div className="vs-actions"><GetStartedButton from="final" /></div>
      </div></section>
    </main>
    <Footer />
  </>;
}
