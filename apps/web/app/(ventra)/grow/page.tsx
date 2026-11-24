import { Suspense } from 'react';
import { GrowScreen } from '../../ui/ventra-areas';
export default function Page(){return <Suspense fallback={<p role="status">Loading workspace…</p>}><GrowScreen/></Suspense>;}
