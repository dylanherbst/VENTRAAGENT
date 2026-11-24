import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine, newStore, demoWriter, claudeWriter, openaiWriter, validateAngles, checkBrief, playbook, approaches, buildStrategyPrompt, type StrategyWriter, type BrandBrief } from '../lib/aimp/marketing-engine/index.ts';

const lamps = { businessName: 'Glow Haven', niche: 'sunset lamps, home decor', offer: 'A projector lamp that turns any room golden', audience: 'Renters who want a cosy bedroom', goal: 'sales', facts: ['Free shipping on orders over $50', '30 day returns'] };
const cleaners = { businessName: 'Spotless Perth', niche: 'home cleaning', offer: 'Fortnightly home cleans with the same cleaner every visit', audience: 'Busy families in Perth', goal: 'leads' };
const brief = (x: object): BrandBrief => { const r = checkBrief(x); assert.ok(r.ok); return r.brief; };
let n = 0; const id = () => `t${++n}`;

const good = (over: Record<string, unknown> = {}) => ({ angles: approaches.map((approach, i) => ({
  approach, format: i === 1 ? 'static_4x5' : i === 2 ? 'carousel_4x5' : 'reel_9x16',
  hook: ['Your room looks flat at night', 'Cheap lamp or proper glow', 'Three lighting mistakes renters make', 'No drilling, no landlord drama', 'Watch the colour change'][i],
  primary_copy: 'Plug it in and the room changes.', headline: ['Fix flat lighting', 'Glow, not glare', 'Avoid these 3', 'Renter friendly', 'See it work'][i], cta: 'Shop now', image_brief: 'Warm bedroom at dusk',
  storyboard: i === 1 || i === 2 ? [] : [{ at_seconds: 0, visual: 'dark room', overlay: 'hook', voiceover: 'hook' }, { at_seconds: 8, visual: 'lamp on', overlay: 'x', voiceover: 'x' }, { at_seconds: 18, visual: 'cosy', overlay: 'y', voiceover: 'y' }],
  claims: [], ...over,
})) });

test('brief: required fields are enforced and junk colours dropped', () => {
  const r = checkBrief({ businessName: '', niche: 'x' });
  assert.equal(r.ok, false);
  const ok = checkBrief({ ...lamps, brandColours: ['#ff8800', 'red', 'javascript:'] });
  assert.ok(ok.ok); assert.deepEqual(ok.brief.brandColours, ['#ff8800']); assert.equal(ok.brief.region, 'Australia');
});

test('demo writer: 5 valid, distinct angles, and two niches get different angles', async () => {
  const a = validateAngles((await demoWriter.write(brief(lamps))).raw, brief(lamps), id);
  const b = validateAngles((await demoWriter.write(brief(cleaners))).raw, brief(cleaners), id);
  assert.ok(a.ok && b.ok, JSON.stringify(a.ok ? '' : a.errors));
  assert.deepEqual(a.angles.map((x) => x.approach).sort(), [...approaches].sort());
  assert.notDeepEqual(a.angles.map((x) => x.hook), b.angles.map((x) => x.hook));
  for (const x of a.angles) if (x.format === 'reel_9x16') assert.ok(x.storyboard.length >= 3);
});

test('validator: rejects wrong count, duplicate approach, near-duplicate angles and banned claims', () => {
  const b = brief(lamps);
  assert.equal(validateAngles({ angles: good().angles.slice(0, 4) }, b, id).ok, false);
  const dup = good(); dup.angles[1] = { ...dup.angles[1]!, approach: 'pattern_interrupt' };
  assert.equal(validateAngles(dup, b, id).ok, false);
  const same = good(); for (const x of same.angles) { x.hook = 'Your room looks flat at night'; x.headline = 'Fix flat lighting'; }
  assert.equal(validateAngles(same, b, id).ok, false);
  for (const bad of ['Guaranteed results or your money back', 'Make $5,000 a month from your bedroom', 'Only 3 left, ends tonight', 'Totally risk-free']) {
    const g = good(); g.angles[0]!.primary_copy = bad;
    assert.equal(validateAngles(g, b, id).ok, false, bad);
  }
  assert.equal(validateAngles('not json', b, id).ok, false);
  const honest = good(); honest.angles[0]!.primary_copy = 'A better first experiment, not a guaranteed income stream.';
  assert.ok(validateAngles(honest, b, id).ok, 'negated guarantees are honest, not claims');
  assert.ok(validateAngles('```json\n' + JSON.stringify(good()) + '\n```', b, id).ok);
});

test('validator: numbers not in the owner facts are hypotheses; numbers from facts are verified', () => {
  const b = brief(lamps);
  const g = good(); g.angles[0]!.primary_copy = 'Loved by 4,000 customers. Free shipping on orders over $50.';
  const r = validateAngles(g, b, id); assert.ok(r.ok);
  const claims = r.angles[0]!.claims;
  assert.equal(claims.find((c) => c.text.includes('4,000'))?.status, 'hypothesis');
  assert.equal(claims.find((c) => c.text.includes('$50'))?.status, 'verified');
  assert.equal(r.angles[0]!.evidenceStatus, 'needs_validation');
  // The model cannot mark its own claims verified.
  const g2 = good(); g2.angles[1]!.claims = [{ text: 'Rated 4.9 stars', status: 'verified' } as never];
  const r2 = validateAngles(g2, b, id); assert.ok(r2.ok); assert.equal(r2.angles[1]!.claims[0]!.status, 'hypothesis');
});

test('engine: approval gate, edits withdraw approval, unchecked claims block approval', async () => {
  const e = createEngine({ store: newStore(), writer: demoWriter, id });
  const c = e.createCampaign('ws1', lamps); assert.ok(c.ok);
  assert.equal(e.canSchedule('ws1', c.value.id), false);
  const g = await e.generateAngles('ws1', c.value.id); assert.ok(g.ok); assert.equal(g.value.generatedBy, 'demo');
  assert.equal(e.canSchedule('ws1', c.value.id), false, 'angles alone never schedule');
  const a = g.value.angles[0]!;
  assert.ok(e.approveAngle('ws1', c.value.id, a.id).ok);
  assert.equal(e.canSchedule('ws1', c.value.id), true);
  assert.ok(e.editAngle('ws1', c.value.id, a.id, { hook: 'A brand new hook for the lamp' }).ok);
  assert.equal(e.canSchedule('ws1', c.value.id), false, 'editing the approved angle withdraws approval');
  assert.ok(e.editAngle('ws1', c.value.id, a.id, { primaryCopy: 'Over 10,000 sold this year.' }).ok);
  const blocked = e.approveAngle('ws1', c.value.id, a.id); assert.equal(blocked.ok, false);
  assert.equal(!blocked.ok && blocked.error, 'claims_unchecked');
  assert.ok(e.approveAngle('ws1', c.value.id, a.id, { confirmHypotheses: true }).ok);
  assert.equal(e.editAngle('ws1', c.value.id, a.id, { cta: 'Guaranteed to work' }).ok, false);
});

test('engine: tenant isolation', async () => {
  const store = newStore();
  const e = createEngine({ store, writer: demoWriter, id });
  const c = e.createCampaign('ws1', lamps); assert.ok(c.ok);
  assert.equal(e.get('ws2', c.value.id), null);
  assert.equal(e.list('ws2').length, 0);
  assert.equal((await e.generateAngles('ws2', c.value.id)).ok, false);
  await e.generateAngles('ws1', c.value.id);
  const a = e.get('ws1', c.value.id)!.angles[0]!;
  assert.equal(e.approveAngle('ws2', c.value.id, a.id).ok, false);
  assert.equal(e.editAngle('ws2', c.value.id, a.id, { hook: 'hijack attempt here' }).ok, false);
  assert.equal(e.canSchedule('ws2', c.value.id), false);
  assert.equal(e.unapprove('ws2', c.value.id).ok, false);
});

test('engine: retries once on bad model output, never stores half a set, meters every call', async () => {
  let calls = 0;
  const flaky: StrategyWriter = { name: 'claude-haiku-5-5', demo: false, async write() { calls++; return { raw: calls === 1 ? '{"angles":[]}' : good(), usage: { provider: 'anthropic', model: 'claude-haiku-5-5', inputTokens: 1000, outputTokens: 2000, estimatedCostUsd: 0.0011 } }; } };
  const e = createEngine({ store: newStore(), writer: flaky, id });
  const c = e.createCampaign('ws1', lamps); assert.ok(c.ok);
  const r = await e.generateAngles('ws1', c.value.id); assert.ok(r.ok); assert.equal(calls, 2);
  assert.deepEqual(e.usage('ws1'), { events: 2, estimatedCostUsd: 0.0022 });
  assert.deepEqual(e.usage('ws2'), { events: 0, estimatedCostUsd: 0 });
  const broken: StrategyWriter = { name: 'x', demo: false, async write() { return { raw: 'nope', usage: null }; } };
  const e2 = createEngine({ store: newStore(), writer: broken, id });
  const c2 = e2.createCampaign('ws1', lamps); assert.ok(c2.ok);
  const r2 = await e2.generateAngles('ws1', c2.value.id); assert.equal(r2.ok, false);
  assert.equal(e2.get('ws1', c2.value.id)!.angles.length, 0);
});

test('claude writer: sends the brief, parses text, records usage; HTTP errors throw with usage', async () => {
  let sent: { url: string; body: Record<string, unknown>; headers: Record<string, string> } | null = null;
  const w = claudeWriter({ apiKey: 'k', fetch: async (url, init) => { sent = { url, body: JSON.parse(init.body), headers: init.headers }; return { status: 200, json: async () => ({ content: [{ type: 'text', text: JSON.stringify(good()) }], usage: { input_tokens: 2000, output_tokens: 1000 } }) }; } });
  const out = await w.write(brief(lamps));
  assert.equal(sent!.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(sent!.headers['anthropic-version'], '2023-06-01');
  assert.match(JSON.stringify(sent!.body), /Glow Haven/);
  assert.equal(out.usage?.estimatedCostUsd, 0.0007);
  assert.ok(validateAngles(out.raw, brief(lamps), id).ok);
  const bad = claudeWriter({ apiKey: 'k', fetch: async () => ({ status: 529, json: async () => ({ usage: { input_tokens: 5, output_tokens: 0 } }) }) });
  await assert.rejects(bad.write(brief(lamps)), /writer_http_529/);
});

test('openai writer: Responses API with strict schema; reads output_text or output content', async () => {
  let body: { text: { format: { type: string; strict: boolean } } } = { text: { format: { type: "", strict: false } } };
  const w = openaiWriter({ apiKey: 'k', model: 'some-model', fetch: async (_u, init) => { body = JSON.parse(init.body); return { status: 200, json: async () => ({ output: [{ content: [{ type: 'output_text', text: JSON.stringify(good()) }] }], usage: { input_tokens: 1, output_tokens: 1 } }) }; } });
  const out = await w.write(brief(cleaners));
  assert.equal(body.text.format.type, 'json_schema'); assert.equal(body.text.format.strict, true);
  assert.ok(validateAngles(out.raw, brief(cleaners), id).ok);
});

test('prompt: facts are the only claimable truths; playbook style reference included', () => {
  const p = buildStrategyPrompt(brief(cleaners));
  assert.match(p.user, /FACTS/); assert.match(p.user, /none given/);
  assert.match(p.system, /Never promise income/);
  assert.match(p.system, /Style reference/);
});

test('playbook: 20 niches x 5 ads, one per approach, no banned claims', () => {
  assert.equal(playbook.length, 20);
  for (const n of playbook) {
    assert.equal(n.ads.length, 5, n.name);
    assert.deepEqual(n.ads.map((a) => a.approach), [...approaches]);
    for (const a of n.ads) { assert.ok(a.hook && a.primaryCopy && a.cta && a.brief, a.code); assert.ok(a.cta.length <= 40, a.code); }
  }
});

test('studio: every playbook niche imports as a valid 5-angle campaign for AiMoneyPrinter', () => {
  const e = createEngine({ store: newStore(), writer: demoWriter, id });
  for (const n of playbook) {
    const r = e.importNiche('studio', n.id);
    assert.ok(r.ok, `${n.id}: ${!r.ok && r.details?.join('; ')}`);
    assert.equal(r.value.angles.length, 5); assert.equal(r.value.brief.businessName, 'AiMoneyPrinter');
    assert.equal(e.canSchedule('studio', r.value.id), false);
  }
  assert.equal(e.importNiche('studio', '99').ok, false);
  assert.equal(e.list('ws1').length, 0);
});
