// AMP-148: the Overview, the Dashboard and the Approvals page read ONE automation service (the /start runtime's, via automationSource).
// Real code: createStartAutomation, automationExtras (what the Overview and Dashboard pages hand to the overview loaders), and the
// real Approvals loader. The page files cannot be loaded by node, so their source is checked as text.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createStartAutomation } from '../app/start/_server/automation-runtime.ts';
import { automationContext, loadApprovals } from '../app/app/[business]/approvals/_server/approvals.ts';
import { automationExtras } from '../app/app/[business]/_server/overview.ts';

const WS = 'demo-workspace';
const OWNER = 'demo-owner';
const A = 'biz-a';
const B = 'biz-b';

test('AMP-148 a pending approval in the /start service is counted for Overview/Dashboard and listed by Approvals; another business sees none', async () => {
  const sa = createStartAutomation();
  const rt = { businesses: new Set<string>([A, B]), seeds: new Map<string, unknown>(), slugs: new Map<string, string>(), productIds: new Map<string, string[]>() };
  const d = { workspaceId: WS, actorUserId: OWNER };
  const ask = await sa.automation.start({ workspaceId: WS, businessId: A, actorUserId: OWNER, idempotencyKey: 'post-1' }, { kind: 'scheduled-post', input: { post: 'hi' }, description: 'Post a hi' });
  assert.equal(ask.outcome, 'needs_approval');
  if (ask.outcome !== 'needs_approval') return;

  // Exactly what the two pages build: the shared source, and the Approvals page's own context builder.
  const extras = automationExtras(() => sa.automation, (s) => automationContext(d, s.businessId));
  assert.ok(extras.approvals);
  const pending = (list: { status: string }[]) => list.filter((a) => a.status === 'pending').length;
  assert.equal(pending(await extras.approvals({ workspaceId: WS, businessId: A })), 1);
  assert.equal(pending(await extras.approvals({ workspaceId: WS, businessId: B })), 0, 'a second business sees none');

  const list = await loadApprovals(rt, { automation: () => sa.automation, ...d }, A);
  assert.ok(list.found && list.state === 'ready');
  if (list.found && list.state === 'ready') assert.deepEqual(list.data.approvals.filter((a) => a.status === 'pending').map((a) => a.id), [ask.approvalId]);
  const other = await loadApprovals(rt, { automation: () => sa.automation, ...d }, B);
  assert.ok(other.found && other.state === 'ready');
  if (other.found && other.state === 'ready') assert.deepEqual(other.data.approvals, []);

  // The separate demo's store is not consulted: a second runtime has nothing pending.
  const second = createStartAutomation();
  assert.equal(pending(await automationExtras(() => second.automation, (s) => automationContext(d, s.businessId)).approvals!({ workspaceId: WS, businessId: A })), 0);
});

test('AMP-148 wiring: the Overview and Dashboard pages take the service from automationSource, not demoAutomation', () => {
  for (const rel of ['../app/app/[business]/page.tsx', '../app/app/[business]/dashboard/page.tsx']) {
    const src = readFileSync(new URL(rel, import.meta.url), 'utf8');
    assert.match(src, /automationSource\(\)/, rel);
    assert.match(src, /automationContext\(\{ workspaceId: WORKSPACE, actorUserId: OWNER \}/, rel);
    assert.doesNotMatch(src, /demoAutomation/, rel);
    assert.doesNotMatch(src, /automationCtx/, rel);
  }
});
