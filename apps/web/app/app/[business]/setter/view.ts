import type { AgentConfig, AuditEvent, CrmLead, DmConversation } from '../../../../lib/aimp/setter/types';
import type { setterMetrics } from '../../../../lib/aimp/setter/analytics';
import type { usageSummary } from '../../../../lib/aimp/setter/billing';

export interface SetterMessageView { id: string; direction: 'in' | 'out'; author: string; text: string; status: string; sendAt: string | null; error: string | null; notes: string[]; intent: string | null; confidence: number | null }
export interface SetterView {
  config: AgentConfig;
  /** Which agent writes replies: a Claude model id, or 'rules' when no AI key is set. */
  agentName: string;
  gaps: { field: string; why: string }[];
  metered: boolean;
  usage: ReturnType<typeof usageSummary>;
  canBuy: boolean;
  killSwitch: boolean;
  conversations: (DmConversation & { lead: CrmLead | null; messages: SetterMessageView[] })[];
  metrics: ReturnType<typeof setterMetrics>;
  audit: AuditEvent[];
}
