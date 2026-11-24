import { findOpportunities } from '../../../lib/aimp/opportunities';
import { SelectDemo } from './select-demo';

export const dynamic = 'force-dynamic';

// Isolated test page for AMP-013 (opportunity preview and selection). The server runs the real Opportunity Finder on a
// sample profile; the client part runs the real selection logic against a browser demo store. No database is connected.
export default function OpportunitySelectTest() {
  const result = findOpportunities(
    { budgetMinor: 5000, weeklyHours: 6, interests: ['cooking', 'family'], skills: ['design'], preferredEffort: 'medium' },
    { now: () => new Date(), mode: 'fixture' },
  );
  return <main style={{ maxWidth: 720, margin: '0 auto', padding: 16, lineHeight: 1.5 }}>
    <h1>Opportunity select test</h1>
    <p>
      <span data-testid="page-mode"><strong>DEMO</strong></span>
      {' '}· Connection: <span data-testid="connection-state">database not connected</span>
    </p>
    <p>Selections are saved in this browser only (labelled demo store). Ideas below are fixture data from the Opportunity Finder, not market research.</p>
    <SelectDemo ideas={result.ideas} />
  </main>;
}
