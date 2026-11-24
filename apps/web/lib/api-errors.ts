// Stable machine-readable error codes for API responses. Added alongside the existing `error` text, so clients that read `error`,
// `signedIn` or `configured` keep working. Messages are plain English and never contain provider details or secrets.
export const apiErrorCodes = ['not_configured', 'signed_out', 'session_revoked', 'forbidden_origin', 'no_workspace_access', 'storage_unavailable', 'invalid_request', 'too_large', 'rate_limited', 'conflict', 'upstream_failed', 'feature_paused'] as const;
export type ApiErrorCode = typeof apiErrorCodes[number];
export const apiErrorStatus: Record<ApiErrorCode, number> = {
  not_configured: 503, signed_out: 401, session_revoked: 401, forbidden_origin: 403, no_workspace_access: 403,
  storage_unavailable: 503, invalid_request: 400, too_large: 413, rate_limited: 429, conflict: 409, upstream_failed: 502, feature_paused: 423,
};
export type ApiErrorBody = { error: string; code: ApiErrorCode } & Record<string, unknown>;
export function apiError(code: ApiErrorCode, message: string, extra: Record<string, unknown> = {}): { body: ApiErrorBody; status: number } {
  return { body: { ...extra, error: message, code }, status: apiErrorStatus[code] };
}

// Request validation helpers, free of framework types so they can be tested directly.
export type HeaderReader = { get(name: string): string | null };
export function isJsonContentType(contentType: string | null): boolean {
  return !!contentType && /^application\/json\s*(;|$)/i.test(contentType.trim());
}
/** True when a state-changing request came from this app's own origin and declares a JSON body. */
export function isSameOriginJson(headers: HeaderReader, sameOrigin: (origin: string | null, host: string | null) => boolean): boolean {
  return sameOrigin(headers.get('origin'), headers.get('host')) && isJsonContentType(headers.get('content-type'));
}
/** Plain object check for parsed JSON request bodies (rejects null, arrays, primitives). */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
export function safeInteger(value: unknown, min = 0): number | null {
  return Number.isSafeInteger(value) && (value as number) >= min ? value as number : null;
}
