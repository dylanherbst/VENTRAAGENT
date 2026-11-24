'use server';
// AMP-150: the one server action of the public store. It takes a store address and an email from the form, reloads the published
// store on the server and runs the labelled FIXTURE test purchase (no Stripe, no network, no real email). The business, the store
// config and the seller never come from the browser. See _server/test-purchase.ts for the checks.
// AMP-155: the email sign-up and "Stop emails" actions. Same rule: only the store address and plain form fields come from the browser;
// the reply is `{ ok, message }` and nothing else.
import { submitOptIn, submitUnsubscribe } from './_server/audience';
import { optInDeps } from './_server/audience-wiring';
import { submitTestPurchase } from './_server/test-purchase';
import type { TestPurchaseReply } from './_server/test-purchase';
import { testPurchaseDeps } from './_server/wiring';

export async function testPurchaseAction(_previous: TestPurchaseReply | null, form: FormData): Promise<TestPurchaseReply> {
  return submitTestPurchase(testPurchaseDeps(), form.get('store'), form.get('email'));
}

export async function submitOptInAction(storeAddress: unknown, input: unknown): Promise<{ ok: boolean; message: string }> {
  const r = await submitOptIn(optInDeps(), storeAddress, input);
  return { ok: r.ok, message: r.message };
}

export async function unsubscribeAction(storeAddress: unknown, input: unknown): Promise<{ ok: boolean; message: string }> {
  const r = await submitUnsubscribe(optInDeps(), storeAddress, input);
  return { ok: r.ok, message: r.message };
}
