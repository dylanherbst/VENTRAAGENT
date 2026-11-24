# Launch checklist

## Dylan

1. Create the GitHub repo `AIMONEYPRINTER-GROWTH`. Then, in this folder:
   ```
   git remote add origin <url>
   git push -u origin main
   ```
2. Create a NEW Supabase project for Growth. Add its URL and keys to `apps/web/.env.local` and to Vercel, then run `supabase db push`.
3. Create a new Vercel project from the new repo, with Root Directory `apps/web`. Add the env vars from `apps/web/.env.example`, then the domain.
4. In Stripe, create 3 products (Starter, Growth, Autopilot) and their prices in test mode. Add the price ids to the env.
5. Zernio: an account, an API key, and a webhook pointing at `https://<domain>/api/webhooks/zernio`. Connect a test Instagram Business account.
6. Meta: app review for Instagram DMs (AI Sales).
7. Copy the new positioning onto the public website.

## Engineering, before taking money

- [ ] Durable storage per business (task 8)
- [ ] Scheduled Growth Manager run (task 9)
- [ ] Tier enforcement (task 10)
- [ ] Visual pass on phone and desktop (task 11)
- [ ] One full live test on a test-owned Instagram account: onboarding → plan → approve → schedule → published status → DM reply

## Never

- Point this app at the original Supabase project.
- Enable paid ads or automatic DMs without the owner's explicit setting.
- Show mock results as real.
