import { Legacy } from '../../ui/ventra-shell';
import { Suspense } from 'react';
import { LoadingState } from '../../design-system/states';
import InsightsPage from '../../ui/ventra-insights';
export default function Page(){return <Legacy><Suspense fallback={<LoadingState>Loading your workspace…</LoadingState>}><InsightsPage/></Suspense></Legacy>;}
