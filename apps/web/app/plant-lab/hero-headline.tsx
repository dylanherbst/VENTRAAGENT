'use client';
import { useEffect, useState } from 'react';
import { HEADLINE_EXPERIMENT_ENABLED, HEADLINE_EXPERIMENT_ID, VISITOR_KEY_STORAGE, assignVariant, headlineFor, newVisitorKey, type HeadlineVariant } from '../../lib/aimp/plant/experiment';
import { track } from '../../lib/aimp/plant/measure';

/** Null when storage is unavailable or throws: the visitor then sees the control and nothing is recorded. */
function visitorKey(): string | null {
  try {
    const found = window.localStorage.getItem(VISITOR_KEY_STORAGE);
    if (found && /^[a-z0-9]{8,32}$/.test(found)) return found;
    const fresh = newVisitorKey();
    window.localStorage.setItem(VISITOR_KEY_STORAGE, fresh);
    return fresh;
  } catch {
    return null;
  }
}

/**
 * The hero h1. The server render and first client render always show the control text (no hydration mismatch).
 * With the experiment switch ON, after mount the visitor is assigned a variant and the text may swap once.
 * With the switch OFF (default) nothing is read, stored or recorded.
 */
export function HeroHeadline({ control }: { control: string }) {
  const [variant, setVariant] = useState<HeadlineVariant>('control');
  useEffect(() => {
    if (!HEADLINE_EXPERIMENT_ENABLED) return;
    const key = visitorKey();
    if (!key) return;
    const v = assignVariant(key);
    setVariant(v);
    track('headline_variant_seen', { experiment: HEADLINE_EXPERIMENT_ID, variant: v });
  }, []);
  return <h1 className="amp-display" data-headline-variant={HEADLINE_EXPERIMENT_ENABLED ? variant : undefined}>{headlineFor(variant, control)}</h1>;
}
