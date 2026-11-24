// AMP-153: connects the public-store email sign-up to the real /start runtime. Server-only; imported by actions.ts (a later task).
// Same shape as wiring.ts. Not loaded by node tests (runtime.ts is not loadable there); the logic it feeds is in audience.ts.
import { getPrimaryRegistry, startRuntimeFromGlobal } from '../../../../lib/aimp/hosts/registry';
import { availability, runtime, WORKSPACE } from '../../../start/_server/runtime';
import { createOptInLimiter } from './audience';
import type { OptInDeps } from './audience';

// One limiter for the whole server process, so every request shares the same per-store counters.
const limiter = createOptInLimiter();

export function optInDeps(): OptInDeps {
  return {
    availability,
    limiter,
    world: async () => {
      // No /start runtime in this process means no /start store can exist: do not create one for a public form post.
      if (!startRuntimeFromGlobal()) return null;
      const rt = runtime();
      // The ONE built-in registry (AMP-152), so a built-in address is refused the same way as in wiring.ts.
      return { audience: rt.audience, workspaceId: WORKSPACE, slugs: rt.slugs, origin: { primary: await getPrimaryRegistry(), sites: rt.sites } };
    },
  };
}
