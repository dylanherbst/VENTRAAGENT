import type { Campaign } from '../../../../../lib/aimp/marketing-engine/types';

export type Scope = { kind: 'business'; business: string } | { kind: 'studio' };
export interface AnglesView {
  campaigns: Campaign[];
  /** A model id, or 'demo' when no AI key is set. */
  writer: string;
  demo: boolean;
  usage: { events: number; estimatedCostUsd: number };
  message: string | null;
  errors: string[];
}
