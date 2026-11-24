import { PROVIDER_IDS, parseFlags, type AimpFlags, type EnvLike, type ProviderId } from '../flags.ts';
import { createFixtureAdapters, type FixtureOptions } from './fixtures.ts';
import { resolveStatus } from './status.ts';
import type { AdapterMap, ProviderStatus } from './types.ts';

export interface ProviderEntry<K extends ProviderId = ProviderId> {
  status: ProviderStatus;
  /**
   * Adapter to use, or null when none is available (disabled, disconnected, or live with no
   * real adapter injected). Callers must handle null as "this integration is off".
   */
  adapter: AdapterMap[K] | null;
}

export type ProviderRegistry = { [K in ProviderId]: ProviderEntry<K> };

export interface RegistryOptions extends FixtureOptions {
  env: EnvLike;
  flags?: AimpFlags;
  /**
   * Real adapters, injected by the caller. Used ONLY when the status is `live`; they are
   * ignored for fixture, test, disconnected and disabled. A `test` status uses the fixture
   * adapter (a real test-mode adapter is a later task).
   */
  liveAdapters?: Partial<AdapterMap>;
}

/**
 * Pure: builds the registry from an injected env. Fixture and test statuses get fixture
 * adapters (no network). Live is chosen only by status resolution (explicit flag + credentials).
 */
export function createProviderRegistry(opts: RegistryOptions): ProviderRegistry {
  const flags = opts.flags ?? parseFlags(opts.env);
  const fixtures = createFixtureAdapters(opts);
  const out: Record<string, ProviderEntry> = {};
  for (const id of PROVIDER_IDS) {
    const status = resolveStatus(id, opts.env, flags);
    let adapter: AdapterMap[ProviderId] | null = null;
    if (status.status === 'fixture' || status.status === 'test') adapter = fixtures[id];
    else if (status.status === 'live') adapter = opts.liveAdapters?.[id] ?? null;
    out[id] = { status, adapter };
  }
  return out as ProviderRegistry;
}
