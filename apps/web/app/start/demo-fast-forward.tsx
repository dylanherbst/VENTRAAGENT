'use client';
// Owner request (14 Nov evening): a top-right button on Welcome that skips straight to a filled-in demo business,
// for showing someone the app on a phone without typing anything. Drives the real actions in ./actions.ts with
// good example data, then redirects to the Business Overview at /app/<business>.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { OnboardingHeader } from '../design-system/aimp-glass';
import { demoFastForwardAction } from './actions';
import { writeJourney } from './journey-client';

export function DemoFastForwardHeader() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await demoFastForwardAction();
      if (!r.ok || !r.businessId || !r.ideaId || !r.idea) {
        setBusy(false);
        setError(r.message || 'Could not build the demo business. Please try again.');
        return;
      }
      writeJourney({ ideaId: r.ideaId, businessId: r.businessId, idea: r.idea, savedAt: new Date().toISOString() });
      // The real Business Overview (screen 10, AMP-081) now exists, so land there.
      router.push(`/app/${r.businessId}`);
    } catch {
      setBusy(false);
      setError('Something went wrong building the demo. Please try again.');
    }
  }

  return (
    <>
      <OnboardingHeader
        skipLabel="Skip straight to a filled-in demo business, with example data"
        skipText={busy ? 'Building your demo…' : 'Demo dashboard →'}
        onSkip={go}
      />
      {error ? <p role="alert" className="plg-note start-demo-error">{error}</p> : null}
    </>
  );
}
