'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { journeys } from '../../../lib/site/content';
import type { Journey } from '../../../lib/site/content';
import { track } from './track';

// Personalisation: the chosen journey changes the hero line, which demo opens first, and the Get Started default.
type Ctx = { journey: Journey | null; choose: (id: Journey['id']) => void };
const JourneyCtx = createContext<Ctx>({ journey: null, choose: () => {} });
const KEY = 'ventra-site-journey';
export function JourneyProvider({ children }: { children: ReactNode }) {
  const [journey, setJourney] = useState<Journey | null>(null);
  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem(KEY); } catch { /* ignore */ }
    const fromUrl = new URLSearchParams(location.search).get('for');
    const id = fromUrl ?? saved;
    const j = journeys.find(x => x.id === id);
    if (j) setJourney(j);
  }, []);
  const choose = (id: Journey['id']) => {
    const j = journeys.find(x => x.id === id) ?? null;
    setJourney(j);
    try { localStorage.setItem(KEY, id); } catch { /* ignore */ }
    track('journey_select', { journey: id });
  };
  return <JourneyCtx.Provider value={{ journey, choose }}>{children}</JourneyCtx.Provider>;
}
export const useJourney = () => useContext(JourneyCtx);

export function HeroLine({ fallback }: { fallback: string }) {
  const { journey } = useJourney();
  return <p className="vs-lead">{journey?.heroLine ?? fallback}</p>;
}

export function Journeys() {
  const { journey, choose } = useJourney();
  return <div className="vs-journeys" role="group" aria-label="Choose what you want to achieve">
    {journeys.map(j => <button key={j.id} className="vs-glass vs-journey" aria-pressed={journey?.id === j.id} onClick={() => { choose(j.id); document.getElementById('in-action')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>
      <small>{j.who}</small>
      <h3>{j.title}</h3>
      <p>{j.detail}</p>
      <span className="vs-btn vs-btn-ghost vs-btn-sm" style={{ alignSelf: 'flex-start', marginTop: 6 }}>{j.cta} →</span>
    </button>)}
  </div>;
}
