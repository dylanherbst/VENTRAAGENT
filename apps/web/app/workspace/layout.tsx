import type {ReactNode} from 'react';
import VentraShell, { Legacy } from '../ui/ventra-shell';
export default function Layout({children}:{children:ReactNode}){return <VentraShell><Legacy className="v-editor v-legacy-route">{children}</Legacy></VentraShell>;}
