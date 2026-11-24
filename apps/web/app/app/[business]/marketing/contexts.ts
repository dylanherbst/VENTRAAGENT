// The server-side identity the page and its action share: the fixed DEMO workspace and owner of the /start runtime
// (app/start/_server/runtime.ts). Server only; nothing here is read from the request.
import { OWNER, WORKSPACE, catalogueCtx } from '../../../start/_server/runtime';
import type { MarketingContexts } from './_server/marketing';

export function marketingContexts(storeEnv?: MarketingContexts['storeEnv']): MarketingContexts {
  return { workspaceId: WORKSPACE, ownerId: OWNER, catalogueCtx, ...(storeEnv ? { storeEnv } : {}) };
}
