// Thin forwarder kept so older callers (link components, build flow, watch demo, story canvas) compile unchanged.
// It no longer records anything itself: each legacy event is translated by fromLegacy and handed to the single
// measurement module (plant/measure.ts), which validates props against its allow-list. Nothing is pushed to
// window.dataLayer, no DOM event is dispatched here, and nothing is sent anywhere.
import { fromLegacy, pageForPath, track as measure } from './plant/measure.ts';

export type SiteEvent =
  | 'hero_view' | 'cta_click' | 'story_stage_view' | 'model_select' | 'recommend_request'
  | 'preview_start' | 'preview_complete' | 'launch_view' | 'signup_click' | 'plan_select' | 'skip_animation';

type Props = Record<string, string | number | boolean>;

export function track(event: SiteEvent, props: Props = {}): void {
  const page = typeof window !== 'undefined' && window.location ? pageForPath(window.location.pathname) : null;
  for (const [name, mapped] of fromLegacy(event, props, page)) measure(name, mapped);
}
