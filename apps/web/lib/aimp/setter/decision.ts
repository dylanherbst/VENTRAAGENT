// Validates the model's structured output. Anything malformed is rejected, never "repaired" into a send.
import { actions, intents, leadStages, type AgentDecision } from './types.ts';

type J = Record<string, unknown>;
export function validateDecision(raw: unknown): { ok: true; decision: AgentDecision } | { ok: false; errors: string[] } {
  let v: unknown = raw;
  if (typeof raw === 'string') {
    const trimmed = raw.replace(/^```(json)?|```$/g, '').trim();
    const a = trimmed.indexOf('{'), b = trimmed.lastIndexOf('}');
    try { v = JSON.parse(a >= 0 && b > a ? trimmed.slice(a, b + 1) : trimmed); } catch { return { ok: false, errors: ['Model output is not JSON.'] }; }
  }
  const d = (typeof v === 'object' && v !== null && !Array.isArray(v) ? v : null) as J | null;
  if (!d) return { ok: false, errors: ['Model output is not an object.'] };
  const errors: string[] = [];
  const allowed = new Set(['intent', 'lead_stage', 'response_text', 'confidence', 'knowledge_source_ids', 'recommended_action', 'handoff_reason', 'cta_id']);
  for (const k of Object.keys(d)) if (!allowed.has(k)) errors.push(`Unexpected field ${k}.`);
  if (!intents.includes(d.intent as never)) errors.push('Bad intent.');
  if (!leadStages.includes(d.lead_stage as never)) errors.push('Bad lead_stage.');
  if (typeof d.response_text !== 'string' || d.response_text.length > 2000) errors.push('Bad response_text.');
  if (typeof d.confidence !== 'number' || !(d.confidence >= 0 && d.confidence <= 1)) errors.push('Bad confidence.');
  if (!Array.isArray(d.knowledge_source_ids) || d.knowledge_source_ids.some((x) => typeof x !== 'string') || d.knowledge_source_ids.length > 20) errors.push('Bad knowledge_source_ids.');
  if (!actions.includes(d.recommended_action as never)) errors.push('Bad recommended_action.');
  if (!(d.handoff_reason === null || typeof d.handoff_reason === 'string')) errors.push('Bad handoff_reason.');
  if (!(d.cta_id === null || typeof d.cta_id === 'string')) errors.push('Bad cta_id.');
  if (errors.length) return { ok: false, errors };
  return { ok: true, decision: d as unknown as AgentDecision };
}
