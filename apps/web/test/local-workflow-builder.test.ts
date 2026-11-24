import test from 'node:test';
import assert from 'node:assert/strict';
import { addNode, blankWorkflow, connect, nodeLimit, pathSummary, persistWorkflows, removeNode, restoreWorkflows, saveWorkflow, topologicalLayout, validateWorkflow, waitDaysMax, workflowLimit, workflowsStorageKey } from '../lib/local-workflow-builder.ts';
import type { Workflow } from '../lib/local-workflow-builder.ts';

const named = (w: Workflow): Workflow => ({ ...w, name: 'Lead follow-up' });
// trigger -> consent? -yes-> hot? -yes-> email ; hot? -no-> note
function branching(): Workflow {
  let w = named(blankWorkflow('w1', 't'));
  w = addNode(w, 'c1', 'condition', 'consent-opted-in');
  w = addNode(w, 'c2', 'condition', 'lead-score-hot');
  w = addNode(w, 'a1', 'action', 'send-email');
  w = addNode(w, 'a2', 'action', 'add-note');
  w = connect(w, 't', 'next', 'c1'); w = connect(w, 'c1', 'yes', 'c2');
  w = connect(w, 'c2', 'yes', 'a1'); w = connect(w, 'c2', 'no', 'a2');
  return { ...w, nodes: w.nodes.map(n => (n.id === 'a1' ? { ...n, config: { linkedRef: { type: 'email-campaign' as const, id: 'camp' } } } : n)) };
}

test('blank workflow has exactly one trigger and blocks saving without a name', () => {
  const w = blankWorkflow('w', 't');
  assert.equal(w.nodes.length, 1); assert.equal(w.nodes[0].kind, 'trigger');
  assert.ok(validateWorkflow(w).problems.includes('Name is required.'));
  assert.deepEqual(validateWorkflow(named(w)).problems, []);
});

test('blocking problems: no trigger, two triggers, dangling id, cycle', () => {
  const w = named(blankWorkflow('w', 't'));
  assert.ok(validateWorkflow({ ...w, nodes: [] }).problems.includes('Add a trigger.'));
  assert.ok(validateWorkflow(addNode(w, 't2', 'trigger', 'deal-won')).problems.includes('A workflow can have only one trigger.'));
  const dangling = { ...w, nodes: [{ ...w.nodes[0], next: 'ghost' }] };
  assert.ok(validateWorkflow(dangling).problems.some(p => /does not exist/.test(p)));
  let c = addNode(addNode(w, 'a', 'action', 'notify-me'), 'b', 'action', 'add-note');
  c = connect(connect(connect(c, 't', 'next', 'a'), 'a', 'next', 'b'), 'b', 'next', 'a');
  assert.ok(validateWorkflow(c).problems.some(p => /loops/.test(p)));
  assert.throws(() => saveWorkflow([], c));
  assert.throws(() => connect(addNode(w, 'a', 'action', 'notify-me'), 'a', 'next', 'a'), /itself/);
  assert.throws(() => connect(addNode(w, 'a', 'action', 'notify-me'), 'a', 'next', 't'), /trigger/);
  assert.throws(() => connect(w, 't', 'yes', null), /one next/);
});

test('warnings do not block: unreachable, missing branch, no consent, unlinked send', () => {
  let w = named(blankWorkflow('w', 't'));
  w = addNode(w, 'c', 'condition', 'lead-score-hot'); w = addNode(w, 'e', 'action', 'send-email'); w = addNode(w, 'x', 'action', 'notify-me');
  w = connect(connect(w, 't', 'next', 'c'), 'c', 'yes', 'e');
  const { problems, warnings } = validateWorkflow(w);
  assert.deepEqual(problems, []);
  const text = warnings.join('\n');
  assert.match(text, /not connected to the trigger/); assert.match(text, /missing its no branch/);
  assert.match(text, /without checking that consent/); assert.match(text, /not linked to an email campaign/);
  assert.equal(saveWorkflow([], w).length, 1);
});

test('consent condition on the yes path clears the consent warning; the no branch does not', () => {
  const ok = validateWorkflow(branching());
  assert.ok(!ok.warnings.some(x => /consent/.test(x)), ok.warnings.join('|'));
  let w = branching();
  w = connect(w, 'c1', 'no', 'a1'); // opted-out contacts reach the email
  assert.ok(validateWorkflow(w).warnings.some(x => /consent/.test(x)));
});

test('removing a node repairs links', () => {
  let w = named(blankWorkflow('w', 't'));
  w = addNode(addNode(w, 'a', 'action', 'notify-me'), 'b', 'action', 'add-note');
  w = connect(connect(w, 't', 'next', 'a'), 'a', 'next', 'b');
  assert.equal(removeNode(w, 'a').nodes[0].next, 'b');
  assert.equal(removeNode(w, 'b').nodes.find(n => n.id === 'a')?.next, null);
  const b = branching();
  const r = removeNode(b, 'c2');
  assert.equal(r.nodes.find(n => n.id === 'c1')?.yesNext, null);
  assert.deepEqual(validateWorkflow(r).problems, []);
  assert.equal(removeNode(b, 'nope'), b);
});

test('layout is deterministic and layered', () => {
  const w = branching();
  const l = topologicalLayout(w);
  assert.deepEqual(l.layers, [['t'], ['c1'], ['c2'], ['a1', 'a2']]);
  assert.deepEqual(topologicalLayout(JSON.parse(JSON.stringify(w))), l);
  assert.deepEqual(l.positions.a2, { layer: 3, column: 1 });
  // A loop never crashes the layout.
  let c = addNode(addNode(named(blankWorkflow('w', 't')), 'a', 'action', 'notify-me'), 'b', 'action', 'add-note');
  c = connect(connect(c, 'a', 'next', 'b'), 'b', 'next', 'a');
  assert.equal(topologicalLayout(c).layers.flat().length, 3);
});

test('path summaries describe every branch in plain English', () => {
  const s = pathSummary(branching(), ref => (ref.id === 'camp' ? 'Welcome' : undefined));
  assert.deepEqual(s, [
    'When a new lead is captured, if consent is opted in, if the lead score is hot, then send email from campaign Welcome.',
    'When a new lead is captured, if consent is opted in, if it is not true that the lead score is hot, then add a note.',
  ]);
  assert.deepEqual(pathSummary(named(blankWorkflow('w', 't'))), ['When a new lead is captured, nothing else happens yet.']);
  let w = named(blankWorkflow('w', 't'));
  w = connect(addNode(w, 'w1', 'action', 'wait'), 't', 'next', 'w1');
  w = { ...w, nodes: w.nodes.map(n => (n.id === 'w1' ? { ...n, config: { days: 3 } } : n)) };
  assert.deepEqual(pathSummary(w), ['When a new lead is captured, then wait 3 days.']);
  assert.deepEqual(pathSummary({ ...w, nodes: [] }), []);
});

test('limits: nodes, wait days, workflows, text', () => {
  let w = named(blankWorkflow('w', 't'));
  for (let i = 1; i < nodeLimit; i++) w = addNode(w, `n${i}`, 'action', 'add-note');
  assert.throws(() => addNode(w, 'extra', 'action', 'add-note'), /up to 20/);
  assert.throws(() => addNode(w, 'z', 'action', 'bogus'), /list/);
  let t = addNode(named(blankWorkflow('w', 't')), 'a', 'action', 'wait');
  const days = (d: number) => ({ ...t, nodes: t.nodes.map(n => (n.id === 'a' ? { ...n, config: { days: d } } : n)) });
  assert.deepEqual(validateWorkflow(days(0)).problems, []);
  assert.deepEqual(validateWorkflow(days(waitDaysMax)).problems, []);
  assert.ok(validateWorkflow(days(91)).problems.length); assert.ok(validateWorkflow(days(-1)).problems.length); assert.ok(validateWorkflow(days(1.5)).problems.length);
  t = { ...t, name: 'x'.repeat(121) };
  assert.ok(validateWorkflow(t).problems.some(p => /120/.test(p)));
  const fifteen = Array.from({ length: workflowLimit }, (_, i) => named(blankWorkflow(`w${i}`, `t${i}`)));
  assert.throws(() => saveWorkflow(fifteen, named(blankWorkflow('new', 'tn'))), /up to 15/);
  assert.equal(saveWorkflow(fifteen, { ...fifteen[0], name: 'Renamed' }).length, 15);
});

test('restore never overwrites invalid data and persist is compare-and-set', () => {
  assert.deepEqual(restoreWorkflows(null, 'p'), []);
  assert.throws(() => restoreWorkflows('nope', 'p'), /Nothing was overwritten/);
  assert.throws(() => restoreWorkflows('{}', 'p'), /Invalid/);
  assert.throws(() => restoreWorkflows(JSON.stringify([{ ...blankWorkflow('w'), name: '' }]), 'p'), /Invalid/);
  const dup = named(blankWorkflow('w'));
  assert.throws(() => restoreWorkflows(JSON.stringify([dup, dup]), 'p'), /Duplicate/);
  const map = new Map<string, string>();
  const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); } };
  const key = workflowsStorageKey('p');
  assert.equal(key, 'launchpad.workflow-builder.v1.p');
  const raw = persistWorkflows(storage, 'p', null, [branching()]);
  assert.equal(map.get(key), raw);
  assert.equal(restoreWorkflows(raw, 'p')[0].nodes.length, 5);
  assert.throws(() => persistWorkflows(storage, 'p', null, []), /another tab/);
  assert.equal(map.get(key), raw);
  assert.throws(() => persistWorkflows(storage, 'p', raw, [{ ...branching(), name: '' }]), /Invalid/);
  assert.equal(map.get(key), raw);
});
