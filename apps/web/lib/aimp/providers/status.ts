import { PROVIDER_IDS, parseFlags, type AimpFlags, type EnvLike, type ProviderId } from '../flags.ts';
import type { ProviderStatus } from './types.ts';

interface ProviderMeta {
  name: string;
  /** All of these variables must be non-empty for credentials to count as present. */
  credentialVars: readonly string[];
  /** Plain-English noun for the missing thing, e.g. "Stripe test keys". */
  missing: string;
}

export const PROVIDER_META: Readonly<Record<ProviderId, ProviderMeta>> = {
  llm: { name: 'AI generation', credentialVars: ['ANTHROPIC_API_KEY'], missing: 'AI model key' },
  payments: { name: 'Stripe Connect payments', credentialVars: ['STRIPE_SECRET_KEY'], missing: 'Stripe test keys' },
  email: { name: 'Email delivery', credentialVars: ['RESEND_API_KEY'], missing: 'email provider key' },
  storage: {
    name: 'Private file storage',
    credentialVars: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
    missing: 'storage credentials',
  },
  social: { name: 'Social posting (Zernio)', credentialVars: ['ZERNIO_API_KEY'], missing: 'Zernio API key' },
  domains: { name: 'Domains and hosting', credentialVars: ['VERCEL_API_TOKEN'], missing: 'domain provider token' },
};

/** Only checks presence; values are never copied into any result. */
export function credentialsPresent(provider: ProviderId, env: EnvLike): boolean {
  return PROVIDER_META[provider].credentialVars.every((k) => {
    const v = env[k];
    return typeof v === 'string' && v.trim().length > 0;
  });
}

export function resolveStatus(provider: ProviderId, env: EnvLike, flags: AimpFlags = parseFlags(env)): ProviderStatus {
  const meta = PROVIDER_META[provider];
  const pf = flags.providers[provider];
  const present = credentialsPresent(provider, env);
  const base = { provider, credentialsPresent: present };

  if (!pf.enabled) {
    return {
      ...base,
      status: 'disabled',
      demo: false,
      label: `${meta.name}: off`,
      reason: `${meta.name} is switched off by a feature flag.`,
    };
  }
  if (!present) {
    if (flags.fixturesAllowed) {
      return {
        ...base,
        status: 'fixture',
        demo: true,
        label: `${meta.name}: demo data`,
        reason: `${meta.missing} not added yet - using labelled demo data.`,
      };
    }
    return {
      ...base,
      status: 'disconnected',
      demo: false,
      label: `${meta.name}: not connected`,
      reason: `${meta.missing} not added yet and demo data is turned off, so this is not connected.`,
    };
  }
  if (pf.live) {
    return {
      ...base,
      status: 'live',
      demo: false,
      label: `${meta.name}: live`,
      reason: `Live mode was switched on explicitly and credentials are present.`,
    };
  }
  // NOTE: a real test-mode adapter (talking to the provider's sandbox) is a later task.
  // Until then "test" still runs on the fixture adapter: demo data, no provider contact.
  return {
    ...base,
    status: 'test',
    demo: true,
    label: `${meta.name}: demo data (keys found, live off)`,
    reason: `Keys were found but live mode is not switched on - still using labelled demo data and not contacting ${meta.name}.`,
  };
}

export function resolveAllStatuses(env: EnvLike, flags: AimpFlags = parseFlags(env)): Record<ProviderId, ProviderStatus> {
  const out = {} as Record<ProviderId, ProviderStatus>;
  for (const id of PROVIDER_IDS) out[id] = resolveStatus(id, env, flags);
  return out;
}
