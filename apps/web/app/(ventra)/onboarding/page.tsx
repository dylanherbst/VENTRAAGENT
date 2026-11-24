import { Legacy } from '../../ui/ventra-shell';
import { Suspense } from 'react';
import VentraOnboarding from '../../ui/ventra-onboarding';
export default function Page(){return <Legacy><Suspense fallback={<p role="status">Loading workspace…</p>}><VentraOnboarding/></Suspense></Legacy>;}
