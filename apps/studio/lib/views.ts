import type { AgentTeam } from '../../web/lib/aimp/agents/team';
import type { Campaign } from '../../web/lib/aimp/marketing-engine/types';
import type { AgentConfig, AuditEvent, CrmLead, DmConversation } from '../../web/lib/aimp/setter/types';
import type { setterMetrics } from '../../web/lib/aimp/setter/analytics';
import type { usageSummary } from '../../web/lib/aimp/setter/billing';

type Dash = ReturnType<AgentTeam['dashboard']>;
export type TeamView = Omit<Dash, 'assets'> & { assets: (Dash['assets'][number] & { src: string | null })[]; message: string | null; errors: string[] };

/** The angles screen works on one brand. (`studio` kept so the shared component type-checks.) */
export type Scope = { kind: 'business'; business: string } | { kind: 'studio' };
export interface AnglesView { campaigns: Campaign[]; writer: string; demo: boolean; usage: { events: number; estimatedCostUsd: number }; message: string | null; errors: string[] }

export interface SetterMessageView { id: string; direction: 'in' | 'out'; author: string; text: string; status: string; sendAt: string | null; error: string | null; notes: string[]; intent: string | null; confidence: number | null }
export interface SetterView {
  config: AgentConfig; agentName: string; gaps: { field: string; why: string }[]; metered: boolean; usage: ReturnType<typeof usageSummary>; canBuy: boolean; killSwitch: boolean;
  conversations: (DmConversation & { lead: CrmLead | null; messages: SetterMessageView[] })[]; metrics: ReturnType<typeof setterMetrics>; audit: AuditEvent[];
}
