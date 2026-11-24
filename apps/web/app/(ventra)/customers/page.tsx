import { Suspense } from 'react';
import { CustomersScreen } from '../../ui/ventra-areas';
export default function Page(){return <Suspense fallback={<p role="status">Loading workspace…</p>}><CustomersScreen/></Suspense>;}
