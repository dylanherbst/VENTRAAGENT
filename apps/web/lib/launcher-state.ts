import { blankProfile } from './onboarding.ts';
import type { Profile } from './onboarding.ts';

export type LauncherState = { profile: Profile; saved: Profile | null; toolDrafts: Record<string, string> };
type Action =
  | { type: 'restore' | 'profile' | 'commit'; profile: Profile }
  | { type: 'note'; toolId: string; value: string };
export function initialLauncherState(): LauncherState {
  return { profile: blankProfile(), saved: null, toolDrafts: {} };
}
// Profile/checklist commits must never hydrate or save pending brief text.
export function launcherReducer(state: LauncherState, action: Action): LauncherState {
  switch (action.type) {
    case 'restore': return { profile: action.profile, saved: action.profile, toolDrafts: { ...action.profile.toolNotes } };
    case 'profile': return { ...state, profile: action.profile };
    case 'commit': return { ...state, profile: action.profile, saved: action.profile };
    case 'note': return { ...state, toolDrafts: { ...state.toolDrafts, [action.toolId]: action.value } };
  }
}
export function profileWithSavedBrief(saved: Profile, drafts: Record<string, string>, toolId: string): Profile {
  return { ...saved, toolNotes: { ...saved.toolNotes, [toolId]: drafts[toolId] ?? '' } };
}
