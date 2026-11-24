'use client';
import GrowthOpportunity from '../../ui/growth-opportunity';
import { ConnectionBadges } from '../../ui/connection-badges';

// Isolated test page: the real Growth Audit calculator (lib/growth-opportunity.ts) and the same browser storage.
export default function GrowthOpportunityTest() {
  return <>
    <h1>Growth Audit calculator test</h1>
    <p><span className="v-status" data-testid="page-mode">LIVE · Real calculator and browser storage</span> Self-reported answers only. Nothing is sent or scanned.</p>
    <ConnectionBadges />
    <div className="vg-app-embed"><GrowthOpportunity embedded /></div>
  </>;
}
