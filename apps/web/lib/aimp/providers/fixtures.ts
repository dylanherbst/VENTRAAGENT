// Deterministic fixture adapters. No network, no clocks (inject `now`), no randomness.
import type {
  AdapterMap,
  CheckoutSession,
  DomainRecord,
  DomainsAdapter,
  EmailAdapter,
  LlmAdapter,
  OutboxMessage,
  PaymentEvent,
  PaymentsAdapter,
  SocialAdapter,
  SocialPost,
  StorageAdapter,
  StoredFile,
} from './types.ts';

const MARK = { fixture: true, source: 'fixture' } as const;

export interface FixtureOptions {
  /** Epoch ms. Defaults to a fixed instant so output is deterministic. */
  now?: () => number;
}
const FIXED_NOW = 1_800_000_000_000;

/** FNV-1a, hex. Stable across runs. */
export function stableHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Same key, same result, effect not repeated. No key means no dedupe. */
function keyed<T>(seen: Map<string, T>, key: string | undefined, make: () => T): T {
  if (key === undefined) return make();
  const hit = seen.get(key);
  if (hit !== undefined) return hit;
  const made = make();
  seen.set(key, made);
  return made;
}

export function createFixtureLlm(): LlmAdapter {
  const seen = new Map<string, Awaited<ReturnType<LlmAdapter['generate']>>>();
  return {
    async generate({ prompt, system, idempotencyKey }) {
      return keyed(seen, idempotencyKey, () => {
        const id = stableHash(`${system ?? ''}|${prompt}`);
        return { ...MARK, model: 'fixture-llm', text: `[DEMO ${id}] Sample AI text for: ${prompt.slice(0, 80)}` };
      });
    },
  };
}

export function createFixturePayments(): PaymentsAdapter {
  const sessions = new Map<string, CheckoutSession>();
  const events: PaymentEvent[] = [];
  const seenSessions = new Map<string, CheckoutSession>();
  const seenEvents = new Map<string, PaymentEvent>();
  return {
    createCheckoutSession: async (input) => keyed(seenSessions, input.idempotencyKey, () => {
      const id = `cs_fixture_${stableHash(`${input.productName}|${input.amountCents}|${sessions.size}`)}`;
      const session: CheckoutSession = {
        ...MARK,
        id,
        url: `https://checkout.fixture.invalid/${id}`,
        amountCents: input.amountCents,
        currency: input.currency,
        productName: input.productName,
        status: 'open',
      };
      sessions.set(id, session);
      return session;
    }),
    completeSession: async (sessionId, opts) => keyed(seenEvents, opts?.idempotencyKey, () => {
      const s = sessions.get(sessionId);
      if (!s) throw new Error('Unknown fixture checkout session.');
      const ev: PaymentEvent = {
        ...MARK,
        id: `evt_fixture_${stableHash(`${sessionId}|${events.length}`)}`,
        type: 'checkout.session.completed',
        sessionId,
        amountCents: s.amountCents,
      };
      events.push(ev);
      return ev;
    }),
    listEvents: () => [...events],
  };
}

export function createFixtureEmail(): EmailAdapter {
  const box: OutboxMessage[] = [];
  const seen = new Map<string, OutboxMessage>();
  return {
    send: async (input) => keyed(seen, input.idempotencyKey, () => {
      const msg: OutboxMessage = {
        ...MARK,
        id: `mail_fixture_${stableHash(`${input.to}|${input.subject}|${box.length}`)}`,
        to: input.to,
        subject: input.subject,
        text: input.text,
        delivered: false,
      };
      box.push(msg);
      return msg;
    }),
    outbox: () => [...box],
  };
}

export function createFixtureStorage(opts: FixtureOptions = {}): StorageAdapter {
  const now = opts.now ?? (() => FIXED_NOW);
  const files = new Map<string, number>();
  const seen = new Map<string, StoredFile>();
  return {
    put: async (path, bytes, opts) => keyed(seen, opts?.idempotencyKey, () => {
      files.set(path, bytes.byteLength);
      return { ...MARK, path, size: bytes.byteLength, private: true as const };
    }),
    async signedUrl(path, ttlSeconds) {
      if (!files.has(path)) throw new Error('Unknown fixture file.');
      const expiresAt = now() + ttlSeconds * 1000;
      return {
        ...MARK,
        path,
        expiresAt,
        url: `https://storage.fixture.invalid/private/${encodeURIComponent(path)}?sig=${stableHash(`${path}|${expiresAt}`)}&exp=${expiresAt}`,
      };
    },
  };
}

export function createFixtureSocial(): SocialAdapter {
  const q: SocialPost[] = [];
  const seen = new Map<string, SocialPost>();
  return {
    queuePost: async (input) => keyed(seen, input.idempotencyKey, () => {
      const post: SocialPost = {
        ...MARK,
        id: `pin_fixture_${stableHash(`${input.title}|${q.length}`)}`,
        network: 'pinterest',
        title: input.title,
        link: input.link,
        imageUrl: input.imageUrl,
        status: 'queued',
        published: false,
      };
      q.push(post);
      return post;
    }),
    queue: () => [...q],
  };
}

export function createFixtureDomains(): DomainsAdapter {
  const seen = new Map<string, DomainRecord>();
  return {
    provision: async (slug, opts) => keyed(seen, opts?.idempotencyKey, () => {
      const clean = slug.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '') || 'store';
      return { ...MARK, hostname: `${clean}.aimp.localhost`, kind: 'local-test', verified: true };
    }),
  };
}

export function createFixtureAdapters(opts: FixtureOptions = {}): AdapterMap {
  return {
    llm: createFixtureLlm(),
    payments: createFixturePayments(),
    email: createFixtureEmail(),
    storage: createFixtureStorage(opts),
    social: createFixtureSocial(),
    domains: createFixtureDomains(),
  };
}
