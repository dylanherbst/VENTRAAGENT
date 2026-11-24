'use server';
// Buy now. Until Stripe is connected (checkout task) this refuses honestly and takes no payment or email.
export async function buyNowAction(): Promise<{ message: string }> {
  return { message: 'Checkout is not switched on yet, so nothing was charged.' };
}
