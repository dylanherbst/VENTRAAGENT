// Keeps the Sales agent (AI Setter) in step with the shared business profile. Called after every profile save.
import { agentTeam } from './agent-team-runtime';
import { live, sandbox } from './setter-runtime';
import { setterConfigFromProfile } from '../../../lib/aimp/growth/knowledge';

export function syncKnowledge(business: string): void {
  const p = agentTeam().profile(business);
  if (!p) return;
  for (const s of [sandbox(business), live()]) {
    if (!s) continue;
    const ws = 'ws' in s ? s.ws : business;
    const cur = s.store.config(ws);
    if (cur) s.store.saveConfig(setterConfigFromProfile(cur, p));
  }
}
