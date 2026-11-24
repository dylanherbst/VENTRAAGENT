// AiMoneyPrinter stable backend workflow contracts (business plan §12.4).
// AI agents prepare structured requests; the backend validates tenant, schema, permission, budget, approval and
// idempotency before any external side effect. Payment, order, publishing and entitlement states are deterministic.

/** Human-readable automation status shown to customers (plan §2.2). */
export const automationStatuses = [
  'draft', 'generating', 'checking', 'needs_approval', 'scheduled', 'live', 'complete', 'paused', 'failed',
] as const;
export type AutomationStatus = (typeof automationStatuses)[number];

/** MVP business models that share the two production engines (plan §1.2). Membership is P2. */
export const businessModels = ['digital-templates', 'printable-art', 'personalised-digital', 'marketing-assets'] as const;
export type BusinessModel = (typeof businessModels)[number];
export type ProductionEngine = 'document' | 'visual';
export const engineFor: Record<BusinessModel, ProductionEngine[]> = {
  'digital-templates': ['document'],
  'printable-art': ['visual'],
  'personalised-digital': ['visual'],
  'marketing-assets': ['document', 'visual'],
};

/** Persisted value lists. These MUST equal the CHECK constraints in supabase/migrations/202611140001_aimp_commerce_core.sql
 *  (test/aimp-data-*.test.ts proves it against a real database). */
export const businessStatuses = ['draft', 'live', 'paused', 'retired'] as const;
export type BusinessStatus = (typeof businessStatuses)[number];
export const productStatuses = ['draft', 'review', 'active', 'retired', 'quarantined'] as const;
export type ProductStatus = (typeof productStatuses)[number];
export const assetRoles = ['master', 'preview', 'cover', 'mockup'] as const;
export type AssetRole = (typeof assetRoles)[number];
/** Roles that may ever be shown publicly. 'master' is the paid deliverable and is never public. */
export const publicAssetRoles = ['preview', 'cover', 'mockup'] as const satisfies readonly AssetRole[];
export const siteVersionStatuses = ['draft', 'published', 'archived'] as const;
export type SiteVersionStatus = (typeof siteVersionStatuses)[number];
export const domainStatuses = ['pending', 'verified', 'failed'] as const;
export type DomainStatus = (typeof domainStatuses)[number];

/** Every side-effecting operation carries these. The idempotency key makes retries safe. */
export interface OperationContext {
  workspaceId: string;
  businessId?: string;
  actorUserId: string;
  idempotencyKey: string;
  /** Approval id when the policy engine requires owner approval for this action. */
  approvalId?: string;
}

export interface Evidence { source: string; url?: string; note: string; retrievedAt: string }
export type Confidence = 'low' | 'medium' | 'high';

export interface OpportunityFactor { score: number; confidence: Confidence; evidence: Evidence[]; assumption?: string }
export const scoringFactors = ['demand', 'automation', 'lowStartupCost', 'lowOngoingWorkload', 'differentiation', 'repeatPurchases'] as const;
export type ScoringFactor = (typeof scoringFactors)[number];

export interface Opportunity {
  blueprintId: string;
  blueprintVersion: number;
  niche: string;
  model: BusinessModel;
  factors: Record<ScoringFactor, OpportunityFactor>;
  estimatedStartupCostMinor: number;
  estimatedMonthlyCostMinor: number;
  weeklyHours: number;
  channels: string[];
  uncertainty: string[];
}

/** Operation name → [input, output]. Implementations live behind authenticated API routes and durable jobs. */
export interface WorkflowContracts {
  researchOpportunities: [{ profileRevision: number }, { opportunities: Opportunity[]; rubricVersion: number }];
  selectBusiness: [{ blueprintId: string; blueprintVersion: number; niche: string }, { businessId: string }];
  generateBrand: [{ businessId: string; styleCount: 3 }, { options: { id: string; name: string; palette: string[]; typography: string; voice: string }[] }];
  createProductBatch: [{ businessId: string; count: number }, { jobIds: string[] }];
  validateProduct: [{ productId: string; version: number }, { pass: boolean; checks: { id: string; pass: boolean; note?: string }[]; remediation: string[] }];
  generateStore: [{ businessId: string }, { siteId: string; versionId: string; previewUrl: string }];
  publishStore: [{ siteId: string; versionId: string }, { liveUrl: string; versionId: string; smokeTest: 'pass' | 'fail' }];
  connectMerchant: [{ businessId: string }, { onboardingUrl?: string; chargesEnabled: boolean; payoutsEnabled: boolean; requirementsDue: string[] }];
  createCheckout: [{ productId: string; variantId?: string; quantity: number }, { checkoutUrl: string; orderId: string }];
  fulfilPaidOrder: [{ orderId: string; stripeEventId: string }, { outcome: 'delivered' | 'already_delivered' | 'queued_review'; deliveryId: string }];
  createMarketingCampaign: [{ businessId: string; channel: 'pinterest' }, { campaignId: string; postIds: string[] }];
  publishScheduledContent: [{ postId: string }, { providerPostUrl?: string; status: AutomationStatus; error?: string }];
  runBusinessHealthCheck: [{ businessId: string }, { status: 'healthy' | 'attention' | 'critical'; issues: { id: string; message: string; action: string }[] }];
  prepareOptimisations: [{ businessId: string }, { proposals: { id: string; change: string; evidence: Evidence[]; needsApproval: boolean }[] }];
}
export type WorkflowOperation = keyof WorkflowContracts;
export type OperationInput<K extends WorkflowOperation> = WorkflowContracts[K][0];
export type OperationOutput<K extends WorkflowOperation> = WorkflowContracts[K][1];
