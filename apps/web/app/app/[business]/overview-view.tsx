// Business Overview (screen 10) on the Peach & Lavender glass library. Draws an `OverviewViewModel`; all wording and state logic is in
// view-model.ts. A server component: no state, no effects. Links to owner pages that are not built yet carry a "Coming soon" tag.
import Link from 'next/link';
import type { ReactNode } from 'react';
import { AppIntro, AppLayout, GlassBadge, GlassButton, GlassCard, GlassGrid, GlassIcon, GlassMeter, GlassNotice } from '../../design-system/aimp-glass';
import { COMING_SOON, GUIDED_SETUP_NOTE } from './view-model';
import type { LinkVM, OverviewViewModel } from './view-model';

const SoonTag = () => <GlassBadge className="ao-soon" data-testid="coming-soon">{COMING_SOON}</GlassBadge>;
/** Shown beside every link to a /start page: that page takes no business id, so it is not presented as this business's own page. */
const GuidedNote = () => <span className="plg-note" data-testid="guided-note">({GUIDED_SETUP_NOTE})</span>;

/** A link only when the page exists. Otherwise the same words as plain text with a "Coming soon" tag, so nothing leads to a 404. */
function PageLink({ to, children, testId }: { to: LinkVM; children: ReactNode; testId?: string }) {
  return (
    <span className="ao-link">
      {to.href
        ? <Link href={to.href} className="plg-link" data-target="large" data-testid={testId}>{children}</Link>
        : <span className="plg-text" data-testid={testId}>{children}</span>}
      {to.guided ? <GuidedNote /> : null}
      {to.built ? null : <SoonTag />}
    </span>
  );
}

export function OverviewView({ vm, fixtureLabel }: { vm: OverviewViewModel; fixtureLabel?: string | null }) {
  const p = vm.primary;
  return (
    <AppLayout width="wide">
      <AppIntro
        eyebrow={<span data-testid="state-label">{vm.stateLabel}</span>}
        title={vm.title}
        badges={<GlassBadge tone="demo" dot data-testid="page-mode">{fixtureLabel ? 'EXAMPLE' : 'DEMO'}</GlassBadge>}
      >
        <p>{vm.lede}</p>
        <dl className="ao-facts">
          <div><dt>Store address</dt><dd data-testid="store-line">{vm.storeLine.url ? <a className="plg-link" href={vm.storeLine.url}>{vm.storeLine.text}</a> : vm.storeLine.text}</dd></div>
          <div><dt>Last updated</dt><dd data-testid="updated">{vm.updatedWords}</dd></div>
        </dl>
        <p className="plg-note" data-testid="demo-note">{vm.demoText}</p>
      </AppIntro>

      {fixtureLabel ? (
        <GlassNotice tone="info" title={`Example state: ${fixtureLabel}`} live="none" data-testid="fixture-notice">
          <p>You are looking at made-up example data so each state can be seen. Remove <code>?fixture=</code> from the address to see your own business.</p>
        </GlassNotice>
      ) : null}

      {vm.banners.map((b) => (
        <GlassNotice key={b.id} tone={b.tone} title={b.title} data-testid={`banner-${b.id}`}
          action={b.link ? <PageLink to={b.link}>{b.link.label}</PageLink> : undefined}>
          <p>{b.text}</p>
        </GlassNotice>
      ))}

      <GlassCard heading="h2" highlighted eyebrow="What is next" title={vm.headings.primary} data-testid="primary-card">
        {p.kind === 'fix' ? (
          <>
            <p className="plg-text" data-testid="primary-impact">{p.impact}</p>
            <p className="plg-note" id={p.describedBy} data-testid="primary-action">{p.explanation}</p>
            <div data-testid="fix-next-issue">
              {p.control === 'link' && p.href ? (
                <GlassButton variant="primary" href={p.href} aria-describedby={p.describedBy} icon={<GlassIcon name="spark" size={22} tone="deep" />}>{p.label}</GlassButton>
              ) : (
                // Not a native `disabled`: the button stays focusable so a screen reader reaches it and reads the explanation. It has no action.
                <button type="button" className="plg-btn ao-unavailable" data-variant="primary" data-block="true" aria-disabled="true" aria-describedby={p.describedBy}>
                  <span className="plg-btn-content">
                    <span className="plg-btn-icon"><GlassIcon name="spark" size={22} tone="deep" /></span>
                    <span className="plg-btn-label">{p.label}</span>
                    <span className="plg-btn-note">{COMING_SOON}</span>
                  </span>
                </button>
              )}
            </div>
            {p.secondary ? (
              <div className="ao-secondary" data-testid="primary-secondary">
                <p className="plg-note">{p.secondary.lead}</p>
                <PageLink to={p.secondary}>{p.secondary.action}<span className="plg-sr"> for: {p.secondary.title}</span></PageLink>
                <p className="plg-text">{p.secondary.title}</p>
              </div>
            ) : null}
          </>
        ) : (
          <p className="plg-text" data-testid="calm">{p.text}</p>
        )}
      </GlassCard>

      <section aria-labelledby="ao-glance" className="ao-section">
        <h2 id="ao-glance" className="plg-card-title">{vm.headings.glance}</h2>
        <GlassGrid min={220}>
          {vm.tiles.map((t) => (
            <GlassCard key={t.id} heading="h3" title={t.label} data-testid={`tile-${t.id}`}>
              <p className="ao-value" data-unknown={t.unknown ? 'true' : undefined}>{t.value}</p>
              <p className="plg-note">{t.note}</p>
            </GlassCard>
          ))}
        </GlassGrid>
      </section>

      <GlassCard heading="h2" eyebrow="In order of importance" title={vm.headings.needsYou} data-testid="needs-you">
        {vm.needsYou.length === 0 ? (
          // When the approvals list could not be read, "nothing" would be a guess: say so plainly instead.
          vm.banners.some((b) => b.id === 'approvals_not_read')
            ? <p className="plg-text" data-testid="needs-you-unchecked">We could not check your approvals, so we cannot say whether anything needs you. Open this page again in a minute to try again.</p>
            : <p className="plg-text">Nothing needs you right now.</p>
        ) : (
          <ol className="ao-needs">
            {vm.needsYou.map((i) => (
              <li key={i.id} data-severity={i.severity} data-testid="needs-item">
                <div className="ao-needs-head">
                  <GlassBadge tone={i.severity === 'critical' || i.severity === 'high' ? 'danger' : 'warn'}>{i.severityLabel}</GlassBadge>
                  <span className="plg-note">{i.categoryLabel}</span>
                </div>
                <h3 className="ao-needs-title">{i.title}</h3>
                <p className="plg-text">{i.impact}</p>
                <PageLink to={i}>{i.action}<span className="plg-sr"> for: {i.title}</span></PageLink>
              </li>
            ))}
          </ol>
        )}
        {vm.needsYouHidden > 0 ? <p className="plg-note">{vm.needsYouHidden} more not shown. Fix these first.</p> : null}
      </GlassCard>

      <GlassGrid min={340}>
        <GlassCard heading="h2" eyebrow="Launch progress" title={vm.headings.progress} data-testid="progress">
          <GlassMeter kind="progress" label="Launch progress" value={vm.progress.done} max={vm.progress.total} valueText={vm.progress.label} compact />
          <ul className="ao-steps">
            {vm.progress.steps.map((s) => (
              <li key={s.id} data-done={s.done ? 'true' : 'false'}>
                <span aria-hidden="true" className="ao-tick">{s.done ? '✓' : '○'}</span>
                <span className="plg-text">
                  {s.done ? <>{s.label}<span className="plg-sr"> (done)</span></> : <PageLink to={s}>{s.label}<span className="plg-sr"> (to do)</span></PageLink>}
                  {s.isNext ? <> <GlassBadge tone="highlight">Next</GlassBadge></> : null}
                </span>
              </li>
            ))}
          </ul>
        </GlassCard>

        <GlassCard heading="h2" eyebrow="Today" title={vm.headings.brief} data-testid="brief">
          <ul className="plg-list">
            {vm.brief.map((l, n) => <li key={n}>{l.href ? <><Link href={l.href} className="plg-link">{l.text}</Link>{l.guided ? <> <GuidedNote /></> : null}</> : l.text}</li>)}
          </ul>
        </GlassCard>
      </GlassGrid>

      <GlassCard heading="h2" title={vm.headings.activity} data-testid="activity">
        {vm.activity.length === 0 ? <p className="plg-text">No activity yet.</p> : (
          <ul className="plg-list">
            {vm.activity.map((a) => (
              <li key={a.id}>{a.title} <span className="plg-note">({a.label}, {a.when}{a.needsOwner ? ', needs you' : ''})</span></li>
            ))}
          </ul>
        )}
      </GlassCard>
    </AppLayout>
  );
}

export function UnknownBusiness() {
  return (
    <AppLayout width="regular">
      <AppIntro title="We can't find that business">
        <p>This address does not match a business that has been set up here. The demo keeps businesses in memory, so they disappear when the server restarts.</p>
      </AppIntro>
      <div data-testid="back-to-start">
        <GlassButton variant="primary" href="/start" icon={<GlassIcon name="spark" size={22} tone="deep" />}>Go to your set-up</GlassButton>
      </div>
    </AppLayout>
  );
}
