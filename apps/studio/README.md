# AiMoneyPrinter Studio

This is the owner's own private app. Each of your brands (add as many as you like) gets the same three agents the customer app has:

- **AI Team.** A Marketing agent (five ad angles) and a Social agent (a 7- or 30-day plan, images and video, approve, then schedule).
- **Ad angles.** Write angles from a brief, or load any of the 100 ads in the AD_DRAFTS playbook.
- **AI Setter.** Answers DMs in your voice, qualifies people and sends your link. There is a test inbox per brand. A real Instagram account needs the Meta app first.

The Studio reuses the agent code in `apps/web/lib/aimp` (agents, marketing engine, setter, safety rules), so there is one copy of every rule. Each brand is its own workspace, so data never mixes between brands. Nothing is posted, sent or paid for without your approval, and paid ads stay off.

## On your Mac (no password)

1. Double-click **Run AIMP Studio.command** in the repo root.
2. It opens <http://127.0.0.1:3070>.
3. Only this Mac can open it. Your data is saved in `apps/studio/.studio-data` (git ignores this folder).
4. AI keys are read from `apps/web/.env.local`, so nothing is copied.

## Hosted, for example studio.aimoneyprinter.com (password login)

1. Run `cd apps/studio && npm run password` and type a password. It prints two lines, `STUDIO_PASSWORD_HASH` and `STUDIO_SESSION_SECRET`. Your password is never stored, only its hash.
2. Supabase: run `supabase db push`. This adds `studio_snapshots`, a private table that only the server key can read.
3. Create a new Vercel project:
   - Repo: the same one.
   - **Root Directory:** `apps/studio`.
   - Environment variables:
     - the two login lines from step 1
     - `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
     - `ANTHROPIC_API_KEY`
     - optional: OpenAI, Creatomate and Zernio keys (see `.env.example`)
4. Add a domain, for example `studio.aimoneyprinter.com`. Add its CNAME in Squarespace the same way as for `app`.

## Safety

- Every page and action checks the signed owner session, which expires after 12 hours.
- Login is limited to 5 tries per 15 minutes.
- Pages are `noindex` and cannot be framed by other sites.
- Media is served only to the signed-in owner.
- Real posting also needs `SOCIAL_PUBLISHING_ENABLED=true`. Until the Zernio, Creatomate and image keys are set, results are clearly labelled "Mock".
