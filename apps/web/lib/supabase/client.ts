import { createClient } from '@supabase/supabase-js';

// Explicit factory only: no client created during import/render.
// This skeleton is not cookie-based server auth or an RLS implementation.
type ClientOptions = { url?: string; publishableKey?: string; fetch?: typeof globalThis.fetch };
export function createSupabaseClient({
  url = process.env.NEXT_PUBLIC_SUPABASE_URL,
  publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  fetch: fetchImplementation,
}: ClientOptions = {}) {
  if (!url || !publishableKey) {
    throw new Error('Supabase is not configured. Set the approved DEV URL and publishable key.');
  }
  return createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...(fetchImplementation ? { global: { fetch: fetchImplementation } } : {}),
  });
}
