// The Store team: the specialist workflows an owner's shop can run once it is live (from the SkillTree "every agent a store needs" reference).
// Pure data. Each entry is a documented workflow, not a promise: `status` says whether it exists today. The approval defaults follow one rule:
// reading is automatic, anything a customer sees or money/spend moves waits for the owner.

export const departments = ['support', 'returns', 'reviews', 'carts', 'stock', 'ads', 'store-ops'] as const;
export type Department = (typeof departments)[number];

export const DEPARTMENT_LABELS: Readonly<Record<Department, string>> = {
  support: 'Support', returns: 'Returns', reviews: 'Reviews', carts: 'Carts', stock: 'Stock', ads: 'Ads', 'store-ops': 'Store ops',
};

/** What an agent may do without asking. `read` never changes anything; `draft` prepares text; `send` reaches a customer; `money` moves money or spend. */
export const actionKinds = ['read', 'draft', 'send', 'money'] as const;
export type ActionKind = (typeof actionKinds)[number];
export const approvalFor: Readonly<Record<ActionKind, 'automatic' | 'owner_approval'>> = {
  read: 'automatic', draft: 'automatic', send: 'owner_approval', money: 'owner_approval',
};

/** `built` runs today; `next` is the first release; `later` is documented only. */
export type WorkflowStatus = 'built' | 'next' | 'later';

export interface WorkflowDef {
  /** File name under `docs/aimp/workflows/<department>/`. */
  id: string;
  department: Department;
  label: string;
  /** What starts it. */
  trigger: string;
  /** Facts it reads. */
  data: string[];
  /** Rules it must follow. */
  rules: string[];
  /** Highest action it takes. Decides the approval default. */
  action: ActionKind;
  /** What the owner gets. */
  output: string;
  /** What happens when it cannot finish. */
  onFailure: string;
  status: WorkflowStatus;
  /** Sells physical goods only: skipped for digital shops. */
  physicalOnly?: boolean;
}

export const knowledgeSources = ['catalogue', 'policies', 'suppliers', 'photos', 'brand-voice'] as const;
export type KnowledgeSource = (typeof knowledgeSources)[number];

const hand = 'Hand to the owner with the customer message and order attached.';

export const workflows: readonly WorkflowDef[] = [
  { id: 'order-tracker', department: 'support', label: 'Order status', trigger: 'A buyer asks where their order or download is.',
    data: ['orders', 'fulfilment', 'delivery emails'], rules: ['Only answer when the email on the message matches the order.', 'Digital orders report delivery status and the resend option; physical orders report tracking.', 'Never share another buyer\'s order.'],
    action: 'read', output: 'A verified status for the order.', onFailure: hand, status: 'built' },
  { id: 'answer-drafter', department: 'support', label: 'Reply drafter', trigger: 'A verified order status is ready, or a buyer question arrives.',
    data: ['order status', 'policies', 'brand voice'], rules: ['Use only facts from the order and the shop policies.', 'Say plainly when something is not known.', 'Never promise a refund or a date the shop cannot keep.'],
    action: 'draft', output: 'A short reply for the owner to approve.', onFailure: hand, status: 'built' },
  { id: 'receptionist', department: 'support', label: 'Enquiry receptionist', trigger: 'A buyer or visitor asks a question before or instead of buying.',
    data: ['catalogue', 'policies', 'brand voice', 'checkout link'], rules: ['Answer only from the catalogue and policies.', 'Link only to the shop\'s own pages.', 'Complaints, refunds and anything unclear go to the owner.'],
    action: 'draft', output: 'A reply for the owner to approve, with the buyer\'s intent labelled.', onFailure: hand, status: 'next' },
  { id: 'exchange-handler', department: 'support', label: 'Exchange handler', trigger: 'A buyer asks to swap an item.',
    data: ['order lines', 'policies', 'catalogue'], rules: ['Check the policy window and the replacement item.'], action: 'draft', output: 'An exchange offer to approve.', onFailure: hand, status: 'later', physicalOnly: true },
  { id: 'escalation-router', department: 'support', label: 'Hand-off', trigger: 'A message the team cannot answer safely.',
    data: ['message', 'order'], rules: ['A conflicting fact (marked delivered, buyer says no) always goes to the owner.'], action: 'read', output: 'A hand-off card in the Inbox.', onFailure: hand, status: 'built' },
  { id: 'return-check', department: 'returns', label: 'Return check', trigger: 'A buyer asks for a return or refund.',
    data: ['order lines', 'policies', 'fulfilment'], rules: ['Tie the request to one order line.', 'Check the policy window.'], action: 'read', output: 'Eligible or not, with the reason.', onFailure: hand, status: 'next' },
  { id: 'refund-processor', department: 'returns', label: 'Refund processor', trigger: 'A return reaches the required state.',
    data: ['order', 'payment'], rules: ['Every refund waits for the owner. No automatic refunds.', 'Access to the download is removed once refunded.'], action: 'money', output: 'A one-tap refund decision.', onFailure: hand, status: 'later' },
  { id: 'review-asker', department: 'reviews', label: 'Review asker', trigger: 'A few days after delivery.',
    data: ['order', 'fulfilment'], rules: ['The timer starts at actual delivery, not payment.', 'Ask once.'], action: 'send', output: 'A review request to approve.', onFailure: 'Skip and note it.', status: 'next' },
  { id: 'bad-review-flag', department: 'reviews', label: 'Bad review flag', trigger: 'A low rating or a complaint arrives.',
    data: ['review', 'order'], rules: ['Tell the owner first, with the review and the order.'], action: 'read', output: 'An alert for the owner.', onFailure: hand, status: 'later' },
  { id: 'reply-writer', department: 'reviews', label: 'Review reply', trigger: 'A review needs a response.',
    data: ['review', 'brand voice'], rules: ['Address the actual complaint.', 'Owner approves before anything is posted.'], action: 'draft', output: 'A reply to approve.', onFailure: hand, status: 'later' },
  { id: 'cart-follow-up', department: 'carts', label: 'Cart follow-up', trigger: 'A checkout was started and not paid.',
    data: ['pending orders', 'catalogue'], rules: ['Check again for a completed purchase before sending.', 'Name the exact product.'], action: 'send', output: 'A reminder to approve.', onFailure: 'Skip and note it.', status: 'next' },
  { id: 'discount-guard', department: 'carts', label: 'Discount guard', trigger: 'A reminder wants to offer a discount.',
    data: ['catalogue', 'margin rules'], rules: ['No discount unless the owner set a limit.'], action: 'read', output: 'Allowed or not.', onFailure: 'No discount.', status: 'later' },
  { id: 'stock-watcher', department: 'stock', label: 'Stock watcher', trigger: 'Daily, and after each sale.',
    data: ['orders', 'stock levels'], rules: ['Digital shops have no stock: not used.'], action: 'read', output: 'A low-stock warning.', onFailure: hand, status: 'later', physicalOnly: true },
  { id: 'order-drafter', department: 'stock', label: 'Reorder drafter', trigger: 'Stock falls below the threshold.',
    data: ['stock', 'suppliers'], rules: ['Show SKU, supplier, quantity and the stock evidence.'], action: 'draft', output: 'A reorder for approval.', onFailure: hand, status: 'later', physicalOnly: true },
  { id: 'ad-watcher', department: 'ads', label: 'Ad watcher', trigger: 'Each morning.',
    data: ['ad spend', 'orders'], rules: ['Recommend; never pause or spend on its own.'], action: 'read', output: 'Ads to pause, waiting for the owner.', onFailure: 'Report no data.', status: 'later' },
  { id: 'budget-mover', department: 'ads', label: 'Budget mover', trigger: 'The ad watcher finds a better use of spend.',
    data: ['ad spend'], rules: ['Any budget change waits for the owner.'], action: 'money', output: 'A budget suggestion.', onFailure: hand, status: 'later' },
  { id: 'ops-logger', department: 'store-ops', label: 'Ops logger', trigger: 'Any workflow finishes.',
    data: ['job results'], rules: ['One line per run, with what it did and its status.'], action: 'read', output: 'An activity entry the owner can open on a phone.', onFailure: 'Retry, then show as failed.', status: 'built' },
];

export function workflowsIn(department: Department, opts: { digitalOnly?: boolean } = {}): WorkflowDef[] {
  return workflows.filter((w) => w.department === department && !(opts.digitalOnly && w.physicalOnly));
}

export function approvalDefault(w: Pick<WorkflowDef, 'action'>): 'automatic' | 'owner_approval' { return approvalFor[w.action]; }

export interface TeamSummary { department: Department; label: string; built: number; next: number; later: number; total: number }

/** The map counts for a shop. Digital shops leave out physical-only workflows. */
export function teamSummary(opts: { digitalOnly?: boolean } = {}): TeamSummary[] {
  return departments.map((d) => {
    const list = workflowsIn(d, opts);
    return { department: d, label: DEPARTMENT_LABELS[d], built: list.filter((w) => w.status === 'built').length, next: list.filter((w) => w.status === 'next').length,
      later: list.filter((w) => w.status === 'later').length, total: list.length };
  });
}
