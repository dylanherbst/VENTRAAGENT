'use client';
import { useState } from 'react';
import { ManualAudit } from '../../ui/ventra-insights';
import { ConnectionBadges } from '../../ui/connection-badges';
import { SetterHandoff } from './setter-handoff';

// Isolated test page: the real Growth Audit -> workspace save -> Setter hand-off (lib/audit-sync.ts, lib/audit-to-setter.ts),
// then the real manual growth audit editor with its account sync panel (launcher kind "growth-audit").
export default function GrowthAuditTest() {
  const [revision, setRevision] = useState(0);
  return <main>
    <h1>Growth audit test</h1>
    <p><span className="v-status" data-testid="page-mode">LIVE · Real audit logic and browser storage</span> No AI analysis. Nothing is sent to a Setter or customer.</p>
    <ConnectionBadges />
    <SetterHandoff onSaved={() => setRevision(r => r + 1)} />
    <ManualAudit key={revision} />
  </main>;
}
