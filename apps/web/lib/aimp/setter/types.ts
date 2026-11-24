// AI Sales Setter contracts. Every customer-owned record carries workspaceId; every store call takes it, so one tenant can never read
// another's data by passing a different id (the id itself must come from the verified session or a verified Meta account id).

export type SetterMode = 'off' | 'draft_only' | 'auto';
export const SCOPES_REQUESTED = ['instagram_business_basic', 'instagram_business_manage_messages'] as const;
export const MESSAGING_SCOPE = 'instagram_business_manage_messages';

export interface InstagramConnection {
  workspaceId: string;
  /** The Instagram professional account id (entry[].id on webhooks, <IG_ID> in the send path). One owner per account. */
  igAccountId: string;
  username: string;
  /** AES-256-GCM sealed token; never sent to the browser or logged. */
  tokenSealed: string;
  tokenExpiresAt: string;
  scopes: string[];
  status: 'active' | 'expired' | 'revoked' | 'disconnected';
  /** Must be confirmed (Meta conversation routing) before auto-send. */
  threadOwnershipConfirmed: boolean;
  connectedAt: string;
}

export interface Offer {
  id: string; name: string; priceMinor: number; currency: string;
  /** One-line summary. */
  description: string;
  /** Full product knowledge: features, specs, sizes, materials, what's in the box, how to use, care. The setter answers from this. */
  details?: string;
  /** Who it's great for, and who it is NOT for (honest fit helps selling). */
  bestFor?: string;
  ctaUrl: string; ctaKind: 'checkout' | 'booking';
}
export interface ObjectionAnswer { id: string; objection: string; answer: string }
export interface KnowledgeItem { id: string; question: string; answer: string }

export interface AgentConfig {
  workspaceId: string;
  mode: SetterMode;
  paused: boolean;
  businessName: string;
  /** What the business is, in the owner's words (story, location, why customers buy from them). */
  about: string;
  idealCustomer: string;
  /** Policies the setter quotes. Empty = it will not make one up. */
  shipping: string;
  returns: string;
  warranty: string;
  /** Why people buy: the strongest true reasons, in order. */
  sellingPoints: string[];
  /** Prepared answers to common hesitations (price, timing, trust, "need to think"). */
  objections: ObjectionAnswer[];
  /** REAL customer quotes the owner confirms are genuine. The setter may quote only these, word for word. */
  testimonials: string[];
  /** Upsell or bundle suggestion, offered once when it genuinely fits. */
  upsell: string;
  /** When someone asks "are you a bot?": answer honestly that it is the store's assistant, or hand the chat to the owner. */
  botQuestion: 'honest' | 'handoff';
  /** Human-like reply timing for automatic replies (never over 7 minutes). */
  replyDelay: { enabled: boolean; minSeconds: number; maxSeconds: number };
  brandVoice: string;
  offers: Offer[];
  knowledge: KnowledgeItem[];
  prohibitedClaims: string[];
  refundPolicy: string;
  bookingUrl: string;
  qualifyingQuestion: string;
  timezone: string;
  /** Replies below this confidence become drafts even in auto mode. */
  minConfidence: number;
  /** Add an "automated assistant" line to the first reply. Off by default (owner choice). Some places (e.g. California, Germany) may
   *  legally require disclosure for automated chats; the owner is told this in Setup. */
  discloseAi: boolean;
  promptVersion: string;
  updatedAt: string;
}

export const leadStages = ['new', 'interested', 'needs_more_information', 'not_a_fit', 'booking_ready', 'purchase_ready', 'complaint', 'human_requested', 'opt_out'] as const;
export type LeadStage = (typeof leadStages)[number];
export const intents = leadStages.filter((s) => s !== 'new') as Exclude<LeadStage, 'new'>[];
export type Intent = Exclude<LeadStage, 'new'>;
export const actions = ['reply', 'handoff', 'ignore'] as const;
export type RecommendedAction = (typeof actions)[number];

/** What the model may suggest. The backend decides what actually happens. */
export interface AgentDecision {
  intent: Intent;
  lead_stage: LeadStage;
  response_text: string;
  confidence: number;
  knowledge_source_ids: string[];
  recommended_action: RecommendedAction;
  handoff_reason: string | null;
  cta_id: string | null;
}

export type ConversationState = 'open' | 'awaiting_approval' | 'human' | 'closed';
export interface DmConversation {
  id: string;
  workspaceId: string;
  igAccountId: string;
  /** Instagram-scoped id of the person. */
  igsid: string;
  state: ConversationState;
  humanTakeover: boolean;
  /** Last message FROM the person: the 24-hour window is measured from here. */
  lastInboundAt: string | null;
  lastActivityAt: string;
  unread: number;
  aiDisclosed: boolean;
  pitchesDeclined: number;
}

export interface DmMessage {
  id: string;
  workspaceId: string;
  conversationId: string;
  direction: 'in' | 'out';
  /** For 'out': who wrote it. */
  author: 'person' | 'ai' | 'human';
  text: string;
  status: 'received' | 'draft' | 'queued' | 'sent' | 'failed' | 'rejected';
  mid: string | null;
  error: string | null;
  createdAt: string;
  decision?: AgentDecision;
  policyNotes?: string[];
  /** For a queued automatic reply: when it is due to send. */
  sendAt?: string;
}

export interface CrmLead {
  workspaceId: string;
  conversationId: string;
  igsid: string;
  stage: LeadStage;
  /** Evidence for the stage: the person's own words, never inferred demographics. */
  reason: string;
  source: 'instagram_dm';
  lastInteractionAt: string;
  owner: string | null;
  optedOut: boolean;
}

export interface OutboundAttempt {
  workspaceId: string;
  idempotencyKey: string;
  conversationId: string;
  messageId: string;
  status: 'sent' | 'failed' | 'blocked' | 'retrying' | 'dead_letter';
  attempts: number;
  lastError: string | null;
  at: string;
}

export interface ConversionEvent { workspaceId: string; conversationId: string | null; kind: 'checkout_click' | 'purchase' | 'booking'; source: 'redirect' | 'stripe_verified' | 'booking_verified'; amountMinor: number | null; at: string }
export interface AuditEvent { workspaceId: string; at: string; kind: string; detail: string }
