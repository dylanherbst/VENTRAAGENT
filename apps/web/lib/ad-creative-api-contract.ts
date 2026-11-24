/** Future tenant-scoped generated creative asset — not created by the browser-local text slice. */
export type AdCreativeGeneratedAsset = {
  workspaceId: string;
  conceptId: string;
  assetId: string;
  kind: 'image' | 'video' | 'copy_variant';
  status: 'draft' | 'approved' | 'rejected';
  provider: string;
  createdAt: string;
};

export type GenerateAdCreativeRequest = {
  workspaceId: string;
  conceptId: string;
  channel: string;
};

export type GenerateAdCreativeResponse =
  | { configured: true; assets: AdCreativeGeneratedAsset[] }
  | AdCreativeApiUnavailable;

export type AdCreativeApiUnavailable = {
  configured: false;
  error: string;
};

/** Explicit stub — no provider calls, spend, or media generation in this slice. */
export function adCreativeApiNotConnected(): AdCreativeApiUnavailable {
  return {
    configured: false,
    error: 'Ad creative generation API is not connected. Browser-local text concept drafts and read-only preview only.',
  };
}

export function describeAdCreativeApiBoundary(): string {
  return 'Generation and publish contracts live in ad-creative-api-contract.ts; wire after backend setup and owner-approved providers.';
}
