# Owner to-do: logins, keys and approvals

Things only the owner can do. Building continues around them; each line says what it unblocks.
Never paste a secret into a chat: put values in the server environment (`.env.local` on the Mac, or the host's env settings).

## Production status (2026-11-07)

- Website and app live at https://www.aiventra.com.au (apex redirects to www). Vercel team `ventra14`, project `ventra` (Pro trial), deployed from `apps/web` with `vercel --prod`.
- Database: Supabase project "Ventra AI" (ref `radmzhrdgqooukzhtdgg`), all migrations applied. Auth Site URL set to https://www.aiventra.com.au/workspace.
- Google OAuth app "Ventra Front Office" published to production with home, privacy and terms links on aiventra.com.au.
- In Vercel env (Production): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SITE_URL`, `FRONT_OFFICE_PUBLIC_ORIGIN`, `FRONT_OFFICE_MODEL` (`claude-sonnet-5-5`), `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` (rotated 2026-11-07), `ANTHROPIC_API_KEY`, `POSTMARK_SERVER_TOKEN`, `FRONT_OFFICE_CRON_SECRET`.
- Delete `apps/web/.env.vercel` on the Mac now that its values are in Vercel.

## Next, in order (production)

- [ ] Re-save `TWILIO_AUTH_TOKEN`, `ANTHROPIC_API_KEY`, `POSTMARK_SERVER_TOKEN` and `FRONT_OFFICE_CRON_SECRET` as type **Secret** in Vercel (they were saved as Config, readable by team members; Vercel shows "Needs Attention"). Use Rotate Variable.
- [ ] Add funds to the Claude Console (balance A$0): the Setter cannot answer until then.
- [ ] Create your owner account and a workspace named **Ventra** at https://www.aiventra.com.au/workspace.
- [ ] Run `docs/agents/sql/create_channels.sql` in the Supabase SQL editor (edit the Postmark inbound address at the top first, or leave it to skip email). Copy each channel id and key from the result into Vercel as Secret: `FRONT_OFFICE_CHAT_CHANNEL_ID`/`_KEY`, `FRONT_OFFICE_EMAIL_CHANNEL_ID`/`_KEY` (and later `FRONT_OFFICE_CHANNEL_ID`/`_KEY` for SMS).
- [ ] Add `CRON_SECRET` in Vercel (Secret) with the same value as `FRONT_OFFICE_CRON_SECRET`. `vercel.json` runs the job runner every minute; Vercel sends `CRON_SECRET`. Every-minute crons need a Pro team: on Hobby the deploy fails, so change the schedule to daily or use an outside scheduler with POST.
- [ ] Email channel: add `FRONT_OFFICE_EMAIL_FROM` (verified Postmark sender) and `FRONT_OFFICE_EMAIL_WEBHOOK_SECRET` (16+ random characters), then set the Postmark inbound webhook (see One-time setup).
- [ ] Google Calendar: refresh token from OAuth Playground, then `GOOGLE_CALENDAR_CLIENT_ID`, `_CLIENT_SECRET`, `_REFRESH_TOKEN`, `_ID` in Vercel.
- [ ] Redeploy (`vercel --prod` in `apps/web`) after the commits on `feature/ventra-website` and after every env change.
- [ ] Test the website chat on the live site yourself, then approve `FRONT_OFFICE_CHAT_LIVE=1` (AI answers) and later `FRONT_OFFICE_SEND_LIVE=1` (real SMS/email).
- [ ] Choose the Vercel Pro plan before commercial use (trial).

## Your AI team settings (gyms and Ventra)

- [ ] Apply the new migration `supabase/migrations/202611080001_front_office_receptionist.sql` in the Supabase SQL editor (Ventra AI project), then redeploy. Without it the settings page and phone calls cannot save anything.
- [ ] Fill in https://www.aiventra.com.au/tools/front-office-settings for Ventra (template "Ventra"), then Save. For a gym client: their own workspace, template "Gym", then:
  - business name and what is booked (default: free trial session or tour, edit it),
  - booking hours per day (empty = the AI takes a message instead of booking), length, time zone,
  - their qualifying questions (3 to 5; the gym template has goal, experience/injuries, preferred times, start date, membership interest),
  - FAQ answers in their own words: prices, opening hours, classes, location, parking. The AI states only these; everything else becomes a message,
  - staff mobile and email for messages, a transfer number for urgent calls, the phone greeting, and a call recording notice if calls are recorded,
  - switches: Setter, Receptionist, Answer phone calls.
- [ ] A gym's channels: run `create_channels.sql` with their workspace name (edit `workspace_name` and the addresses), one voice channel per gym.

## AI Receptionist (Vapi)

- [ ] Create a Vapi account at vapi.ai (pay as you go). Do not paste keys in chat.
- [ ] Voice channel: `create_channels.sql` now also creates a `voice` channel (address `vapi-ventra`). Add `FRONT_OFFICE_VOICE_CHANNEL_ID` and `FRONT_OFFICE_VOICE_CHANNEL_KEY` in Vercel (Secret).
- [ ] In Vapi > Integrations > Custom LLM (or the assistant's credentials): add a Bearer token credential whose value is the voice channel key.
- [ ] Create an assistant: Model provider **Custom LLM**, URL `https://www.aiventra.com.au/api/front-office/voice/vapi/chat/completions` (the full URL, as in Vapi's custom LLM example), with that credential. First message mode: **assistant speaks first with model-generated message** (our server says the greeting with the AI disclosure).
- [ ] Assistant Server URL: `https://www.aiventra.com.au/api/front-office/voice/vapi/webhook`, same Bearer credential. Turn on the end-of-call report.
- [ ] Add Vapi's built-in **transferCall** tool with your transfer number as a destination (same number as in the settings page) and **endCall**.
- [ ] Phone number: import the Twilio AU number into Vapi once it is bought (Phone Numbers > Import > Twilio), and attach the assistant. For a first test you can use a Vapi test number.
- [ ] For a gym: one assistant per gym, URLs `https://www.aiventra.com.au/api/front-office/voice/vapi/<their voice channel id>/chat/completions` and `.../<id>/webhook`, credential = their voice channel key.
- [ ] Test call with `FRONT_OFFICE_VOICE_LIVE` unset: you should hear "isn't switched on yet" and the call ends; your number shows up as a call-back message. Then approve `FRONT_OFFICE_VOICE_LIVE=1` (Vercel), switch on "Answer phone calls" in settings, redeploy, and call again.
- [ ] Decide whether calls are recorded in Vapi. If yes, write the notice in settings (it is read at the start of every call) and check the privacy policy covers it.
- [ ] Live replay after any prompt change: `ANTHROPIC_API_KEY=... FRONT_OFFICE_MODEL=... node --experimental-strip-types apps/web/test/live/setter-live.ts` (now also five Receptionist calls).

## Run on the Mac

- [ ] `ventra-verify` on `feature/front-office-pivot` (runs `next build` and the local Supabase integration, which the Cowork VM cannot).
- [ ] `ventra-handoff status`, then `ventra-handoff recover` if the Nov 3 lock (pid 49645) is stale.
- [ ] Apply the front-office migrations to the LOCAL Supabase stack only: `supabase migration up` (files `202611060001` to `202611060004`). Production migrations need a release review.

## Blocked for now

- [ ] Twilio: account set up and auth token rotated (2026-11-07; SID and token in Vercel). Still blocked: buy an AU mobile number (needs ID), then `TWILIO_FROM_NUMBER` and the SMS channel (edit the number in `create_channels.sql`).
- [x] Public URL (2026-11-07): deployed to Vercel (team `ventra14`, project `ventra`, Pro trial) at https://ventra-rho.vercel.app. Production DB is Supabase project "Ventra AI" (ref `radmzhrdgqooukzhtdgg`), all migrations applied. Redeploy from `apps/web` with `vercel --prod`.

- [x] Google app publishing (2026-11-07): published to production with the aiventra.com.au links. The old drafts in `/Users/dylan/Developer/aiventrai-site/` are superseded by `/site`.

## Logins and keys (server env)

| Needed for | Values | Where to get them |
| --- | --- | --- |
| Inbound SMS webhook (0.5, gate 0.7) | `TWILIO_AUTH_TOKEN` | Twilio console, Account info |
| Sending SMS (1.3 to 1.5) | `TWILIO_ACCOUNT_SID`, `TWILIO_FROM_NUMBER` (E.164, the number leads text) | Twilio console; buy an AU mobile number |
| Webhook URL signing behind a proxy or tunnel | `FRONT_OFFICE_PUBLIC_ORIGIN` (e.g. `https://ventra.example.com`) | Your public URL |
| Google Calendar (1.2, 1.3). Done: project `ventra-front-office`, Calendar API on, OAuth app + web client "Ventra calendar booking" (redirect: OAuth Playground). Left: publish the app, get the refresh token | `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, `GOOGLE_CALENDAR_REFRESH_TOKEN`, `GOOGLE_CALENDAR_ID` | Google Cloud console: enable Calendar API, OAuth client (web), consent screen; get a refresh token for the bookings calendar with scopes `calendar.events` + `calendar.freebusy` |
| AI Receptionist (Vapi) | `FRONT_OFFICE_VOICE_CHANNEL_ID`, `FRONT_OFFICE_VOICE_CHANNEL_KEY` (also the Bearer token in Vapi), `FRONT_OFFICE_VOICE_LIVE=1` (your approval) | `create_channels.sql`; Vapi dashboard |
| Setter AI (1.1) | `ANTHROPIC_API_KEY`, `FRONT_OFFICE_MODEL` (exact Claude model id to use) | console.anthropic.com; pick the model id from the models page |
| Follow-up and reminder runner (1.4, 1.5) | `FRONT_OFFICE_CRON_SECRET` and `CRON_SECRET` (same 32+ character value); it works through every configured channel pair: `FRONT_OFFICE_CHANNEL_*` (SMS), `FRONT_OFFICE_CHAT_CHANNEL_*`, `FRONT_OFFICE_EMAIL_CHANNEL_*` | Generate the secret yourself; channel ids and keys come from `docs/agents/sql/create_channels.sql` |
| Website chat (1.8) | `FRONT_OFFICE_CHAT_CHANNEL_ID`, `FRONT_OFFICE_CHAT_CHANNEL_KEY`; `FRONT_OFFICE_CHAT_ORIGINS` if the widget sits on another site; `FRONT_OFFICE_CHAT_LIVE=1` to let the AI answer | Create a `web-chat` channel with `fo_create_channel` (address = your site, e.g. `ventra.com.au`) |
| Email (1.9) | `POSTMARK_SERVER_TOKEN`, `FRONT_OFFICE_EMAIL_FROM` (verified sender), `FRONT_OFFICE_EMAIL_WEBHOOK_SECRET` (16+ random characters) | Postmark account: a server, a verified sender domain, and an inbound address. Create an `email` channel with `fo_create_channel` |
| Something that calls the runner every minute | Vercel Cron (`apps/web/vercel.json`, GET with `Bearer <CRON_SECRET>`), or any scheduler with `POST /api/front-office/jobs/run` and `Bearer <FRONT_OFFICE_CRON_SECRET>` | Built in; needs `CRON_SECRET` in Vercel and a Pro team |

## One-time setup

- [ ] Create Ventra's channels with `docs/agents/sql/create_channels.sql` (Supabase SQL editor). Keep each key; it goes in Vercel and in the webhook URLs.
- [ ] Twilio number, "A message comes in": `POST https://<public origin>/api/front-office/sms/inbound?channel=<channel id>&key=<channel key>`.
- [ ] Postmark inbound webhook URL: `https://ventra:<FRONT_OFFICE_EMAIL_WEBHOOK_SECRET>@<public origin>/api/front-office/email/inbound?channel=<email channel id>&key=<channel key>`. Forward Ventra's enquiry address to the Postmark inbound address.
- [ ] After any change to the Setter's prompt or questions, run the live replay: `ANTHROPIC_API_KEY=... FRONT_OFFICE_MODEL=... node --experimental-strip-types apps/web/test/live/setter-live.ts` (from the repo, env vars in the shell, not in a file). Costs a few cents.
- [ ] Share the bookings Google Calendar with the account that made the refresh token (if they differ).

## Instagram and Messenger (tracker 2.1; code on `feature/ventra-website`)

Code is built: webhook, signature check, 24-hour reply window, approval queue at `/tools/front-office-outbox`. To switch it on:

- [ ] Instagram: make the business account a Professional (Business) account and link it to a Facebook Page.
- [ ] developers.facebook.com: create a Business app with the "Manage messaging and content on Instagram" use case (add Messenger if you want Facebook DMs too). Add yourself as a tester.
- [ ] Put in `.env.local`: `META_APP_SECRET` (App settings > Basic), `META_VERIFY_TOKEN` (make up 20+ random characters), `META_GRAPH_VERSION` (current version shown in Meta's docs, e.g. v23.0), `INSTAGRAM_ACCESS_TOKEN` (generated in the Instagram use case), `MESSENGER_PAGE_TOKEN` (only for Messenger).
- [ ] Create the channels with `fo_create_channel(<workspace>, 'instagram', '<IG account id>', '<40-char key>')` (and 'messenger' with the Page id).
- [ ] Once VENTRA is hosted: webhook URL `https://<public origin>/api/front-office/meta/webhook?channel=<id>&key=<key>`, verify token = META_VERIFY_TOKEN, subscribe to `messages`.
- [ ] Meta App Review for the messaging permission and Business Verification (needs registered business details, likely the ABN) before anyone outside your testers can use it.
- [ ] Optional, later: `FRONT_OFFICE_META_AUTOSEND=1` lets the AI reply without approval. Leave it off for at least the first two weeks (master plan).

## Website (branch `feature/ventra-website`, pages at /site, /site/privacy, /site/terms)

- [ ] Set real prices in `apps/web/lib/site/content.ts` (`plans[].priceMonthlyAud`). Until then the site says "Founding price, confirmed on your call" and offers no checkout.
- [ ] Online checkout (Stripe Express Checkout: Apple Pay, Google Pay, Link) is not built yet: needs real prices, Stripe test keys, then your approval (`NEXT_PUBLIC_SITE_CHECKOUT=1`). Live payments need a separate approval.
- [x] Hosting: live at https://www.aiventra.com.au; app deployed; `aiventra.com.au` (redirects to www) and `www.aiventra.com.au` added in Vercel. GoDaddy DNS: A `@` -> `216.198.79.1`, CNAME `www` -> `fe83dd68d6dd39cf.vercel-dns-017.com` (owner clicks Save).
- [x] Vercel environment variables added (2026-11-07); see Production status. Pick the Pro plan before commercial use.
- [x] Google Cloud Branding links + authorised domain saved and app published to production (2026-11-07). Next: get the refresh token in OAuth Playground (see Logins and keys).
- [ ] Have the privacy policy checked. A draft Google Sites site "Ventra website" was started and is unpublished; delete it in sites.google.com if not needed.

## Sales agent (tracker 2.6 to 2.11, foundation built, not live)

Code: `apps/web/lib/front-office/sales/` (offer config, ten-objection playbook, prompt `sales/close@1`, `runSalesTurn`). It quotes only from the config and hands anything else to a person. Nothing calls it yet (the orchestrator's `AgentHooks.sales` hook is not passed by any route).

- [ ] Decide the payment provider (one, e.g. Stripe Payment Links or Square). Until then every close goes to a person to send the agreement and payment details.
- [ ] Set package prices in `lib/front-office/sales/config.ts` (and the matching site plans in `lib/site/content.ts`). With no price the agent never states one.
- [ ] Confirm the escalation threshold: deals above A$2,000 (after discount) go to a person. Draft default; change `escalateAboveAud`.
- [ ] Approve any guarantees or discounts the agent may offer (none today), and the contract/refund terms it may state (none today; it escalates).
- [ ] Review the ten objection responses in the config for Ventra's voice.
- [ ] Approve switching the Sales agent on for booked leads (wires `AgentHooks.sales` in the chat and email routes).

## Decisions and approvals

- [ ] Approve live sending to real people: set `FRONT_OFFICE_SEND_LIVE=1` (until then every message is logged, not sent). Test on your own phone first.
- [ ] Check the Setter's questions and wording for Ventra in `apps/web/lib/front-office/setter/config.ts` (drafted by Claude from the master plan; assumed a 30-minute strategy call by phone, Mon to Fri 9 am to 5 pm Perth).
- [ ] AU Spam Act: confirm leads texting the number counts as consent for replies, and that past-lead reactivation (1.11) has consent before it is switched on.
- [ ] Email provider: Claude assumed Postmark (only `lib/front-office/email.ts` changes if you prefer another).
- [ ] Master plan decisions still open: payment provider (Phase 2), Sales escalation threshold, first three target clients, organic channels to start.
- [ ] Approve a Git remote if you want the branch pushed.
