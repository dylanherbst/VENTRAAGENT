'use client';
import type { LiveState } from './live-summary';
import { GlassButton, GlassCard, Icon } from '../design-system/liquid-glass/components';

/** One line under the numbers explaining why they are not live, instead of repeating it on every card. */
export function LiveNotice({ live }: { live: LiveState }) {
  if (live.phase === 'live' || live.phase === 'loading') return live.phase === 'live' && live.partial ? <p className="vg-footnote">Calls and approvals need the latest database update; those numbers show 0 until then.</p> : null;
  return <GlassCard tight><p className="vg-notice"><Icon name="lock" />{live.reason}</p>{live.phase === 'signed-out' && <div className="vg-card-actions"><GlassButton size="sm" href="/workspace" iconRight="arrow">Sign in</GlassButton></div>}</GlassCard>;
}

