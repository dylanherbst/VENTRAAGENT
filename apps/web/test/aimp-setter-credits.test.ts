// Pay-per-chat: each customer's Claude usage is metered, credits are required, and only a verified Stripe payment adds credits.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { claudeAgent, costMicroUsd, createMemorySetterStore, createSandbox, grantTrial, handleCreditWebhook, startCreditPurchase, usageSummary, type StripeLike } from '../lib/aimp/setter/index.ts';

const T0 = new Date('2026-11-22T10:00:00Z');
const decision = { intent: 'needs_more_information', lead_stage: 'needs_more_information', response_text: 'Shipping is free anywhere in Australia.', confidence: 0.9, knowledge_source_ids: ['faq-free-shipping'], recommended_action: 'reply', handoff_reason: null, cta_id: null };

function meteredSandbox(credits: number) {
  const store = createMemorySetterStore();
  const agent = claudeAgent({ apiKey: 'k', fetch: async () => ({ status: 200, json: async () => ({ content: [{ type: 'text', text: JSON.stringify(decision) }], usage: { input_tokens: 2000, output_tokens: 300 } }) }),
    onUsage: (u) => store.addUsage({ ...u, costMicroUsd: costMicroUsd(u.model, u), at: T0.toISOString() }) });
  const sb = createSandbox({ store, agent, now: () => T0 });
  sb.store.saveConfig({ ...sb.store.config(sb.ws)!, mode: 'auto' });
  if (credits) sb.store.addCredit({ workspaceId: sb.ws, delta: credits, reason: 'test_credit', ref: 'seed', at: T0.toISOString() });
  return sb;
}

test('each Claude reply spends one credit and records real token cost for that customer only', async () => {
  const sb = meteredSandbox(2);
  assert.deepEqual((await sb.inbound('is shipping free?', '1')).results, ['sent']);
  const u = usageSummary(sb.store, sb.ws);
  assert.equal(u.creditsLeft, 1);
  assert.equal(u.aiReplies, 1);
  assert.equal(u.inputTokens, 2000);
  assert.equal(costMicroUsd('claude-haiku-5-5', { inputTokens: 2000, outputTokens: 300 }), 350); // $0.00035
  assert.equal(usageSummary(sb.store, 'someone-else').modelCalls, 0);
});

test('no credits: the AI is not called and the chat goes to the owner', async () => {
  const sb = meteredSandbox(0);
  assert.deepEqual((await sb.inbound('is shipping free?', '1')).results, ['out_of_credits']);
  assert.equal(sb.store.usage(sb.ws).length, 0);
  assert.equal(sb.sender.sent.length, 0);
  assert.equal(sb.store.conversations(sb.ws)[0]!.humanTakeover, true);
});

test('free trial is granted once; the basic rules never use credits', async () => {
  const store = createMemorySetterStore();
  grantTrial(store, 'w', T0.toISOString()); grantTrial(store, 'w', T0.toISOString());
  assert.equal(store.creditBalance('w'), 50);
  const sb = createSandbox({ now: () => T0 });
  sb.store.saveConfig({ ...sb.store.config(sb.ws)!, mode: 'auto' });
  await sb.inbound('is shipping free?', '1');
  assert.equal(sb.store.creditBalance(sb.ws), 0);
});

test('credits are added only by a signed webhook for a known purchase that Stripe confirms is paid, and only once', async () => {
  const store = createMemorySetterStore();
  let paid = true;
  const stripe: StripeLike = {
    createSession: async (i) => ({ ok: true, sessionId: 'cs_test_abc123', url: `https://checkout.stripe.com/c/pay/${i.orderId}` }),
    verifyPaid: async (_s, e) => ({ paid: paid && e.amountCents === 900, reason: paid ? 'Paid.' : 'Not paid yet.' }),
  };
  const now = () => T0;
  const start = await startCreditPurchase({ store, stripe, newId: () => 'p1', now }, { workspaceId: 'w', packId: 'pack-500', email: 'a@b.co', returnBase: 'https://app.example.com/app/w/setter' });
  assert.ok(start.ok);
  assert.equal((await startCreditPurchase({ store, stripe, newId: () => 'p2', now }, { workspaceId: 'w', packId: 'pack-free', email: 'a@b.co', returnBase: 'x' })).ok, false);
  const body = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_test_abc123', client_reference_id: 'cred_p1' } } });
  const t = Math.floor(T0.getTime() / 1000);
  const sig = (secret: string) => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
  const deps = { store, stripe, webhookSecret: 'whsec_x', now };
  assert.equal((await handleCreditWebhook(deps, body, sig('wrong'))).status, 400);
  paid = false;
  assert.match((await handleCreditWebhook(deps, body, sig('whsec_x'))).outcome, /^not_paid/);
  assert.equal(store.creditBalance('w'), 0);
  paid = true;
  assert.equal((await handleCreditWebhook(deps, body, sig('whsec_x'))).outcome, 'granted');
  assert.equal((await handleCreditWebhook(deps, body, sig('whsec_x'))).outcome, 'already_granted');
  assert.equal(store.creditBalance('w'), 500);
  const forged = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_test_other', client_reference_id: 'cred_p1' } } });
  const fsig = `t=${t},v1=${createHmac('sha256', 'whsec_x').update(`${t}.${forged}`).digest('hex')}`;
  assert.equal((await handleCreditWebhook(deps, forged, fsig)).outcome, 'unknown_purchase');
});
