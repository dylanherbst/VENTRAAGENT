// AIMP feature flags. Pure: parsed from an injected env-like object, never process.env.
// Defaults: fixtures allowed, every provider enabled, every LIVE flag off.

export type EnvLike = Readonly<Record<string, string | undefined>>;

export const PROVIDER_IDS = ['llm', 'payments', 'email', 'storage', 'social', 'domains'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export interface ProviderFlags {
  /** Master switch. false => status "disabled". */
  enabled: boolean;
  /** Explicit opt-in to live. Never inferred from credentials. */
  live: boolean;
}

export interface AimpFlags {
  /** When true, missing credentials resolve to labelled fixtures instead of "disconnected". */
  fixturesAllowed: boolean;
  providers: Readonly<Record<ProviderId, ProviderFlags>>;
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const v = value.trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true;
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
  return fallback;
}

export const DEFAULT_FLAGS: AimpFlags = {
  fixturesAllowed: true,
  providers: {
    llm: { enabled: true, live: false },
    payments: { enabled: true, live: false },
    email: { enabled: true, live: false },
    storage: { enabled: true, live: false },
    social: { enabled: true, live: false },
    domains: { enabled: true, live: false },
  },
};

/** Env names: AIMP_FIXTURES_ALLOWED, AIMP_<PROVIDER>_ENABLED, AIMP_<PROVIDER>_LIVE. */
export function parseFlags(env: EnvLike): AimpFlags {
  const providers = {} as Record<ProviderId, ProviderFlags>;
  for (const id of PROVIDER_IDS) {
    const key = id.toUpperCase();
    providers[id] = {
      enabled: parseBool(env[`AIMP_${key}_ENABLED`], true),
      live: parseBool(env[`AIMP_${key}_LIVE`], false),
    };
  }
  return { fixturesAllowed: parseBool(env.AIMP_FIXTURES_ALLOWED, true), providers };
}
