// The test-lab mock store (Glow Haven, Sunset Lamp): the rule agent answers the questions buyers actually ask, from the store's facts.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSandbox } from '../lib/aimp/setter/index.ts';

const T0 = new Date('2026-11-22T10:00:00Z');
async function ask(text: string) {
  const sb = createSandbox({ now: () => T0 });
  sb.store.saveConfig({ ...sb.store.config(sb.ws)!, mode: 'auto' });
  const r = await sb.inbound(text, '5001');
  return { result: r.results[0], reply: sb.sender.sent[0]?.text ?? '' };
}

test('answers real buyer questions from the facts, sounding like a person', async () => {
  const cases: [string, RegExp][] = [
    ['how much is the sunset lamp?', /\$39.*glowhaven\.example\.com\/sunset-lamp/],
    ['do you have a 2 pack? want to buy two', /\$69.*2-pack/],
    ['how long does shipping take to perth?', /7 to 12 business days/],
    ['does it get hot? can I leave it on overnight', /warm/],
    ['does it come with a remote or an app?', /remote/],
    ['kmart has one way cheaper, why is yours more?', /budget ones are a fine pick/],
    ['will it help me sleep?', /decor light/],
    ['what if it arrives broken', /12 month warranty/],
    ['is it good for tiktok photos', /golden-hour/],
  ];
  for (const [q, want] of cases) {
    const { result, reply } = await ask(q);
    assert.equal(result, 'sent', q);
    assert.match(reply, want, q);
    assert.doesNotMatch(reply, /\b(AI|assistant|Thank you for reaching out)\b/, q);
  }
});

test('order problems go to a person, not the bot', async () => {
  assert.equal((await ask('my order never arrived, this is a scam')).result, 'handoff');
});

test('rules fallback: budget worries get the value answer and the qualifying question is never repeated', async () => {
  const sb = createSandbox({ now: () => T0 });
  sb.store.saveConfig({ ...sb.store.config(sb.ws)!, mode: 'auto' });
  await sb.inbound('hello', '6001');
  await sb.inbound('seems a bit pricey', '6001');
  await sb.inbound('for myself i just dont know if it fits my budget', '6001');
  const texts = sb.sender.sent.map((m) => m.text);
  assert.equal(texts.filter((t) => t.includes('Is it for your own room or a gift?')).length, 1);
  assert.match(texts[1]!, /budget ones are a fine pick/);
});

test('Claude agent: sends the conversation as alternating turns and its JSON goes through the same checks', async () => {
  const { claudeAgent, toMessages } = await import('../lib/aimp/setter/index.ts');
  const calls: { url: string; body: Record<string, unknown>; headers: Record<string, string> }[] = [];
  const reply = { intent: 'needs_more_information', lead_stage: 'needs_more_information', response_text: "Totally get it. There's free shipping and 30-day returns, so you can try it and send it back if it's not for you.", confidence: 0.8, knowledge_source_ids: ['faq-returns'], recommended_action: 'reply', handoff_reason: null, cta_id: null };
  const agent = claudeAgent({ apiKey: 'sk-ant-test', fetch: async (url, init) => { calls.push({ url, body: JSON.parse(init.body!), headers: init.headers }); return { status: 200, json: async () => ({ content: [{ type: 'text', text: 'Here you go:\n' + JSON.stringify(reply) }] }) }; } });
  const sb = createSandbox({ now: () => T0, agent });
  sb.store.saveConfig({ ...sb.store.config(sb.ws)!, mode: 'auto' });
  sb.store.addCredit({ workspaceId: sb.ws, delta: 10, reason: 'test_credit', ref: 'seed', at: T0.toISOString() });
  await sb.inbound('how much is it', '7001');
  const r = await sb.inbound('seems a bit pricey', '7001');
  assert.equal(calls[0]!.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(calls[0]!.headers['x-api-key'], 'sk-ant-test');
  assert.equal(calls[0]!.body.model, 'claude-haiku-5-5');
  const msgs = calls[1]!.body.messages as { role: string; content: string }[];
  assert.deepEqual(msgs.map((m) => m.role), ['user', 'assistant', 'user']);
  assert.match(String(calls[1]!.body.system), /Never ask something already answered/);
  assert.deepEqual(r.results, ['sent']);
  assert.match(sb.sender.sent.at(-1)!.text, /30-day returns/);
  assert.deepEqual(toMessages({ config: sb.store.config(sb.ws)!, history: [{ direction: 'out', text: 'hi' }, { direction: 'in', text: 'a' }, { direction: 'in', text: 'b' }], latest: 'c' }).map((m) => m.content), ['a\nb\nc']);
  const down = claudeAgent({ apiKey: 'k', fetch: async () => ({ status: 529, json: async () => ({}) }) });
  await assert.rejects(down.decide({ config: sb.store.config(sb.ws)!, history: [], latest: 'hi' }));
});
