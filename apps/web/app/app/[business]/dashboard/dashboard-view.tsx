// Merchant dashboard (AMP-062) on the Peach & Lavender glass library. A server component: it only draws what the view model says.
// Read-only: there is no button here that changes anything. A figure with no source is drawn as words with a "No data" tag, never as 0.
import Link from 'next/link';
import { AppIntro, AppLayout, GlassBadge, GlassCard, GlassGrid, GlassNotice } from '../../../design-system/aimp-glass';
import { ESTIMATE } from './view-model';
import type { DashboardVM, SectionVM, StatVM } from './view-model';

function Stat({ stat }: { stat: StatVM }) {
  return (
    <div className="adb-stat" data-kind={stat.kind} data-testid={`stat-${stat.id}`}>
      <dt>
        <span>{stat.label}</span>
        {stat.estimate ? <GlassBadge tone="warn" data-testid="estimate-badge">{ESTIMATE}</GlassBadge> : null}
        {stat.kind === 'unavailable' ? <GlassBadge data-testid="no-data-badge">No data</GlassBadge> : null}
      </dt>
      <dd>
        <span className="adb-value" data-testid={`value-${stat.id}`}>{stat.value}</span>
        {stat.note ? <span className="plg-note">{stat.note}</span> : null}
      </dd>
    </div>
  );
}

function Section({ section }: { section: SectionVM }) {
  return (
    <GlassCard heading="h2" title={section.title} data-testid={`section-${section.id}`}>
      <dl className="adb-stats" data-unavailable={section.unavailable ? 'true' : undefined}>{section.stats.map((s) => <Stat key={s.id} stat={s} />)}</dl>
      {section.notes.map((n) => <p key={n} className="plg-note">{n}</p>)}
      {section.link ? (
        <Link href={section.link.href} className="plg-link adb-link" data-target="large">
          {section.link.label}<span className="plg-sr"> (from {section.title})</span>
        </Link>
      ) : null}
    </GlassCard>
  );
}

export function DashboardView({ vm }: { vm: DashboardVM }) {
  return (
    <AppLayout width="wide">
      <AppIntro eyebrow={<span data-testid="business-name">{vm.businessName}</span>} title={vm.title} badges={<GlassBadge tone="demo" dot data-testid="page-mode">DEMO</GlassBadge>}>
        <p>{vm.lede}</p>
        <p className="plg-note" data-testid="updated">Last updated: {vm.updatedWords}</p>
        <p className="plg-note" data-testid="demo-note">{vm.demoText}</p>
        <Link href={vm.overviewHref} className="plg-link adb-link" data-target="large" data-testid="back-to-overview">Back to your overview</Link>
      </AppIntro>

      {vm.banners.map((b) => (
        <GlassNotice key={b.id} tone="warn" title={b.title} data-testid={`banner-${b.id}`}><p>{b.text}</p></GlassNotice>
      ))}

      <GlassCard heading="h2" highlighted eyebrow="In order of importance" title={vm.attention.title} data-testid="attention">
        {vm.attention.items.length === 0 ? <p className="plg-text" data-testid="attention-empty">{vm.attention.empty}</p> : (
          <ol className="adb-attention" role="list">
            {vm.attention.items.map((i) => (
              <li key={i.id} data-severity={i.severity} data-testid="attention-item">
                <div className="adb-attention-head">
                  <GlassBadge tone={i.severity === 'critical' || i.severity === 'high' ? 'danger' : 'warn'}>{i.severityLabel}</GlassBadge>
                </div>
                <h3 className="adb-attention-title">{i.title}</h3>
                <p className="plg-text">{i.impact}</p>
                <p className="plg-note">What to do: {i.action}.</p>
                {i.href
                  ? <Link href={i.href} className="plg-link adb-link" data-target="large">{i.linkLabel}<span className="plg-sr"> to fix: {i.title}</span></Link>
                  : <span className="adb-soon"><GlassBadge data-testid="coming-soon">{i.linkLabel}</GlassBadge></span>}
              </li>
            ))}
          </ol>
        )}
        {vm.attention.hidden > 0 ? <p className="plg-note">{vm.attention.hidden} more not shown. Fix these first.</p> : null}
      </GlassCard>

      <GlassGrid min={280}>
        {vm.sections.map((s) => <Section key={s.id} section={s} />)}
      </GlassGrid>
    </AppLayout>
  );
}
