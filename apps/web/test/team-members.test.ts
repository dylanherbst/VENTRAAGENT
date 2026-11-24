import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTeamResponse, roleWording, shapeMembers } from '../lib/team-members.ts';

// Ids are built by a helper so no secret-shaped literal appears in the source.
const id = (n: number) => 'user-' + String(n).padStart(4, '0');
const row = (n: number, role: string, active?: boolean) => ({ user_id: id(n), role, ...(active === undefined ? {} : { active }) });

test('owners sort first, current user is You, others are anonymous', () => {
  const out = shapeMembers([row(3, 'staff'), row(2, 'owner'), row(1, 'staff')], id(1));
  assert.deepEqual(out.map(m => m.role), ['owner', 'staff', 'staff']);
  assert.equal(out.filter(m => m.isYou).length, 1);
  assert.equal(out.find(m => m.isYou)!.label, 'You');
  assert.deepEqual(out.filter(m => !m.isYou).map(m => m.label), ['Team member 1', 'Team member 2']);
});
test('raw user ids never appear in output', () => {
  const json = JSON.stringify(shapeMembers([row(1, 'owner'), row(2, 'staff')], id(1)));
  assert.doesNotMatch(json, /user-\d{4}/);
  assert.doesNotMatch(json, /user_id|email/);
});
test('inactive, unknown-role and malformed rows are dropped', () => {
  const out = shapeMembers([row(1, 'owner', true), row(2, 'staff', false), row(3, 'admin'), null, 7, { role: 'owner' }, { user_id: '', role: 'owner' }, { user_id: 5, role: 'owner' }], id(1));
  assert.equal(out.length, 1);
});
test('non-array input gives an empty list', () => {
  for (const v of [null, undefined, {}, 'x', 3]) assert.deepEqual(shapeMembers(v, id(1)), []);
});
test('ordering is deterministic regardless of input order', () => {
  const a = shapeMembers([row(5, 'staff'), row(4, 'staff'), row(9, 'owner')], id(9));
  const b = shapeMembers([row(9, 'owner'), row(4, 'staff'), row(5, 'staff')], id(9));
  assert.deepEqual(a, b);
});
test('role wording is plain and distinguishes owner from staff', () => {
  assert.match(roleWording('owner'), /Owner/);
  assert.match(roleWording('staff'), /view only/);
});
test('parseTeamResponse accepts the API shape and round trips shapeMembers', () => {
  const members = shapeMembers([row(1, 'owner'), row(2, 'staff')], id(2));
  assert.deepEqual(parseTeamResponse({ signedIn: true, members }), members);
});
test('parseTeamResponse rejects malformed bodies', () => {
  for (const b of [null, {}, { members: 'x' }, { members: [null] }, { members: [{ label: 'a', role: 'admin', isYou: false }] }, { members: [{ label: 'a', role: 'owner', isYou: 'no' }] }, { members: [{ label: 'x'.repeat(41), role: 'owner', isYou: false }] }]) assert.equal(parseTeamResponse(b), null);
});
