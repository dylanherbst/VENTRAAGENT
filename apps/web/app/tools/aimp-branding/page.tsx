import { findOpportunities } from '../../../lib/aimp/opportunities';
import { BrandingDemo } from './branding-demo';

export const dynamic = 'force-dynamic';

// Isolated test page for AMP-020 (business name, branding, colours, tone and listing copy). The server runs the real
// Opportunity Finder on a sample profile; the client runs the real brand generator, validation, approval store and adapters.
// Nothing here calls a model or the network, and no database is connected.
export default function AimpBrandingTest() {
  const result = findOpportunities(
    { budgetMinor: 5000, weeklyHours: 6, interests: ['cooking', 'family'], skills: ['design'], preferredEffort: 'medium' },
    { now: () => new Date(), mode: 'fixture' },
  );
  return <main style={{ maxWidth: 760, margin: '0 auto', padding: 16, lineHeight: 1.5 }}>
    <h1>Branding test</h1>
    <p>
      <span data-testid="page-mode"><strong>DEMO</strong></span>
      {' '}· Connection: <span data-testid="connection-state">database not connected; AI generation is the built-in deterministic generator (no model call)</span>
    </p>
    <p>Brands are kept in memory for this page only. Ideas are fixture data from the Opportunity Finder, not market research.</p>
    <BrandingDemo ideas={result.ideas} />
  </main>;
}
