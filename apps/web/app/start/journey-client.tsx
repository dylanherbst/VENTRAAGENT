'use client';
// Browser-side helpers shared by the journey pages: the saved goal answers, the chosen business, and the page shell.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { AppLayout, GlassBadge, GlassButton, GlassState, JourneyHeader } from '../design-system/aimp-glass';
import { toProfile } from '../../lib/aimp/onboarding/model';
import { createLocalStorageStore } from '../../lib/aimp/onboarding/store';
import type { FinderProfile } from '../../lib/aimp/opportunities/types';
import { createMemoryStore } from '../../lib/aimp/selection/memory-store';
import type { SelectDeps } from '../../lib/aimp/selection/select';
import { START_DRAFT_KEY, startRoutes } from './flow';
import { JOURNEY_STORAGE_KEY, journeyStepName, journeyStepNumber, journeyTotal, parseJourney, profileFromQuery, serialiseJourney } from './journey';
import type { JourneyRecord, JourneyStepId, RawProfile } from './journey';

/** The same fixed demo workspace the selection test page uses; there is no signed-in workspace behind these pages yet. */
export const WORKSPACE = 'demo-workspace';

export type ProfileSource =
  | { source: 'saved'; profile: FinderProfile }
  | { source: 'link'; profile: RawProfile }
  | { source: 'none' };

/** Saved goal answers first; the profile in the link (the /tools/opportunity-finder query shape) as the fallback. */
export function readProfile(search: string): ProfileSource {
  try {
    const saved = toProfile(createLocalStorageStore().load(START_DRAFT_KEY).answers);
    if (saved.ok) return { source: 'saved', profile: saved.profile };
  } catch { /* storage blocked: fall through to the link */ }
  const params = new URLSearchParams(search);
  const fromLink = profileFromQuery((k) => params.get(k));
  return fromLink ? { source: 'link', profile: fromLink } : { source: 'none' };
}

export function readJourney(): JourneyRecord | null {
  try { return parseJourney(window.localStorage.getItem(JOURNEY_STORAGE_KEY)); } catch { return null; }
}
export function writeJourney(record: Omit<JourneyRecord, 'v'>): boolean {
  try { window.localStorage.setItem(JOURNEY_STORAGE_KEY, serialiseJourney(record)); return true; } catch { return false; }
}

/** The chosen business, read after mount (it lives in this browser). `ready` is false until then. */
export function useJourney(): { ready: boolean; journey: JourneyRecord | null } {
  const [state, setState] = useState<{ ready: boolean; journey: JourneyRecord | null }>({ ready: false, journey: null });
  useEffect(() => { setState({ ready: true, journey: readJourney() }); }, []);
  return state;
}

/** The selection store the test page uses: the lib's memory store on localStorage, labelled "browser" (demo storage). */
export function selectionDeps(): SelectDeps {
  let storage: Storage | undefined;
  try { storage = window.localStorage; } catch { storage = undefined; }
  return { store: createMemoryStore(storage ? { storage } : {}), now: () => new Date() };
}

export const DemoBadge = ({ mode = 'DEMO' }: { mode?: 'DEMO' | 'LIVE' }) => (
  <GlassBadge tone={mode === 'LIVE' ? 'live' : 'demo'} data-testid="page-mode">{mode}</GlassBadge>
);

export interface JourneyShellProps {
  step: JourneyStepId;
  backHref: string;
  backLabel: string;
  mode?: 'DEMO' | 'LIVE';
  footer?: ReactNode;
  width?: 'regular' | 'wide';
  children: ReactNode;
}

export function JourneyShell({ step, backHref, backLabel, mode = 'DEMO', footer, width = 'wide', children }: JourneyShellProps) {
  return (
    <AppLayout
      width={width}
      header={<JourneyHeader backHref={backHref} backLabel={backLabel} step={journeyStepNumber(step)} totalSteps={journeyTotal} stepName={journeyStepName(step)} end={<DemoBadge mode={mode} />} />}
      footer={footer}
    >
      {children}
    </AppLayout>
  );
}

/** Shown by every later step when no business has been chosen in this browser. */
export function NeedBusiness() {
  return (
    <GlassState kind="empty" title="Choose a business idea first" data-testid="need-business" action={<GlassButton variant="primary" block={false} href={startRoutes.ideas}>See my business ideas</GlassButton>}>
      <p>This step builds on the idea you choose. Nothing has been chosen in this browser yet.</p>
    </GlassState>
  );
}

export const LoadingState = ({ title }: { title: string }) => <GlassState kind="loading" title={title} />;
