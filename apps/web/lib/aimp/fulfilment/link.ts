// Re-derives the download token of an EXISTING grant (AMP-042 rework), so a delivery retry can send exactly the link the
// attempt before it sent. A files token is an HMAC over the grant id, the order line and the expiry, so signing the same grant
// again gives the same token: nothing new is minted and nothing has to be stored. The files service still decides at redeem time
// whether that grant is revoked, expired or used up. The payload here must stay identical to the one in files/service.ts `issue`.
import { signToken } from '../files/token.ts';
import type { Grant } from '../files/types.ts';

export type GrantTokenSigner = (grant: Pick<Grant, 'id' | 'orderItemId' | 'expiresAt'>) => string;

/** `secret` is the files signing secret, supplied by the wiring. It is never logged, stored or returned. */
export function grantTokenSigner(secret: string): GrantTokenSigner {
  return (grant) => signToken(secret, { g: grant.id, i: grant.orderItemId, e: Date.parse(grant.expiresAt) });
}
