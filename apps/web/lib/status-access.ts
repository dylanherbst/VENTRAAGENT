// Pure helpers for the integration status route: a per-caller rate-limit key and the signed-out wording.
export const SIGN_IN_MESSAGE = 'Sign in to see integration status';
export function statusRateKey(userId: string | null | undefined, forwardedFor: string | null | undefined): string {
  if (userId) return 'user:' + userId;
  const ip = (forwardedFor ?? '').split(',')[0].trim().slice(0, 64);
  return 'ip:' + (ip || 'unknown');
}
