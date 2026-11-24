import { assertTestKey } from './stripe-checkout.ts';

export type IntegrationState = 'verified' | 'configured' | 'not-configured' | 'blocked';
export type IntegrationItem = { id: 'supabase' | 'stripe-checkout' | 'stripe-webhook' | 'openai'; label: string; state: IntegrationState; detail: string; needs: string };
export type IntegrationEnv = Partial<Record<'NEXT_PUBLIC_SUPABASE_URL' | 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY' | 'STRIPE_SECRET_KEY' | 'STRIPE_WEBHOOK_SECRET' | 'OPENAI_API_KEY' | 'OPENAI_MODEL', string | undefined>>;
export type IntegrationProbes = { supabaseHealth?: 'ok' | 'failed' | 'skipped' };

// Pure. Returns only labels, states and plain-English text; never an environment value or fragment of one.
export function integrationStatus(env: IntegrationEnv, probes: IntegrationProbes = {}): IntegrationItem[] {
  const has = (v: string | undefined) => typeof v === 'string' && v.trim().length > 0;
  const out: IntegrationItem[] = [];

  if (!has(env.NEXT_PUBLIC_SUPABASE_URL) || !has(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)) {
    out.push({ id: 'supabase', label: 'Account storage (Supabase)', state: 'not-configured', detail: 'The account storage address or public key is missing on the server.', needs: 'Set both Supabase public settings in the server environment.' });
  } else if (probes.supabaseHealth === 'ok') {
    out.push({ id: 'supabase', label: 'Account storage (Supabase)', state: 'verified', detail: 'Settings are present and the sign-in service answered a health check just now.', needs: 'Nothing. Sign-in and saving still depend on your account.' });
  } else {
    out.push({ id: 'supabase', label: 'Account storage (Supabase)', state: 'configured', detail: probes.supabaseHealth === 'failed' ? 'Settings are present but the sign-in service did not answer the health check.' : 'Settings are present but no health check was run.', needs: 'Confirm the service is running and reachable, then refresh.' });
  }

  const stripeKey = env.STRIPE_SECRET_KEY;
  if (!has(stripeKey)) {
    out.push({ id: 'stripe-checkout', label: 'Stripe test checkout', state: 'not-configured', detail: 'No Stripe key is set.', needs: 'Add a Stripe TEST key (starts with sk_test_) to the server environment.' });
  } else {
    let ok = true;
    try { assertTestKey(stripeKey); } catch { ok = false; }
    out.push(ok
      ? { id: 'stripe-checkout', label: 'Stripe test checkout', state: 'configured', detail: 'A Stripe TEST key is set. No call to Stripe is made here, so it is not verified.', needs: 'Create a test checkout from the checkout tool to confirm it works.' }
      : { id: 'stripe-checkout', label: 'Stripe test checkout', state: 'blocked', detail: 'The Stripe key is not a TEST key. Live keys are refused and no live payment can be created.', needs: 'Replace it with a Stripe TEST key. Live payments need the owner’s explicit approval.' });
  }

  const hook = env.STRIPE_WEBHOOK_SECRET;
  if (!has(hook)) {
    out.push({ id: 'stripe-webhook', label: 'Stripe webhook', state: 'not-configured', detail: 'No webhook signing secret is set.', needs: 'Add the Stripe webhook signing secret (starts with whsec_).' });
  } else if (/^whsec_[A-Za-z0-9]{8,}$/.test(hook as string)) {
    out.push({ id: 'stripe-webhook', label: 'Stripe webhook', state: 'configured', detail: 'A webhook signing secret in the expected format is set. No event has been verified here.', needs: 'Send a Stripe test event to confirm delivery.' });
  } else {
    out.push({ id: 'stripe-webhook', label: 'Stripe webhook', state: 'blocked', detail: 'A webhook secret is set but is not in the expected format, so events will be rejected.', needs: 'Copy the signing secret again from Stripe (starts with whsec_).' });
  }

  const key = has(env.OPENAI_API_KEY), model = has(env.OPENAI_MODEL);
  out.push(key && model
    ? { id: 'openai', label: 'AI course generation (OpenAI)', state: 'configured', detail: 'A key and model are set. No request is made here because each one is a paid call, so it is not verified.', needs: 'Generate one course to confirm it works.' }
    : { id: 'openai', label: 'AI course generation (OpenAI)', state: 'not-configured', detail: !key && !model ? 'No AI key or model is set.' : key ? 'The AI model name is missing.' : 'The AI key is missing.', needs: 'Set both the AI key and the model name in the server environment.' });
  return out;
}
