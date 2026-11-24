'use client';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  AuthDivider, FeatureRow, FeatureTile, FeatureTileGroup, FeatureTileRow, GlassButton, GlassField, GlassIcon, GlassSurface,
  OnboardingHeader, OnboardingLayout, WaveBackdrop, controlIconNames, featureIconNames, providerIconNames,
} from '../../design-system/aimp-glass';
import { checkPairs, parseHex, toHex } from '../../design-system/aimp-glass/contrast';
import type { ContrastResult } from '../../design-system/aimp-glass/contrast';
import { site } from '../../../lib/aimp/site-config';

type Glass = 'auto' | 'opaque';
const spark = <GlassIcon name="spark" size={22} tone="deep" />;

function Phone({ label, glass, children }: { label: string; glass: Glass; children: ReactNode }) {
  return (
    <figure className="sc-phone-wrap">
      <figcaption className="plg-eyebrow">{label}</figcaption>
      <div className="sc-phone" data-testid={`composition-${label.toLowerCase().replace(/\s+/g, '-')}`}>
        <WaveBackdrop mode="contained" glass={glass}>{children}</WaveBackdrop>
      </div>
    </figure>
  );
}

// The three approved compositions with this app's brand and copy. Provider buttons are shown here as samples of the
// component only: they do nothing, and the real /start flow does not offer them as working options.
function WelcomeComposition() {
  return (
    <OnboardingLayout as="div" contained align="end" text="center" footer={
      <>
        <GlassButton variant="primary">Continue with email</GlassButton>
        <GlassButton variant="secondary" icon={<GlassIcon name="apple" />}>Continue with Apple</GlassButton>
        <p className="plg-note sc-legal">Free to start, no card needed. Nothing is published or charged without your approval.</p>
      </>
    }>
      <div className="plg-stack" data-gap="3">
        <h3 className="plg-title sc-welcome-title">Welcome</h3>
        <p className="plg-lede">Find a small online business that fits your budget and your time.</p>
      </div>
    </OnboardingLayout>
  );
}

function AccountComposition() {
  return (
    <OnboardingLayout as="div" contained align="end" header={<OnboardingHeader onBack={() => {}} step={1} totalSteps={3} onSkip={() => {}} />}>
      <div className="plg-stack" data-gap="2">
        <h3 className="plg-title">Join {site.name}</h3>
        <p className="plg-lede">Create an account to keep your work in one place.</p>
      </div>
      <form className="plg-stack" data-gap="3" onSubmit={(e) => e.preventDefault()}>
        <GlassField label="Name" labelHidden placeholder="Name" autoComplete="name" name="sc-name" icon={<GlassIcon name="user" />} />
        <GlassField label="Email" labelHidden placeholder="Email" type="email" autoComplete="email" name="sc-email" icon={<GlassIcon name="mail" />} />
        <GlassField label="Password" labelHidden placeholder="Password" type="password" autoComplete="new-password" name="sc-password" icon={<GlassIcon name="lock" />} />
        <GlassButton variant="primary" type="submit" icon={spark} className="sc-gap-top">Continue</GlassButton>
      </form>
      <div className="plg-stack" data-gap="3">
        <AuthDivider>Or log in with</AuthDivider>
        <div className="sc-providers">
          <GlassButton variant="secondary" icon={<GlassIcon name="google" />}>Google</GlassButton>
          <GlassButton variant="secondary" icon={<GlassIcon name="apple" />}>Apple</GlassButton>
        </div>
      </div>
    </OnboardingLayout>
  );
}

function OverviewComposition() {
  return (
    <OnboardingLayout as="div" contained align="start"
      header={<OnboardingHeader onBack={() => {}} onSkip={() => {}} />}
      footer={<GlassButton variant="primary" icon={spark}>Continue</GlassButton>}
    >
      <div className="plg-stack" data-gap="3">
        <h3 className="plg-title" data-weight="light">Welcome to <strong>{site.name}</strong></h3>
        <p className="plg-lede">Research an idea, build it with guidance, and stay in charge of every step.</p>
      </div>
      <FeatureTileRow>
        <FeatureTile title="Find ideas" detail="Matched to you" icon={<GlassIcon name="search" />} />
        <FeatureTile highlighted title="You approve" detail="Every step" icon={<GlassIcon name="approve" tone="pearl" />} />
        <FeatureTile title="Guided launch" detail="In pilot" icon={<GlassIcon name="store" />} />
      </FeatureTileRow>
      <div className="plg-stack" data-gap="3">
        <FeatureRow title="Ideas that fit you" detail="We score business ideas against your budget, time and interests." icon={<GlassIcon name="leaf" size={48} />} />
        <FeatureRow title="Honest numbers" detail="No earnings promises. You see real figures as they come in." icon={<GlassIcon name="bars" size={48} />} />
      </div>
    </OnboardingLayout>
  );
}

function Panel({ title, note, children, wide = false }: { title: string; note?: string; children: ReactNode; wide?: boolean }) {
  const id = `sc-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <GlassSurface as="section" tone="raised" className="sc-panel" aria-labelledby={id} style={wide ? { gridColumn: '1 / -1' } : undefined}>
      <h3 className="plg-subtitle" id={id}>{title}</h3>
      {note ? <p className="plg-note">{note}</p> : null}
      <div className="sc-panel-body">{children}</div>
    </GlassSurface>
  );
}

const State = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="sc-state"><p className="plg-note sc-state-label">{label}</p>{children}</div>
);

const tokenSwatches = [
  ['Pearl', '--plg-pearl'], ['Silver lilac', '--plg-fold'], ['Periwinkle', '--plg-trough'], ['Blush', '--plg-blush'],
  ['Peach', '--plg-peach'], ['Rose lilac', '--plg-rose-lilac'], ['Soft purple', '--plg-violet'],
  ['Plum ink', '--plg-plum'], ['Body ink', '--plg-text'], ['Muted ink', '--plg-text-muted'], ['Focus', '--plg-focus'],
  ['Control border', '--plg-control-border'], ['Error', '--plg-danger'],
] as const;

function useTokens(): Record<string, string> | null {
  const [tokens, setTokens] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    const scope = document.querySelector('.plg');
    if (!scope) return;
    const style = getComputedStyle(scope);
    const out: Record<string, string> = {};
    const names = new Set<string>([...tokenSwatches.map((t) => t[1]), '--plg-white', '--plg-fallback-fill', '--plg-disabled-ink', '--plg-disabled-fill']);
    for (const name of names) {
      const value = style.getPropertyValue(name).trim();
      try { out[name] = toHex(parseHex(value)); } catch { /* not a hex token */ }
    }
    setTokens(out);
  }, []);
  return tokens;
}

function safePairs(tokens: Record<string, string> | null): ContrastResult[] {
  if (!tokens) return [];
  try { return checkPairs(tokens); } catch { return []; }
}

export function Showcase() {
  const [glass, setGlass] = useState<Glass>('auto');
  const [loading, setLoading] = useState(false);
  const [choice, setChoice] = useState<'low' | 'medium' | 'high' | ''>('medium');
  const [pick, setPick] = useState<'a' | 'b' | 'c' | ''>('');
  const [email, setEmail] = useState('not-an-email');
  const tokens = useTokens();
  const pairs = safePairs(tokens);

  function demoLoad() {
    setLoading(true);
    window.setTimeout(() => setLoading(false), 1800);
  }

  return (
    <main className="sc" data-testid="glass-showcase">
      <header className="sc-head">
        <p className="plg-eyebrow">UI library · internal preview</p>
        <h1 className="plg-title">Peach &amp; Lavender Glass</h1>
        <p className="plg-lede">The three reference screens and every shared component with its states. Sample content only: buttons on this page do not sign anyone in.</p>
        <div className="sc-toggle" role="group" aria-label="Glass material">
          <GlassButton variant="skip" aria-pressed={glass === 'auto'} onClick={() => setGlass('auto')}>Blurred glass</GlassButton>
          <GlassButton variant="skip" aria-pressed={glass === 'opaque'} onClick={() => setGlass('opaque')}>Opaque fallback</GlassButton>
        </div>
      </header>

      <section aria-labelledby="sc-compositions">
        <h2 className="plg-subtitle sc-section-title" id="sc-compositions">Reference compositions</h2>
        <div className="sc-phones">
          <Phone label="Welcome" glass={glass}><WelcomeComposition /></Phone>
          <Phone label="Create account" glass={glass}><AccountComposition /></Phone>
          <Phone label="Feature overview" glass={glass}><OverviewComposition /></Phone>
        </div>
      </section>

      {/* A nested .plg scope: re-declares the tokens so the material switch applies to this section too. */}
      <div className="plg sc-components" data-glass={glass}>
        <section aria-labelledby="sc-components-title" className="sc-components-inner">
          <h2 className="plg-subtitle sc-section-title" id="sc-components-title">Components and states</h2>
          <div className="sc-grid">
            <Panel title="GlassButton" note="Primary is the milky-white pill with plum text. Loading keeps the width.">
              <State label="Primary"><GlassButton variant="primary">Continue</GlassButton></State>
              <State label="Primary with sparkle"><GlassButton variant="primary" icon={spark}>Continue</GlassButton></State>
              <State label="Primary, loading (press to try)"><GlassButton variant="primary" icon={spark} loading={loading} loadingLabel="Saving…" onClick={demoLoad}>Save and continue</GlassButton></State>
              <State label="Primary, loading"><GlassButton variant="primary" icon={spark} loading>Continue</GlassButton></State>
              <State label="Primary, disabled"><GlassButton variant="primary" icon={spark} disabled>Continue</GlassButton></State>
              <State label="Primary, long label"><GlassButton variant="primary" icon={spark}>Save my answers and show me the business ideas that fit</GlassButton></State>
              <State label="Secondary / provider"><GlassButton variant="secondary" icon={<GlassIcon name="apple" />}>Continue with Apple</GlassButton></State>
              <State label="Secondary / provider"><GlassButton variant="secondary" icon={<GlassIcon name="google" />}>Continue with Google</GlassButton></State>
              <State label="Secondary, plain"><GlassButton variant="secondary">I already have an account</GlassButton></State>
              <State label="Secondary, loading"><GlassButton variant="secondary" loading>Continue with Apple</GlassButton></State>
              <State label="Secondary, disabled with note"><GlassButton variant="secondary" disabled icon={<GlassIcon name="google" />} note="Coming soon">Google</GlassButton></State>
              <State label="Compact: icon and skip">
                <div className="sc-inline">
                  <GlassButton variant="icon" aria-label="Back" icon={<GlassIcon name="back" />} />
                  <GlassButton variant="icon" aria-label="Back (disabled)" disabled icon={<GlassIcon name="back" />} />
                  <GlassButton variant="skip">Skip</GlassButton>
                  <GlassButton variant="skip" disabled>Skip</GlassButton>
                  <GlassButton variant="skip" href="#sc-compositions">Skip (link)</GlassButton>
                </div>
              </State>
            </Panel>

            <Panel title="GlassField" note="A real label, a leading icon, hint and error text. Errors set aria-invalid and are linked to the input.">
              <State label="Visible label, empty"><GlassField label="Email" type="email" name="sc-f-email" autoComplete="email" placeholder="name@example.com" icon={<GlassIcon name="mail" />} /></State>
              <State label="With hint"><GlassField label="Password" type="password" name="sc-f-pass" autoComplete="new-password" icon={<GlassIcon name="lock" />} hint="At least 12 characters." /></State>
              <State label="Error (edit to see it stay linked)">
                <GlassField label="Email" type="email" name="sc-f-email2" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} icon={<GlassIcon name="mail" />}
                  error={/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? undefined : 'Enter an email address like name@example.com.'} />
              </State>
              <State label="Label hidden, placeholder shown (as in the mockup)"><GlassField label="Name" labelHidden placeholder="Name" name="sc-f-name" autoComplete="name" icon={<GlassIcon name="user" />} /></State>
              <State label="Trailing action"><GlassField label="Password" type="password" name="sc-f-pass2" autoComplete="current-password" defaultValue="correct horse battery" icon={<GlassIcon name="lock" />}
                trailing={<GlassButton variant="icon" aria-label="Show password" icon={<GlassIcon name="eye" />} />} /></State>
              <State label="Long value"><GlassField label="Interests" name="sc-f-long" autoComplete="off" defaultValue="houseplants, slow mornings, home decor, budgeting, meal planning, watercolour" icon={<GlassIcon name="heart" />} /></State>
            </Panel>

            <Panel title="FeatureTile" note="One coloured tile, the rest quiet. Selectable tiles are a real radio group and show a check as well as colour.">
              <State label="Static: quiet, highlighted, quiet">
                <FeatureTileRow>
                  <FeatureTile title="Find ideas" detail="Matched to you" icon={<GlassIcon name="search" />} />
                  <FeatureTile highlighted title="You approve" detail="Every step" icon={<GlassIcon name="approve" tone="pearl" />} />
                  <FeatureTile title="Guided launch" detail="In pilot" icon={<GlassIcon name="store" />} />
                </FeatureTileRow>
              </State>
              <State label="Selectable tiles (arrow keys move the choice)">
                <FeatureTileGroup legend="Pick one tile" name="sc-pick" value={pick} onChange={setPick} options={[
                  { value: 'a', title: 'Reminders', detail: 'Gentle nudges', icon: (s) => <GlassIcon name="bell" tone={s ? 'pearl' : 'gradient'} /> },
                  { value: 'b', title: 'Protection', detail: 'You approve', icon: (s) => <GlassIcon name="shield" tone={s ? 'pearl' : 'gradient'} /> },
                  { value: 'c', title: 'Unavailable', detail: 'Disabled', disabled: true, icon: () => <GlassIcon name="bars" /> },
                ]} />
              </State>
              <State label="Selectable list (longer descriptions)">
                <FeatureTileGroup legend="How hands-on do you want to be?" name="sc-effort" layout="list" value={choice} onChange={setChoice} options={[
                  { value: 'low', title: 'Light', detail: 'Mostly automatic, a quick check now and then.', icon: (s) => <GlassIcon name="leaf" size={36} tone={s ? 'pearl' : 'gradient'} /> },
                  { value: 'medium', title: 'Balanced', detail: 'A steady few hours of review and decisions.', icon: (s) => <GlassIcon name="bars" size={36} tone={s ? 'pearl' : 'gradient'} /> },
                  { value: 'high', title: 'Hands-on', detail: 'Happy to do the work to grow faster.', icon: (s) => <GlassIcon name="spark" size={36} tone={s ? 'pearl' : 'gradient'} /> },
                ]} />
              </State>
              <State label="Long labels wrap">
                <FeatureTileRow>
                  <FeatureTile title="Personalised digital products" detail="Made for your niche and audience" icon={<GlassIcon name="leaf" />} />
                  <FeatureTile highlighted title="Approvals before anything is published" detail="You stay in control" icon={<GlassIcon name="shield" tone="pearl" />} />
                </FeatureTileRow>
              </State>
            </Panel>

            <Panel title="FeatureRow" note="Static for information, a link for navigation. Rows grow when copy wraps.">
              <State label="Static"><FeatureRow title="Ideas that fit you" detail="We score business ideas against your budget, time and interests." icon={<GlassIcon name="leaf" size={48} />} /></State>
              <State label="Link (hover, press and focus)"><FeatureRow href="#sc-compositions" title="Honest numbers" detail="No earnings promises. You see real figures as they come in." icon={<GlassIcon name="bars" size={48} />} /></State>
              <State label="Long copy"><FeatureRow title="Nothing goes public without your say-so" detail="You review the brand, the first products, the store and every marketing campaign before anything is published, posted or charged." icon={<GlassIcon name="shield" size={48} />} /></State>
              <State label="Title only"><FeatureRow title="Export your files any time" icon={<GlassIcon name="store" size={48} />} /></State>
            </Panel>

            <Panel title="OnboardingHeader" note="Back and Skip have accessible names. Progress is announced as “Step 2 of 3”.">
              <State label="Step 1 of 3"><OnboardingHeader onBack={() => {}} step={1} onSkip={() => {}} /></State>
              <State label="Step 2 of 3"><OnboardingHeader onBack={() => {}} step={2} onSkip={() => {}} /></State>
              <State label="Step 3 of 3, no Skip"><OnboardingHeader onBack={() => {}} step={3} /></State>
              <State label="Back and Skip only"><OnboardingHeader onBack={() => {}} onSkip={() => {}} /></State>
              <State label="Five steps, custom Skip text"><OnboardingHeader onBack={() => {}} step={4} totalSteps={5} onSkip={() => {}} skipText="Not now" /></State>
            </Panel>

            <Panel title="AuthDivider and GlassSurface">
              <State label="Divider with text"><AuthDivider>Or log in with</AuthDivider></State>
              <State label="Divider, long text"><AuthDivider>Other ways to sign in, when they are ready</AuthDivider></State>
              <State label="Plain rule"><AuthDivider /></State>
              <State label="Surface: quiet"><GlassSurface><p>Quiet glass. The waves stay visible through it.</p></GlassSurface></State>
              <State label="Surface: raised"><GlassSurface tone="raised"><p>Raised glass. A milkier backing for longer text and forms.</p></GlassSurface></State>
              <State label="Surface: pill, compact"><GlassSurface shape="pill" padding="compact"><p>Saved on this device.</p></GlassSurface></State>
            </Panel>

            <Panel title="GlassIcon" note="Line icons for controls, brand-coloured provider marks, and glossy feature icons in two tones." wide>
              <State label="Control (line)">
                <div className="sc-icons">{controlIconNames.map((n) => <span key={n} className="sc-icon"><GlassIcon name={n} size={22} /><small>{n}</small></span>)}</div>
              </State>
              <State label="Provider marks">
                <div className="sc-icons">{providerIconNames.map((n) => <span key={n} className="sc-icon"><GlassIcon name={n} size={24} /><small>{n}</small></span>)}</div>
              </State>
              <State label="Feature (gradient)">
                <div className="sc-icons">{featureIconNames.map((n) => <span key={n} className="sc-icon"><GlassIcon name={n} /><small>{n}</small></span>)}</div>
              </State>
              <State label="Feature (pearl, for the highlighted tile)">
                <div className="sc-icons sc-on-highlight">{featureIconNames.map((n) => <span key={n} className="sc-icon"><GlassIcon name={n} tone="pearl" /><small>{n}</small></span>)}</div>
              </State>
            </Panel>

            <Panel title="Tokens and contrast" note="Values are read live from tokens.css. Ratios are WCAG contrast against each backdrop colour; glass only lightens these." wide>
              <div className="sc-swatches">
                {tokenSwatches.map(([name, token]) => (
                  <div key={token} className="sc-swatch">
                    <span className="sc-swatch-chip" style={{ background: `var(${token})` }} />
                    <strong>{name}</strong>
                    <small>{tokens?.[token] ?? token}</small>
                  </div>
                ))}
              </div>
              <div className="sc-table-wrap" tabIndex={0} role="region" aria-label="Contrast results">
                <table className="sc-table" data-testid="contrast-table">
                  <thead><tr><th scope="col">Pair</th><th scope="col">On</th><th scope="col">Ratio</th><th scope="col">Needs</th><th scope="col">Result</th></tr></thead>
                  <tbody>
                    {pairs.map((p) => (
                      <tr key={`${p.label}-${p.fg}-${p.bg}`}>
                        <td>{p.label}</td><td>{p.bg.replace('--plg-', '')}</td><td>{p.ratio.toFixed(2)}:1</td><td>{p.min}:1</td><td>{p.pass ? 'Pass' : 'Fail'}</td>
                      </tr>
                    ))}
                    {pairs.length === 0 ? <tr><td colSpan={5}>Reading tokens…</td></tr> : null}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>
        </section>
      </div>
    </main>
  );
}
