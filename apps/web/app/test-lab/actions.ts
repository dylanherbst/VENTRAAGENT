'use server';
// Growth Test Lab: builds ONE filled-in mock EXISTING business on the demo runtime (no idea quiz, no shop), using the same actions
// the onboarding uses: business record, shared profile, Sales agent setup, test Instagram account, three DMs, competitor research.
// Everything is demo data; nothing leaves this server. Lost on restart.
import { availability } from '../start/_server/runtime';
import { startExistingBusinessAction } from '../start/existing/actions';
import { agentTeam } from '../start/_server/agent-team-runtime';
import { sandbox } from '../start/_server/setter-runtime';
import { syncKnowledge } from '../start/_server/knowledge-sync';
import { replaceCompetitors } from '../app/[business]/gaps/_server/store';
import { signForTest, simulatedPayload } from '../../lib/aimp/setter/index';
import { EXAMPLE_COMPETITORS } from '../../lib/aimp/gaps/analyse';
import { BUYERS, rememberMockCustomer, type MockCustomer } from './lab-state';

export type LabReply = { ok: true; customer: MockCustomer } | { ok: false; message: string };
export async function seedMockCustomerAction(): Promise<LabReply> {
  const a = availability();
  if (!a.available) return { ok: false, message: a.reason };
  const steps: MockCustomer['steps'] = [];
  const step = (label: string, ok: boolean, note: string) => { steps.push({ label, ok, note }); return ok; };

  const b = await startExistingBusinessAction({ businessName: 'Lash Lab Joondalup', industry: 'beauty', offer: 'Lash extensions, lifts and brow tints', audience: 'Women in Joondalup aged 25 to 45', website: '', timezone: 'Australia/Perth' });
  if (!b.ok) return { ok: false, message: b.message };
  const businessId = b.businessId;
  step('Business record and brand draft', true, 'Made by the same action as "I already have a business".');

  const t = agentTeam();
  const cur = t.profile(businessId)!;
  const saved = t.saveProfile(businessId, {
    ...cur, description: 'Lash and brow studio in Joondalup. One artist per client, appointments until 8pm on weekdays.', location: 'Joondalup, WA',
    products: ['Classic lash set A$120', 'Hybrid lash set A$140', 'Lash lift and tint A$85', 'Brow tint A$25'], painPoints: ['Lashes that fall out within a week', 'No appointments after work', 'Not sure which style suits them'],
    usps: ['Same artist every visit', 'Open until 8pm on weekdays', 'Free patch test before your first set'], competitors: ['Glow Beauty Bar', 'Lash Lounge Perth'],
    facts: ['Free patch test before your first set', 'Open until 8pm on weekdays'], goals: ['Get more bookings', 'Grow social media'], bookingUrl: 'https://example.com/book',
    faqs: [{ q: 'How long does a classic set take?', a: 'About 90 minutes.' }, { q: 'Do you do refills?', a: 'Yes, within 3 weeks of your set.' }],
  }, 'owner');
  syncKnowledge(businessId);
  step('Shared business profile', saved.ok, saved.ok ? 'Products, prices, pain points, reasons to choose, competitors, proof, goals and FAQs. All three agents read it.' : 'Could not save the profile.');

  const acc = await t.connectStart(businessId, 'instagram', '', 'owner');
  step('Test Instagram account', acc.ok, acc.ok ? 'Mock account: nothing can reach a real Instagram.' : 'Could not add it.');

  const sb = sandbox(businessId);
  if (sb) {
    let n = 0;
    for (const [who, text] of [['900000000000011', 'hi how much is a hybrid set?'], ['900000000000012', 'do you have anything after 6pm on thursday'], ['900000000000013', 'can I talk to a real person please']] as const) {
      const raw = simulatedPayload(sb.igAccountId, [{ from: who, text, mid: `lab-${businessId}-${++n}`, ts: Date.now() }]);
      try { await sb.setter.receive(raw, signForTest(raw, sb.appSecret)); } catch { /* counted below */ }
    }
    await sb.setter.flushDue(sb.ws);
    step('Three customer DMs', sb.store.conversations(sb.ws).length === 3, 'Price question, booking question and a request for a person (that one comes straight to you).');
  } else step('Three customer DMs', false, 'The test inbox is full.');

  try { replaceCompetitors(businessId, EXAMPLE_COMPETITORS); step('Competitor research', true, 'Worked example loaded.'); } catch { step('Competitor research', false, 'Could not load the example.'); }

  const customer: MockCustomer = { businessId, shopSlug: null, seededAt: new Date().toISOString(), buyers: BUYERS, steps };
  rememberMockCustomer(customer);
  return { ok: true, customer };
}
