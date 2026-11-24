import { isSameOriginJson } from '../../../../lib/api-errors.ts';
import { sameOrigin } from '../../../../lib/request-security.ts';

/** Same-origin JSON only (Origin must equal this deployment's origin; content type must be JSON). Anything else is refused. */
export function originOk(request: Request): boolean {
  let protocol: string;
  try { protocol = new URL(request.url).protocol; } catch { return false; }
  return isSameOriginJson(request.headers, (origin, host) => sameOrigin(origin, host, protocol, process.env.LAUNCHPAD_APP_ORIGIN));
}
