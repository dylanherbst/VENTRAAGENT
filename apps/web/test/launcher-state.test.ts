import test from 'node:test';
import assert from 'node:assert/strict';
import { initialLauncherState, launcherReducer, profileWithSavedBrief } from '../lib/launcher-state.ts';
import { blankProfile, enablePathway, restoreProfile, serializeProfile } from '../lib/onboarding.ts';

function configured() {
  const profile = { ...blankProfile(), name: 'Studio', audience: 'Clients', goal: 'Grow', expertise: 'Lashes', industry: 'Beauty', toolNotes: { website: 'Saved website brief', crm: 'Saved CRM brief' } };
  return launcherReducer(initialLauncherState(), { type: 'restore', profile });
}
test('pending briefs survive checklist commits and cancelled or saved pathway/setup edits without autosaving', () => {
  let state = configured();
  state = launcherReducer(state, { type: 'note', toolId: 'website', value: 'Pending website brief' });
  state = launcherReducer(state, { type: 'note', toolId: 'crm', value: 'Pending CRM brief' });
  const pending = { ...state.toolDrafts };
  state = launcherReducer(state, { type: 'commit', profile: { ...state.saved!, completed: ['education-expertise'] } });
  assert.deepEqual(state.toolDrafts, pending);
  assert.equal(restoreProfile(serializeProfile(state.saved!))?.toolNotes.website, 'Saved website brief');
  const snapshot = state.saved!;
  state = launcherReducer(state, { type: 'profile', profile: enablePathway(snapshot, 'business') });
  state = launcherReducer(state, { type: 'profile', profile: snapshot }); // Cancel activation.
  assert.deepEqual(state.toolDrafts, pending);
  assert.deepEqual(state.saved!.pathways, ['education']);
  state = launcherReducer(state, { type: 'profile', profile: { ...state.profile, name: 'Edited studio' } });
  state = launcherReducer(state, { type: 'profile', profile: state.saved! }); // Cancel setup edit.
  assert.deepEqual(state.toolDrafts, pending);
  state = launcherReducer(state, { type: 'profile', profile: enablePathway(state.saved!, 'business') });
  state = launcherReducer(state, { type: 'commit', profile: state.profile }); // Confirm activation.
  assert.deepEqual(state.saved!.pathways, ['education', 'business']);
  assert.deepEqual(state.toolDrafts, pending);
  assert.equal(state.saved!.toolNotes.crm, 'Saved CRM brief');
});
test('explicit save commits only the selected brief and leaves another tool’s pending text unsaved', () => {
  let state = configured();
  state = launcherReducer(state, { type: 'note', toolId: 'website', value: 'New website brief' });
  state = launcherReducer(state, { type: 'note', toolId: 'crm', value: 'Pending CRM brief' });
  state = launcherReducer(state, { type: 'commit', profile: profileWithSavedBrief(state.saved!, state.toolDrafts, 'website') });
  const restored = restoreProfile(serializeProfile(state.saved!))!;
  assert.equal(restored.toolNotes.website, 'New website brief');
  assert.equal(restored.toolNotes.crm, 'Saved CRM brief');
  assert.equal(state.toolDrafts.crm, 'Pending CRM brief');
  state = launcherReducer(state, { type: 'note', toolId: 'website', value: '' });
  state = launcherReducer(state, { type: 'commit', profile: profileWithSavedBrief(state.saved!, state.toolDrafts, 'website') });
  assert.equal(state.saved!.toolNotes.website, '');
  assert.equal(state.toolDrafts.crm, 'Pending CRM brief');
});
