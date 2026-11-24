// A-24 industry presets (Beauty, Fitness, Trades) for the AI Setter and Receptionist. Pure data, no network: proves
// the presets use the real A-16 knowledge base shapes (the settings validator accepts them unchanged), every value is
// flagged as an example the business edits, example conversations never state a price in plain text (placeholders
// resolve from the business's own saved knowledge), unsafe claims are absent, and the template plugs into the same
// shape as the gym template.
import test from 'node:test';
import assert from 'node:assert/strict';
// Registers the extensionless-import resolver that settings.ts needs under plain Node (same as the other settings tests).
import './helpers/route-harness.ts';

const { listIndustryPresets, getIndustryPreset, fillExamplePlaceholders, EXAMPLE_LABEL } = await import('../lib/front-office/templates/presets.ts');
const { gymTemplate } = await import('../lib/front-office/templates/gym.ts');
const { checkedKnowledge, checkedAgentSettings, emptyKnowledge } = await import('../lib/front-office/settings.ts');

const presets = listIndustryPresets();

test('three presets exist: beauty, fitness, trades, with unique ids', () => {
  assert.equal(presets.length, 3);
  const ids = presets.map((p) => p.id);
  assert.deepEqual([...ids].sort(), ['beauty', 'fitness', 'trades']);
  assert.equal(new Set(ids).size, ids.length);
});

test('each preset has services, cancellation/deposit/lateness policies, qualification, booking types, FAQs and two example conversations', () => {
  for (const p of presets) {
    assert.ok(p.knowledge.services.length > 0, `${p.id} services`);
    for (const kind of ['cancellation', 'deposit', 'lateness']) assert.ok(p.knowledge.policies.some((x) => x.id === kind), `${p.id} ${kind}`);
    assert.ok(p.qualification.length > 0 && p.qualification.some((q) => q.required), `${p.id} qualification`);
    assert.ok(p.bookingTypes.length > 0, `${p.id} booking types`);
    assert.ok(p.faqs.length > 0, `${p.id} faqs`);
    assert.equal(p.exampleConversations.length, 2, `${p.id} conversations`);
    for (const c of p.exampleConversations) assert.ok(c.turns.length >= 2 && c.turns.some((t) => t.from === 'ai'));
  }
});

test('the settings validator (checkedKnowledge) accepts every preset knowledge base unchanged', () => {
  for (const p of presets) assert.deepEqual(checkedKnowledge(p.knowledge), p.knowledge, p.id);
});

test('a full settings object built from each preset passes checkedAgentSettings', () => {
  for (const p of presets) {
    const st = checkedAgentSettings({
      template: 'custom', businessName: 'Test business', offer: p.template.offer, idealCustomer: p.template.idealCustomer, notAFit: p.template.notAFit,
      bookingType: p.template.bookingType, bookingWhere: p.template.bookingWhere, bookingMinutes: p.template.bookingMinutes, timeZone: 'Australia/Perth',
      hours: {}, questions: p.qualification, faqs: p.faqs, knowledge: p.knowledge, greeting: p.template.greeting, aiDisclosure: p.template.aiDisclosure,
    });
    assert.deepEqual(st.knowledge, p.knowledge, p.id);
    assert.deepEqual(st.faqs, p.faqs, p.id);
  }
});

test('booking types are derived from services that have a length; the template main booking is the first', () => {
  for (const p of presets) {
    const timed = p.knowledge.services.filter((s) => s.durationMinutes !== null);
    assert.deepEqual(p.bookingTypes.map((b) => [b.id, b.name, b.minutes]), timed.map((s) => [s.id, s.name, s.durationMinutes]), p.id);
    assert.equal(p.template.bookingType, p.bookingTypes[0].name);
    assert.equal(p.template.bookingMinutes, p.bookingTypes[0].minutes);
  }
});

test('every service and policy is covered by the example flag; free items are priceAud 0 with a free note', () => {
  for (const p of presets) {
    assert.equal(p.exampleValues, true);
    assert.equal(p.exampleLabel, EXAMPLE_LABEL);
    assert.deepEqual(p.exampleIds.services, p.knowledge.services.map((s) => s.id));
    assert.deepEqual(p.exampleIds.policies, p.knowledge.policies.map((x) => x.id));
    for (const s of p.knowledge.services) {
      if (s.priceAud === 0) assert.match(s.description, /\bfree\b/i, `${p.id} ${s.id}`);
    }
    // Policies never carry a dollar amount: the business sets its own.
    for (const x of p.knowledge.policies) assert.ok(!x.text.includes('$'), `${p.id} ${x.id}`);
  }
});

test('template facts are empty (as in gymTemplate): no price text outside the knowledge base', () => {
  for (const p of presets) assert.deepEqual(p.template.facts, []);
});

test('example conversations never state a price in plain text; placeholders name real services and resolve from saved knowledge', () => {
  let placeholders = 0;
  for (const p of presets) {
    for (const c of p.exampleConversations) {
      for (const t of c.turns) {
        assert.ok(!t.text.includes('$'), `${p.id} "${c.title}": ${t.text}`);
        for (const [, id] of t.text.matchAll(/\{price:([a-z0-9_-]+)\}/g)) {
          placeholders++;
          assert.ok(p.knowledge.services.some((s) => s.id === id), `${p.id} placeholder ${id}`);
        }
        const filled = fillExamplePlaceholders(t.text, p.knowledge);
        assert.ok(!/\{price:/.test(filled), filled);
        // With no saved prices the AI never states one.
        const none = fillExamplePlaceholders(t.text, emptyKnowledge());
        assert.ok(!none.includes('$'), none);
      }
    }
  }
  assert.ok(placeholders >= 3);
  const beauty = getIndustryPreset('beauty');
  assert.ok(beauty);
  assert.equal(fillExamplePlaceholders('Lashes are {price:classic-lashes}.', beauty.knowledge), 'Lashes are $120.');
  beauty.knowledge.services[2].priceAud = 135;
  assert.equal(fillExamplePlaceholders('Lashes are {price:classic-lashes}.', beauty.knowledge), 'Lashes are $135.');
  beauty.knowledge.services[2].priceAud = null;
  assert.equal(fillExamplePlaceholders('Lashes are {price:classic-lashes}.', beauty.knowledge), 'Lashes are a price the team will confirm.');
  assert.equal(fillExamplePlaceholders('{price:quote}', getIndustryPreset('trades')!.knowledge), 'free');
});

test('no unsafe claims: no "guarantee", "licensed" or "will plan around" anywhere in preset text', () => {
  for (const p of presets) {
    const text = JSON.stringify(p);
    for (const bad of [/guarantee/i, /\blicensed\b/i, /will plan around/i]) assert.ok(!bad.test(text), `${p.id} contains ${bad}`);
  }
});

test('trades emergency wording: hedged water advice, hand to a person, and 000 for gas, fire or electrical danger', () => {
  const t = getIndustryPreset('trades');
  assert.ok(t);
  const emergency = t.exampleConversations.find((c) => /emergency/i.test(c.title));
  assert.ok(emergency);
  const ai = emergency.turns.filter((x) => x.from === 'ai').map((x) => x.text).join(' ');
  assert.ok(ai.includes('If it is safe to do so, you may want to turn the water off; I am passing this to the team now.'), ai);
  assert.match(ai, /gas, fire or electrical danger, call 000/);
  const faq = t.faqs.find((f) => /emergenc/i.test(f.q));
  assert.ok(faq);
  assert.match(faq.a, /gas, fire or electrical danger, call 000/);
  assert.ok(t.faqs.some((f) => f.a === 'A person will confirm licence and insurance details.'));
  assert.doesNotMatch(t.template.notAFit, /licen/i);
  // Cleaners have no call-out default: the call-out service and cancellation fee do not apply to cleaning.
  const clean = t.knowledge.services.find((s) => s.id === 'regular-clean');
  assert.ok(clean && !/call-out/i.test(clean.name + clean.description));
  assert.doesNotMatch(t.knowledge.policies.find((x) => x.id === 'cancellation')!.text, /call-out/i);
});

test('fitness injury handling: a person will confirm; beauty patch test and removal answers defer to the salon', () => {
  const f = getIndustryPreset('fitness')!;
  const knee = f.exampleConversations[0].turns.find((x) => x.from === 'ai')!.text;
  assert.match(knee, /a person will confirm/i);
  const b = getIndustryPreset('beauty')!;
  assert.match(b.faqs.find((x) => /patch test/i.test(x.q))!.a, /ask the salon|person will confirm/i);
  assert.match(b.faqs.find((x) => /remove/i.test(x.q))!.a, /will confirm/i);
});

test('unknown id returns null; known id returns the preset', () => {
  assert.equal(getIndustryPreset('nope'), null);
  assert.equal(getIndustryPreset(''), null);
  assert.equal(getIndustryPreset('beauty')?.id, 'beauty');
});

test('template has every gym template key, so presets plug into the existing settings shape', () => {
  for (const p of presets) {
    for (const key of Object.keys(gymTemplate)) assert.ok(key in p.template, `${p.id} template.${key}`);
    assert.ok(p.template.questions.length > 0);
  }
});

test('returned presets are copies: editing one does not change the shared data', () => {
  const a = getIndustryPreset('trades');
  assert.ok(a);
  a.knowledge.services[0].name = 'changed';
  assert.notEqual(getIndustryPreset('trades')?.knowledge.services[0].name, 'changed');
});
