// Scripted Sales test set (tracker 2.11, foundation): the model is scripted, so these check that each case ends in the
// right state with the right records, and that no price, discount or guarantee comes from anywhere but the config.
import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers/route-harness.ts';

const { store } = await import('./helpers/front-office-store.ts');
const { runSalesTurn, handoffLine, paymentLinksFromEnv } = await import('../lib/front-office/sales/agent.ts');
const { ventraSalesConfig, checkedSalesConfig, quote } = await import('../lib/front-office/sales/config.ts');
const { SALES_PROMPT_VERSION, salesSystemPrompt } = await import('../lib/front-office/sales/prompt.ts');
const { handleInbound } = await import('../lib/front-office/orchestrator.ts');
type Llm = import('../lib/front-office/llm.ts').Llm;
type Block = import('../lib/front-office/llm.ts').Block;
type SalesConfig = import('../lib/front-office/sales/config.ts').SalesConfig;

const NOW = Date.parse('2026-11-10T02:00:00Z');
const auth = { channel: 'ch', key: 'k'.repeat(40) };
function scripted(steps: Block[][]): { llm: Llm; systems: string[]; results: string[] } {
  const systems: string[] = [], results: string[] = []; let i = 0;
  const llm: Llm = async (req) => {
    systems.push(req.system);
    const last = req.messages.at(-1);
    if (last && Array.isArray(last.content)) for (const b of last.content) if (b.type === 'tool_result') results.push(b.content);
    const content = steps[Math.min(i++, steps.length - 1)];
    return { content, stopReason: content.some(b => b.type === 'tool_use') ? 'tool_use' : 'end_turn' };
  };
  return { llm, systems, results };
}
const tool = (name: string, input: Record<string, unknown>, id = name): Block => ({ type: 'tool_use', id, name, input });
const say = (text: string): Block => ({ type: 'text', text });
const priced: SalesConfig = { ...ventraSalesConfig, packages: [{ id: 'launch', name: 'Launch', description: 'Setter', priceAud: 500, billing: 'per month' }, { id: 'big', name: 'Big', description: 'All', priceAud: 5000, billing: 'per month' }], allowedDiscounts: [{ id: 'founding', description: 'Founding customer', percent: 10 }] };
function booked() {
  const s = store('booked', [{ direction: 'inbound', body: 'Ready for the call' }]);
  s.db.contact.name = 'Sam Lee';
  s.db.contact.answers = { business: 'Gym in Joondalup', problem: 'Slow replies at night' };
  s.db.handoffs.push({ from: 'setter', owner: 'sales', intent: 'run the booked call', summary: 'Booked Tue 10 am. Gym, slow replies.' });
  return s;
}
const deps = (llm: Llm, rpc: (fn: string, a: Record<string, unknown>) => Promise<unknown>, extra: Record<string, unknown> = {}) => ({ llm, rpc, auth, config: ventraSalesConfig, now: NOW, channel: 'web-chat' as const, ...extra });

test('sales config: Ventra defaults are valid, have ten objections, no prices, guarantees or discounts', () => {
  assert.doesNotThrow(() => checkedSalesConfig(ventraSalesConfig));
  assert.equal(ventraSalesConfig.objections.length, 10);
  assert.ok(ventraSalesConfig.packages.every(p => p.priceAud === null), 'no invented prices');
  assert.deepEqual(ventraSalesConfig.guarantees, []); assert.deepEqual(ventraSalesConfig.allowedDiscounts, []);
  assert.throws(() => checkedSalesConfig({ ...priced, allowedDiscounts: [{ id: 'x1', description: 'too much', percent: 80 }] }), /at most 50%/);
  assert.throws(() => checkedSalesConfig({ ...priced, packages: [...priced.packages, priced.packages[0]] }), /unique/);
  assert.throws(() => checkedSalesConfig({ ...priced, objections: [{ id: 'a1', objection: 'x', response: '', fallback: 'y' }] }), /needs an objection/);
});

test('quote: only config prices and allowed discounts; threshold and missing prices need a person', () => {
  assert.equal(quote(ventraSalesConfig, 'launch')?.needsPerson, 'No price is set for this package yet.');
  assert.equal(quote(priced, 'nope'), null);
  assert.deepEqual(quote(priced, 'launch', 'founding'), { packageId: 'launch', name: 'Launch', billing: 'per month', priceAud: 500, discountId: 'founding', totalAud: 450, needsPerson: null });
  assert.equal(quote(priced, 'launch', 'made-up')?.needsPerson, 'That discount is not allowed.');
  assert.match(quote(priced, 'big')?.needsPerson ?? '', /above A\$2000/);
});

test('prompt: opens from the handoff, lists the playbook, forbids invented terms', () => {
  const s = booked();
  const line = handoffLine(s.db as never);
  assert.match(line, /Setter summary: Booked Tue 10 am/); assert.match(line, /business: Gym in Joondalup/);
  const p = salesSystemPrompt(ventraSalesConfig, 'Tue', 'web-chat', line);
  for (const must of ['never ask these again', 'price not set', 'Do not promise any result', 'quote_package', 'escalate_human', 'contract', 'AI assistant', 'think_about_it']) assert.ok(p.includes(must), must);
});

test('scenario: no price set, lead wants to buy: quote refused, close goes to a person, nothing invented', async () => {
  const { db, rpc } = booked();
  const { llm, results } = scripted([[tool('quote_package', { package_id: 'grow' })], [tool('send_payment_link', { package_id: 'grow' })], [say('A person from Ventra will send the agreement and pricing today.')]]);
  const t = await runSalesTurn('c1', deps(llm, rpc));
  assert.match(results[0], /No price is set/); assert.match(results[1], /A person has been asked/);
  assert.equal(t.state, 'booked'); assert.equal(t.handedTo, 'human'); assert.equal(t.outcome, null);
  assert.equal(db.handoffs.at(-1)?.owner, 'human'); assert.equal(db.handoffs.at(-1)?.from, 'sales');
  assert.deepEqual(db.outbound, [{ message: 'A person from Ventra will send the agreement and pricing today.', prompt: SALES_PROMPT_VERSION }]);
  assert.equal(paymentLinksFromEnv(), null, 'no payment provider chosen yet');
});

test('scenario: priced package with a payment provider: quote, link, won; customer and onboarding handoff', async () => {
  const { db, rpc } = booked();
  const links: unknown[] = [];
  const payments = async (i: unknown) => { links.push(i); return { url: 'https://pay.example.com/abc' }; };
  const { llm, results } = scripted([[tool('quote_package', { package_id: 'launch', discount_id: 'founding' })], [tool('send_payment_link', { package_id: 'launch', discount_id: 'founding' })], [tool('record_outcome', { outcome: 'won', summary: 'Paid for Launch', score: 5 })], [say('Welcome aboard, Sam.')]]);
  const t = await runSalesTurn('c1', deps(llm, rpc, { config: priced, payments }));
  assert.match(results[0], /A\$450 per month/);
  assert.equal(t.outcome, 'won'); assert.equal(t.score, 5); assert.equal(t.state, 'customer');
  assert.deepEqual(links, [{ contact: 'c1', packageId: 'launch', totalAud: 450, description: 'Ventra Launch' }]);
  const h = db.handoffs.at(-1) as { owner: string; summary: string; nextAction: string };
  assert.equal(h.owner, 'onboarding'); assert.match(h.summary, /Score 5\/5/); assert.match(h.summary, /A\$450 per month, discount founding/); assert.match(h.nextAction, /referral/);
});

test('guardrails: won without a link is refused; above the threshold escalates; dated follow-up and lost are logged', async () => {
  let s = booked();
  let r = scripted([[tool('record_outcome', { outcome: 'won', summary: 'Said yes', score: 4 })], [say('Great!')]]);
  let t = await runSalesTurn('c1', deps(r.llm, s.rpc, { config: priced, payments: async () => ({ url: 'https://pay.example.com/x' }) }));
  assert.match(r.results[0], /Not yet/); assert.equal(t.state, 'booked'); assert.equal(t.outcome, null);

  s = booked();
  r = scripted([[tool('send_payment_link', { package_id: 'big' })], [say('A person will confirm.')]]);
  t = await runSalesTurn('c1', deps(r.llm, s.rpc, { config: priced, payments: async () => { throw new Error('must not be called'); } }));
  assert.match(r.results[0], /above A\$2000/); assert.equal(t.handedTo, 'human');

  s = booked();
  r = scripted([[tool('record_outcome', { outcome: 'follow_up', summary: 'Wants to check with partner', score: 3, follow_up_on: '2026-11-17' })], [say('Talk on the 17th.')]]);
  t = await runSalesTurn('c1', deps(r.llm, s.rpc));
  assert.equal(t.outcome, 'follow_up'); assert.equal(t.state, 'booked'); assert.match(String(s.db.handoffs.at(-1)?.nextAction), /2026-11-17/);

  s = booked();
  r = scripted([[tool('record_outcome', { outcome: 'follow_up', summary: 'Later', score: 2, follow_up_on: '2027-06-01' })], [say('ok')]]);
  await runSalesTurn('c1', deps(r.llm, s.rpc));
  assert.match(r.results[0], /within the next 90 days/);

  s = booked();
  r = scripted([[tool('record_outcome', { outcome: 'lost', summary: 'Not the right time', score: 1 })], [say('Thanks for your time.')]]);
  t = await runSalesTurn('c1', deps(r.llm, s.rpc));
  assert.equal(t.state, 'nurture'); assert.equal(s.db.handoffs.at(-1)?.owner, 'setter');
});

test('sales only acts on booked, opted-in contacts; orchestrator calls the sales hook for booked contacts', async () => {
  for (const state of ['qualified', 'customer']) {
    const s = store(state);
    const t = await runSalesTurn('c1', deps(async () => { throw new Error('no model call'); }, s.rpc));
    assert.equal(t.reply, null);
  }
  const s = booked(); s.db.contact.optedOut = true;
  assert.equal((await runSalesTurn('c1', deps(async () => { throw new Error('no model call'); }, s.rpc))).reply, null);

  const called: string[] = [];
  const rpc = async (fn: string) => fn === 'fo_ingest' ? { contact: 'c9', state: 'booked', created: false, duplicate: false, optedOut: false } : null;
  const r = await handleInbound(rpc, auth, { via: 'web-chat', sender: 'v_abcdefghijklmnop', body: 'hi', messageId: 'chat-1' }, { setter: c => called.push('setter:' + c), sales: c => called.push('sales:' + c) });
  assert.equal(r.route.agent, 'sales'); assert.deepEqual(called, ['sales:c9']);
});
