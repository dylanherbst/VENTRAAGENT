import { SitePublishDemo } from './site-publish-demo';

export const dynamic = 'force-dynamic';

// Isolated test page for AMP-031 (draft, preview, publish, pause, rollback). The client part runs the real site-version
// store in this browser tab, seeded with the two DEMO stores. No database is connected and nothing here is public.
export default function SitePublishTest() {
  return <main style={{ maxWidth: 760, margin: '0 auto', padding: 16, lineHeight: 1.5 }}>
    <h1>Site publish test</h1>
    <p>
      <span data-testid="page-mode"><strong>DEMO</strong></span>
      {' '}· Connection: <span data-testid="connection-state">database not connected (in-memory store, resets on reload)</span>
    </p>
    <p>Edit a store&apos;s draft, preview it, publish it, pause it or go back to an earlier version. The box labelled &quot;Public site&quot; shows exactly what the public store address would serve.</p>
    <SitePublishDemo />
  </main>;
}
