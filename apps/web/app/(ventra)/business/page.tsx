import { Legacy } from '../../ui/ventra-shell';
import { Suspense } from 'react';
import { BusinessPage } from '../../ui/ventra-pages';
export default function Page(){return <Legacy><Suspense fallback={<p role="status">Loading workspace…</p>}><BusinessPage/></Suspense></Legacy>;}
