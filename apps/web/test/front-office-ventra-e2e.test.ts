// Ventra as customer zero, end to end with a scripted model: a website-chat lead is qualified and booked by the Setter
// (Ventra's own settings, no saved settings needed), and a phone caller asks something not in the FAQ and leaves a
// message. Checks the records both leave behind.
import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers/route-harness.ts';

const { store } = await import('./helpers/front-office-store.ts');
const { loadSetter, templateSettings } = await import('../lib/front-office/settings.ts');
const { runSetterTurn } = await import('../lib/front-office/setter/agent.ts');
const { runReceptionistTurn } = await import('../lib/front-office/receptionist/agent.ts');
const { streamOf } = await import('../lib/front-office/llm.ts');
const { offerTimes } = await import('../lib/front-office/booking.ts');
type Llm = import('../lib/front-office/llm.ts').Llm;
type Block = import('../lib/front-office/llm.ts').Block;

const NOW = Date.parse('2026-11-09T00:30:00Z');
const auth = { channel: '66666666-6666-4666-8666-666666666666', key: 'k'.repeat(40) };
const tool = (name: string, input: Record<string, unknown>, id = name): Block => ({ type: 'tool_use', id, name, input });
const say = (text: string): Block => ({ type: 'text', text });
const scripted = (steps: Block[][]): Llm => { let i = 0; return async () => { const content = steps[Math.min(i++, steps.length - 1)]; return { content, stopReason: content.some(b => b.type === 'tool_use') ? 'tool_use' : 'end_turn' }; }; };
const calendar = { busy: async () => [], createEvent: async (e: { id: string }) => ({ id: e.id, htmlLink: null, existed: false }), hasEvent: async () => false };

test('Ventra chat lead: qualified and booked by the Setter on Ventra’s own settings', async () => {
  const { db, rpc: base } = store('new', [{ direction: 'inbound', body: 'Do you work with gyms?' }], null);
  const rpc = async (fn: string, a: Record<string, unknown>) => fn === 'fo_channel_settings' ? null : base(fn, a);
  const setter = await loadSetter(rpc, auth);
  assert.equal(setter.config.businessName, 'Ventra'); assert.equal(setter.on, true);
  const slot = (await offerTimes(calendar, setter.config.availability, NOW)).at(-1)!;
  const answers = { business: 'Iron Gym, Joondalup', lead_flow: '30 a week from Instagram', problem: 'Nobody replies after hours', timing: 'This month' };
  const turn = await runSetterTurn('c1', { llm: scripted([
    [tool('save_answers', { answers, name: 'Alex', email: 'alex@irongym.example' }), tool('set_stage', { stage: 'qualified', reason: 'Gym owner, clear need' }, 's2')],
    [tool('offer_times', {})],
    [tool('book_time', { start: new Date(slot.start).toISOString() })],
  ]), rpc, auth, calendar, send: async () => ({ sent: false, sid: null }), config: setter.config, now: NOW, channel: 'web-chat' });
  assert.equal(turn.booked, true); assert.equal(db.contact.state, 'booked');
  assert.match(turn.reply ?? '', /You're booked with Ventra/);
  assert.equal(db.handoffs[0].owner, 'sales');
});

test('Ventra phone call: a question not in the FAQ becomes a message for the team', async () => {
  const { db, rpc: base } = store('new', [], '+61411111111');
  const outcomes: string[] = [], sms: string[] = [];
  const rpc = async (fn: string, a: Record<string, unknown>) => fn === 'fo_voice_outcome' ? (outcomes.push(a.outcome as string), null) : fn === 'fo_voice_reply' ? 'm' : base(fn, a);
  const settings = { ...templateSettings('ventra'), staffPhone: '+61400000009', voiceOn: true };
  const gen = runReceptionistTurn({
    llm: streamOf(scripted([
      [tool('answer_faq', { question: 'Do you integrate with Mindbody?' })],
      [say('I don’t have that in front of me. '), tool('take_message', { message: 'Wants to know about Mindbody integration.', name: 'Jo' })],
      [say('I’ve passed it on and the team will call you back.')],
    ])),
    rpc, auth, calendar, send: async (to: string) => { sms.push(to); return { sent: false, sid: null }; }, email: async () => ({ sent: false, id: null }),
    settings, now: NOW, call: { id: 'call_ventra001', caller: '+61411111111', contact: 'c1' }, conversation: [{ role: 'user', content: 'Do you integrate with Mindbody?' }],
  });
  let said = ''; for await (const o of gen) if (o.type === 'text') said += o.text;
  assert.deepEqual(outcomes, ['faq-miss', 'message']);
  assert.equal(db.handoffs[0].owner, 'human'); assert.match(String(db.handoffs[0].summary), /Mindbody/);
  assert.deepEqual(sms, ['+61400000009']);
  assert.match(said, /call you back/);
});
