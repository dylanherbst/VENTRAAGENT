// Human-like reply timing: random, leaning short, never over 7 minutes; re-checked and replaced when the person writes again.
import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanDelay, createSandbox, MAX_REPLY_DELAY_SECONDS, replyDelayMs } from '../lib/aimp/setter/index.ts';

test('delay is random within the range and never above 7 minutes', () => {
  const d = { enabled: true, minSeconds: 45, maxSeconds: 420 };
  let seed = 7;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const xs = Array.from({ length: 2000 }, () => replyDelayMs('x'.repeat(300), d, rand));
  assert.ok(xs.every((ms) => ms >= 45_000 && ms <= 420_000));
  assert.ok(new Set(xs).size > 1000, 'varied');
  const median = [...xs].sort((a, b) => a - b)[1000]!;
  assert.ok(median < 240_000, 'leans short');
  assert.equal(replyDelayMs('hi', { enabled: true, minSeconds: 0, maxSeconds: 9999 }, () => 1), MAX_REPLY_DELAY_SECONDS * 1000);
  assert.deepEqual(cleanDelay({ minSeconds: 600, maxSeconds: 900 }), { enabled: true, minSeconds: 420, maxSeconds: 420 });
  assert.equal(replyDelayMs('hi', { enabled: false, minSeconds: 45, maxSeconds: 420 }), 0);
});

test('automatic reply is scheduled, then sent; a new message replaces the waiting reply', async () => {
  let t = Date.parse('2026-11-22T10:00:00Z');
  const tasks: { run: () => void; ms: number }[] = [];
  const sb = createSandbox({ now: () => new Date(t), schedule: (run, ms) => { tasks.push({ run, ms }); }, random: () => 0.5 });
  sb.store.saveConfig({ ...sb.store.config(sb.ws)!, mode: 'auto' });
  assert.deepEqual((await sb.inbound('how much is the sunset lamp?', '1')).results, ['scheduled']);
  assert.equal(sb.sender.sent.length, 0);
  assert.ok(tasks[0]!.ms >= 45_000 && tasks[0]!.ms <= 420_000);
  // The person writes again before it goes out: the first reply is replaced.
  assert.deepEqual((await sb.inbound('does it come with a remote?', '1')).results, ['scheduled']);
  t += 10 * 60_000;
  for (const x of tasks) x.run();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(sb.sender.sent.length, 1);
  assert.match(sb.sender.sent[0]!.text, /remote/i);
  const msgs = sb.store.messages(sb.ws, sb.store.conversations(sb.ws)[0]!.id);
  assert.equal(msgs.filter((m) => m.status === 'rejected').length, 1);
});

test('a waiting reply is not sent if the owner takes over or presses stop before it is due', async () => {
  const tasks: (() => void)[] = [];
  const sb = createSandbox({ schedule: (run) => { tasks.push(run); }, random: () => 0.1 });
  sb.store.saveConfig({ ...sb.store.config(sb.ws)!, mode: 'auto' });
  await sb.inbound('how much is the sunset lamp?', '1');
  sb.store.setKillSwitch(sb.ws, true);
  tasks[0]!();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(sb.sender.sent.length, 0);
});
