// G5: a dropped call (caller hung up, or an error) before anything was settled leaves exactly one call-back handoff for
// staff via the Vapi end-of-call report. In-memory store, no network, nothing sent, live flags off.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRequest } from './helpers/route-harness.ts';

const { store } = await import('./helpers/front-office-store.ts');
const { checkedAgentSettings, templateSettings } = await import('../lib/front-office/settings.ts');
const { vapiWebhook } = await import('../lib/front-office/vapi-route.ts');

const auth = { channel: '55555555-5555-4555-8555-555555555555', key: 'k'.repeat(40) };
const CALLER = '+61411111111';

function voiceStore(outcomes: string[] = []) {
  const base = store('qualifying', [], CALLER);
  base.db.contact.name = 'Pat'; base.db.contact.answers = { goal: 'Strength' };
  const log = { outcomes: [...outcomes], ends: 0, sent: 0 };
  const rpc = async (fn: string, a: Record<string, unknown>): Promise<unknown> => {
    switch (fn) {
      case 'fo_channel_settings': return checkedAgentSettings(templateSettings('gym', 'Iron Gym'));
      case 'fo_voice_outcome': if (!log.outcomes.includes(a.outcome as string)) log.outcomes.push(a.outcome as string); return null;
      case 'fo_voice_end': log.ends++; return { call: 'k1', contact: 'c1', outcomes: [...log.outcomes] };
      case 'fo_log_outbound': log.sent++; return 'm';
      default: return base.rpc(fn, a);
    }
  };
  return { ...base, rpc, log };
}

async function report(s: ReturnType<typeof voiceStore>, endedReason: string) {
  const keys = ['FRONT_OFFICE_VOICE_CHANNEL_ID', 'FRONT_OFFICE_VOICE_CHANNEL_KEY', 'FRONT_OFFICE_VOICE_LIVE'];
  const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  process.env.FRONT_OFFICE_VOICE_CHANNEL_ID = auth.channel;
  try {
    const body = JSON.stringify({ message: { type: 'end-of-call-report', endedReason, call: { id: 'call_dropped01', customer: { number: CALLER } }, artifact: { transcript: 'AI: Thanks for calling Iron Gym.\nUser: I want to book a trial\nAI: Which day suits you?', messages: [] }, analysis: { summary: 'Booking a trial.' } } });
    const res = await vapiWebhook(makeRequest('/x', { method: 'POST', cookie: null, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + auth.key }, body }), null, { rpc: s.rpc, now: () => Date.parse('2026-11-09T00:30:00Z') });
    assert.equal(res.status, 200);
  } finally { for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
}

test('G5 dropped call: customer hang-up mid-booking -> one call-back handoff with number, what was captured, where it stopped', async () => {
  const s = voiceStore(['qualified']);
  await report(s, 'customer-ended-call');
  assert.equal(s.db.handoffs.length, 1);
  const h = s.db.handoffs[0] as { owner: string; channel: string; intent: string; summary: string; nextAction: string };
  assert.equal(h.owner, 'human'); assert.equal(h.channel, 'voice'); assert.match(h.intent, /call back/);
  assert.match(h.summary, /\+61411111111/); assert.match(h.summary, /name Pat/); assert.match(h.summary, /goal: Strength/);
  assert.match(h.summary, /customer-ended-call after qualified/); assert.match(h.summary, /Which day suits you\?/);
  assert.equal(h.nextAction, 'Call the caller back');
  assert.equal(s.log.sent, 0, 'nothing sent');
});

test('G5 dropped call: a repeated end-of-call report creates no second handoff', async () => {
  const s = voiceStore();
  await report(s, 'customer-ended-call');
  await report(s, 'customer-ended-call');
  assert.equal(s.log.ends, 2); assert.equal(s.db.handoffs.length, 1);
});

test('G5 dropped call: completed calls (booked, message, transfer, normal ending) create none', async () => {
  for (const outcomes of [['booked'], ['message'], ['transfer'], ['rescheduled'], ['cancelled']]) {
    const s = voiceStore(outcomes);
    await report(s, 'customer-ended-call');
    assert.equal(s.db.handoffs.length, 0, outcomes.join());
  }
  for (const reason of ['assistant-ended-call', 'assistant-said-end-call-phrase', 'assistant-forwarded-call', 'customer-did-not-answer', 'voicemail']) {
    const s = voiceStore();
    await report(s, reason);
    assert.equal(s.db.handoffs.length, 0, reason);
  }
});

test('G5 dropped call: an error ending reason -> one call-back handoff', async () => {
  const s = voiceStore();
  await report(s, 'pipeline-error-custom-llm-failed');
  assert.equal(s.db.handoffs.length, 1);
  assert.match((s.db.handoffs[0] as { summary: string }).summary, /Stopped: pipeline-error-custom-llm-failed/);
});
