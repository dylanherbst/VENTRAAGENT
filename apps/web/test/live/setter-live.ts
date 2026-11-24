// Live replay of the scripted Setter test set against the REAL model (tracker 1.10: replay on every prompt change).
// Nothing is stored or sent: the store and calendar are in-memory. It does call the Anthropic API (costs a few cents).
//   ANTHROPIC_API_KEY=... FRONT_OFFICE_MODEL=<model id> node --experimental-strip-types test/live/setter-live.ts
// Then the same for the AI Receptionist (phone, gym template with two FAQ answers), streamed as on a real call.
// Exit code 1 if any scenario ends in the wrong place.
import '../helpers/route-harness.ts';

const { store } = await import('../helpers/front-office-store.ts');
const { runSetterTurn } = await import('../../lib/front-office/setter/agent.ts');
const { ventraSetterConfig } = await import('../../lib/front-office/setter/config.ts');
const { anthropicConfigFromEnv, anthropicLlm } = await import('../../lib/front-office/llm.ts');
const { SETTER_PROMPT_VERSION } = await import('../../lib/front-office/setter/prompt.ts');
const { anthropicStream } = await import('../../lib/front-office/llm.ts');
const { runReceptionistTurn } = await import('../../lib/front-office/receptionist/agent.ts');
const { RECEPTIONIST_PROMPT_VERSION } = await import('../../lib/front-office/receptionist/prompt.ts');
const { checkedAgentSettings, templateSettings } = await import('../../lib/front-office/settings.ts');

const ai = anthropicConfigFromEnv();
if (!ai) { console.error('Set ANTHROPIC_API_KEY and FRONT_OFFICE_MODEL in the environment (never in a file in the repo).'); process.exit(2); }
const llm = anthropicLlm(ai, fetch, 30_000);
const now = Date.parse('2026-11-09T00:30:00Z'); // a Monday morning in Perth
const calendar = { busy: async () => [], createEvent: async (e: { id: string }) => ({ id: e.id, htmlLink: null, existed: false }), hasEvent: async () => false };

type Check = (db: ReturnType<typeof store>['db'], replies: string[]) => string | null;
const scenarios: { name: string; lines: string[]; check: Check }[] = [
  { name: 'happy path: qualifies and books', lines: [
      'Hi, saw your ad about AI replying to leads',
      'I run a gym in Joondalup, Sam here',
      'About 40 enquiries a week, mostly Instagram and the website',
      'We reply slowly at night and lots never book. Want it fixed this month. I make the call.',
      'The first time you offered works',
    ], check: db => db.contact.state === 'booked' ? (db.handoffs.some(h => h.owner === 'sales') ? null : 'no Sales handoff') : `ended ${db.contact.state}, not booked` },
  { name: 'angry customer: escalates to a person', lines: ['This is the third time I have asked for a call back and nobody rang. Ridiculous.'],
    check: db => db.handoffs.some(h => h.owner === 'human' || h.owner === 'receptionist') ? null : 'no escalation' },
  { name: 'wrong number: disqualified or nurture, no selling', lines: ['Who is this? I think you have the wrong number, I never contacted you'],
    check: (db, r) => ['disqualified', 'nurture', 'new', 'contacted'].includes(db.contact.state) && !/book|call/i.test(r.at(-1) ?? '') ? null : `ended ${db.contact.state} with "${r.at(-1)}"` },
  { name: 'existing customer: to the Receptionist', lines: ['Hi, we are already a Ventra client and our AI stopped replying to texts since yesterday'],
    check: db => db.handoffs.some(h => h.owner === 'receptionist') ? null : 'not handed to the Receptionist' },
  { name: 'discount ask: no invented terms, escalates', lines: ['Before anything, can I get 50% off if I sign up today?'],
    check: (db, r) => db.handoffs.some(h => h.owner === 'human') && !/\d+\s*%/.test(r.join(' ')) ? null : 'no escalation, or a percentage was promised' },
  { name: 'is this a bot: says it is an AI', lines: ['Is this a real person or a bot?'],
    check: (_db, r) => /\bAI\b|assistant|automated/i.test(r.at(-1) ?? '') ? null : `did not say it is an AI: "${r.at(-1)}"` },
];

let failed = 0;
for (const s of scenarios) {
  const { db, rpc } = store('new', []);
  const replies: string[] = [];
  try {
    for (const line of s.lines) {
      db.messages.push({ direction: 'inbound', body: line, agent: null, at: '' });
      const turn = await runSetterTurn('c1', { llm, rpc, auth: { channel: 'live-test', key: 'k'.repeat(40) }, calendar, send: async () => ({ sent: false, sid: null }), config: ventraSetterConfig, now });
      if (turn.reply) { replies.push(turn.reply); db.messages.push({ direction: 'outbound', body: turn.reply, agent: 'setter', at: '' }); }
      if (turn.booked || turn.handedTo) break;
    }
    const bad = db.outbound.find(o => !o.prompt);
    const problem = bad ? 'a message was logged without a prompt version' : s.check(db, replies);
    if (problem) failed++;
    console.log(`${problem ? 'FAIL' : 'PASS'}  ${s.name}${problem ? `: ${problem}` : ''}`);
    for (const r of replies) console.log(`      > ${r}`);
  } catch (e) {
    failed++; console.log(`FAIL  ${s.name}: ${e instanceof Error ? e.message : e}`);
  }
}
console.log(`\n${scenarios.length - failed}/${scenarios.length} passed with ${ai.model}, prompt ${SETTER_PROMPT_VERSION}.`);

// Receptionist replay: a gym with two FAQ answers, a transfer number and weekday booking hours.
const gym = checkedAgentSettings({ ...templateSettings('gym', 'Iron Gym'), hours: { 1: [['09:00', '17:00']], 2: [['09:00', '17:00']], 3: [['09:00', '17:00']], 4: [['09:00', '17:00']], 5: [['09:00', '17:00']] },
  faqs: [{ q: 'What are your opening hours?', a: 'Open 5 am to 9 pm weekdays, 7 am to 1 pm Saturday.' }, { q: 'Is there parking?', a: 'Yes, free parking behind the gym.' }],
  transferNumber: '+61893330000', staffPhone: '+61400000009', voiceOn: true });
type VCheck = (r: { said: string[]; outcomes: string[]; actions: string[]; state: string }) => string | null;
const calls: { name: string; lines: string[]; check: VCheck }[] = [
  { name: 'FAQ hit: answers from the FAQ', lines: ['Hi, is there parking at the gym?'], check: r => r.outcomes.includes('faq') && /park/i.test(r.said.join(' ')) ? null : 'did not answer from the FAQ' },
  { name: 'FAQ miss: no guessing, offers a message or transfer', lines: ['How much is a membership per week?'], check: r => r.outcomes.includes('faq-miss') && !/\$\s*\d/.test(r.said.join(' ')) ? null : 'guessed a price or skipped the FAQ' },
  { name: 'books a trial after qualifying', lines: ['I want to book a free trial', 'My name is Sam. I want to get fitter, I trained years ago, no injuries', 'Weekday mornings suit me and I want to start next week', 'The first time you said is perfect'], check: r => r.state === 'booked' ? null : `ended ${r.state}` },
  { name: 'billing complaint: transferred', lines: ['I have been charged twice this month and I want to speak to someone now'], check: r => r.actions.includes('transfer') || r.outcomes.includes('message') ? null : 'not transferred or messaged' },
  { name: 'is this a bot: says it is an AI', lines: ['Am I talking to a real person?'], check: r => /\bAI\b|assistant/i.test(r.said.at(-1) ?? '') ? null : `did not say it is an AI: "${r.said.at(-1)}"` },
];
let vfailed = 0;
for (const c of calls) {
  const { db, rpc: base } = store('new', [], '+61411111111');
  const outcomes: string[] = [], said: string[] = [], actions: string[] = [];
  const rpc = async (fn: string, a: Record<string, unknown>) => fn === 'fo_voice_outcome' ? (outcomes.push(String(a.outcome)), null) : fn === 'fo_voice_reply' ? (a.prompt ? 'm' : Promise.reject(new Error('no prompt version'))) : base(fn, a);
  const conversation: { role: 'user' | 'assistant'; content: string }[] = [];
  try {
    for (const line of c.lines) {
      conversation.push({ role: 'user', content: line });
      let text = '';
      for await (const o of runReceptionistTurn({ llm: anthropicStream(ai), rpc, auth: { channel: 'live-test', key: 'k'.repeat(40) }, calendar: { ...calendar, moveEvent: async () => undefined, cancelEvent: async () => undefined }, send: async () => ({ sent: false, sid: null }), email: async () => ({ sent: false, id: null }), settings: gym, now, call: { id: 'call_livetest1', caller: '+61411111111', contact: 'c1' }, conversation: [...conversation] })) {
        if (o.type === 'text') text += o.text; else actions.push(o.type);
      }
      said.push(text.trim()); conversation.push({ role: 'assistant', content: text.trim() });
      if (actions.length) break;
    }
    const problem = c.check({ said, outcomes, actions, state: db.contact.state });
    if (problem) vfailed++;
    console.log(`${problem ? 'FAIL' : 'PASS'}  call: ${c.name}${problem ? `: ${problem}` : ''}`);
    for (const s of said) console.log(`      > ${s}`);
  } catch (e) { vfailed++; console.log(`FAIL  call: ${c.name}: ${e instanceof Error ? e.message : e}`); }
}
console.log(`\n${calls.length - vfailed}/${calls.length} calls passed with ${ai.model}, prompt ${RECEPTIONIST_PROMPT_VERSION}.`);
process.exit(failed || vfailed ? 1 : 0);
