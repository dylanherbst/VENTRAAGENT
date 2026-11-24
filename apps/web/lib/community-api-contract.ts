/** Future private community record — not persisted by the browser-local draft slice. */
export type CommunityPrivateSpace = {
  workspaceId: string;
  spaceId: string;
  revision: string;
  status: 'draft' | 'published' | 'archived';
  visibility: 'private' | 'members';
  name: string;
  topicCount: number;
  publishedAt: string | null;
};

/** Future member entitlement — member preview never creates one of these. */
export type CommunityMembership = {
  workspaceId: string;
  spaceId: string;
  memberId: string;
  role: 'owner' | 'moderator' | 'member';
  joinedAt: string | null;
  entitled: boolean;
};

export type GetPrivateCommunityRequest = { workspaceId: string; spaceId: string };
export type GetPrivateCommunityResponse =
  | { configured: true; space: CommunityPrivateSpace }
  | CommunityApiUnavailable;

export type ListCommunityMembershipsRequest = { workspaceId: string; spaceId: string; memberId?: string };
export type ListCommunityMembershipsResponse =
  | { configured: true; memberships: CommunityMembership[] }
  | CommunityApiUnavailable;

export type CommunityApiUnavailable = {
  configured: false;
  error: string;
};

/** Explicit stub for UI and future client adapters — no network call is made in this slice. */
export function communityApiNotConnected(): CommunityApiUnavailable {
  return {
    configured: false,
    error: 'Community API is not connected. Browser-local space drafts and read-only member preview only.',
  };
}

export function describeCommunityApiBoundary(): string {
  return 'Private community and membership contracts live in community-api-contract.ts; wire to authenticated workspace APIs after backend setup.';
}
