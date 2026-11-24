// Per-customer business profile, sales prompt and "never says it's AI unprompted" rules.
import assert from 'node:assert/strict';
import test from 'node:test';
import { applyPolicy, buildPrompt, createSandbox, defaultConfig, profileGaps, sampleConfig, type AgentDecision } from '../lib/aimp/setter/index.ts';

const T0 = new Date('2026-11-22T10:00:00Z');
const cfg = { ...sampleConfig('w', T0), mode: 'auto' as const };
const conv = { id: 'c', workspaceId: 'w', igAccountId: '1', igsid: '2', state: 'open' as const, humanTakeover: false, lastInboundAt: T0.toISOString(), lastActivityAt: T0.toISOString(), unread: 0, aiDisclosed: true, pitchesDeclined: 0 };
const el = { canSend: true, canDraft: true };
const dec = (text: string, ids = ['offer-lamp']): AgentDecision => ({ intent: 'interested', lead_stage: 'interested', response_text: text, confidence: 0.9, knowledge_source_ids: ids, recommended_action: 'reply', handoff_reason: null, cta_id: null });

test('never mentions being AI unless asked: such a reply becomes a draft for the owner', () => {
  assert.equal(applyPolicy(dec("As an AI I'd say it's lovely."), cfg, conv, el).action, 'draft');
  assert.equal(applyPolicy(dec("I'm a chatbot but happy to help."), cfg, conv, el).action, 'draft');
  assert.equal(applyPolicy(dec("I'm the store's automated assistant."), cfg, conv, el, { askedIfBot: true }).action, 'send');
  assert.equal(applyPolicy(dec('It makes the room feel so cosy.'), cfg, conv, el).action, 'send');
});

test('only real saved testimonials can be quoted', () => {
  const withReview = { ...cfg, testimonials: ['Honestly the best thing in my room, the glow is gorgeous'] };
  assert.equal(applyPolicy(dec('One customer said "Honestly the best thing in my room, the glow is gorgeous"', ['testimonials']), withReview, conv, el).action, 'send');
  assert.equal(applyPolicy(dec('People say "this lamp changed my whole life and sleep"', ['testimonials']), withReview, conv, el).action, 'handoff');
});

test('owner can choose: "are you a bot?" is answered honestly or handed to them', async () => {
  const a = createSandbox({ now: () => T0 });
  a.store.saveConfig({ ...a.store.config(a.ws)!, mode: 'auto', botQuestion: 'handoff' });
  assert.deepEqual((await a.inbound('are you a bot?', '1')).results, ['handoff']);
  assert.equal(a.sender.sent.length, 0);
  const b = createSandbox({ now: () => T0 });
  b.store.saveConfig({ ...b.store.config(b.ws)!, mode: 'auto', botQuestion: 'honest' });
  assert.deepEqual((await b.inbound('are you a bot?', '1')).results, ['sent']);
});

test('the sales prompt carries product details, policies, selling points and prepared objection answers', () => {
  const { system } = buildPrompt({ config: cfg, history: [], latest: 'hi' });
  for (const want of [/About 26 cm tall/, /\[shipping\] Shipping: Free shipping/, /\[obj-price\]/, /Why people buy/, /\[upsell\]/, /top-performing salesperson/, /Never ask something already answered|never repeat yourself/i]) assert.match(system, want);
  assert.doesNotMatch(system, /There is NO information about/);
  const bare = buildPrompt({ config: { ...defaultConfig('x', T0), businessName: 'X' }, history: [], latest: 'hi' }).system;
  assert.match(bare, /There is NO information about: shipping, returns, warranty/);
});

test('profile gaps tell a new customer exactly what to fill in', () => {
  const gaps = profileGaps(defaultConfig('new', T0)).map((g) => g.field);
  assert.ok(gaps.includes('Shipping') && gaps.includes('Returns') && gaps.includes('Business name'));
  assert.deepEqual(profileGaps(cfg), []);
});

test('amounts the owner wrote (like a bundle saving) are allowed; invented ones are not', () => {
  assert.equal(applyPolicy(dec('The 2-pack is $69, which saves you $9.', ['offer-bundle']), cfg, conv, el).action, 'send');
  assert.equal(applyPolicy(dec('The 2-pack saves you $15.', ['offer-bundle']), cfg, conv, el).action, 'handoff');
});
