'use server';
// Test Lab: builds ONE filled-in mock customer on the demo runtime so every feature can be tried without typing. It drives the same
// actions a person clicking through would trigger (brand, product, listing, store, publish, test purchases, Inbox, competitors).
// Everything is demo data: payments and email are fixtures and nothing leaves this server. Lost on restart, like the rest of the demo.
import { demoFastForwardAction, storeAction, testPurchaseAction } from '../start/actions';
import { availability, runtime } from '../start/_server/runtime';
import { inboxFor } from '../start/_server/inbox-runtime';
import type { InboxRuntime } from '../start/_server/inbox-runtime';
import { replaceCompetitors } from '../app/[business]/gaps/_server/store';
import { BUYERS, rememberMockCustomer } from './lab-state';
import type { MockCustomer } from './lab-state';
import { EXAMPLE_COMPETITORS } from '../../lib/aimp/gaps/analyse';

export type LabReply = { ok: true; customer: MockCustomer } | { ok: false; message: string };
export async function seedMockCustomerAction(): Promise<LabReply> {
  const a = availability();
  if (!a.available) return { ok: false, message: a.reason };
  const steps: MockCustomer['steps'] = [];
  const step = (label: string, ok: boolean, note: string) => { steps.push({ label, ok, note }); return ok; };

  const ff = await demoFastForwardAction();
  if (!ff.ok || !ff.businessId) return { ok: false, message: ff.message || 'Could not build the mock customer.' };
  const businessId = ff.businessId;
  step('Business, brand, product and listing', true, 'Built with the same actions as the guided setup.');

  let slug: string | null = null;
  try {
    const loaded = await storeAction(businessId, { kind: 'load' });
    slug = loaded.state.site?.slug ?? null;
    const rev = loaded.state.site?.draft.revision;
    if (rev === undefined) step('Publish the shop', false, 'No shop draft was found.');
    else {
      const pub = await storeAction(businessId, { kind: 'publish', note: 'Test Lab first publish', expectedRevision: rev });
      step('Publish the shop', pub.ok, pub.ok ? 'The shop is live in this demo.' : pub.message);
    }
  } catch { step('Publish the shop', false, 'Publishing failed. Nothing else was affected.'); }

  for (const email of BUYERS) {
    try {
      const r = await testPurchaseAction(businessId, email);
      step(`Test order for ${email}`, r.ok, r.ok ? `Paid and delivered once (${r.summary.deliveries.grants} download, replay sent again).` : r.message);
    } catch { step(`Test order for ${email}`, false, 'The test purchase failed.'); }
  }

  try {
    const inbox = inboxFor(runtime() as unknown as InboxRuntime);
    const msgs: [string, string][] = [
      [BUYERS[0]!, 'Hi, I bought the planner but I cannot find my download. Where is my order?'],
      [BUYERS[1]!, 'This was not what I expected. Can I get a refund please?'],
      ['curious.visitor@example.test', 'Do you make a version for left-handed people, or a custom colour?'],
    ];
    let ok = 0;
    for (const [fromEmail, message] of msgs) { const r = await inbox.add(businessId, { fromEmail, message }); if (r.ok) ok++; }
    step('Inbox messages', ok === msgs.length, `${ok} of ${msgs.length} test messages added with drafted replies waiting for approval.`);
  } catch { step('Inbox messages', false, 'Could not add the test messages.'); }

  try { replaceCompetitors(businessId, EXAMPLE_COMPETITORS); step('Competitor gaps', true, 'Worked example loaded.'); }
  catch { step('Competitor gaps', false, 'Could not load the example.'); }

  const customer: MockCustomer = { businessId, shopSlug: slug, seededAt: new Date().toISOString(), buyers: BUYERS, steps };
  rememberMockCustomer(customer);
  return { ok: true, customer };
}
