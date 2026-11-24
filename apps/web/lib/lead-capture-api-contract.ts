import type { ContactConsentStatus } from './local-crm-contacts.ts';

/** Customer-visible field definitions on a published form (future server projection). */
export type LeadCapturePublishedField = {
  id: string;
  kind: 'name' | 'email' | 'phone' | 'text';
  label: string;
  required: boolean;
};

/** Future tenant-scoped published form record — not persisted by the browser-local slice. */
export type LeadCapturePublishedForm = {
  workspaceId: string;
  formId: string;
  revision: string;
  status: 'draft' | 'published' | 'archived';
  internalName: string;
  headline: string;
  ctaLabel: string;
  fields: LeadCapturePublishedField[];
  publishedAt: string | null;
};

export type LeadCaptureSubmissionPayload = {
  name: string;
  email: string;
  phone: string;
  consentStatus: ContactConsentStatus;
  answers: Record<string, string>;
};

export type PublishLeadFormRequest = {
  workspaceId: string;
  formId: string;
  expectedRevision: string | null;
};

export type PublishLeadFormResponse =
  | { configured: true; form: LeadCapturePublishedForm }
  | LeadCaptureApiUnavailable;

export type SubmitLeadFormRequest = {
  workspaceId: string;
  publishedFormId: string;
  revision: string;
  payload: LeadCaptureSubmissionPayload;
  idempotencyKey: string;
};

export type SubmitLeadFormResponse =
  | { configured: true; contactId: string; duplicate: boolean }
  | LeadCaptureApiUnavailable;

export type LeadCaptureApiUnavailable = {
  configured: false;
  error: string;
};

/** Explicit stub for UI and future client adapters — no network call is made in this slice. */
export function leadCaptureApiNotConnected(): LeadCaptureApiUnavailable {
  return {
    configured: false,
    error: 'Lead capture API is not connected. Browser-local form drafts and preview submissions only.',
  };
}

export function describeLeadCaptureApiBoundary(): string {
  return 'Tenant-scoped publish/submit contracts are defined in lead-capture-api-contract.ts; wire to authenticated workspace APIs after S01/S06.';
}
