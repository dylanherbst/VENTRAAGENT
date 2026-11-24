# Front-office connections inventory

- **Checked:** 2026-11-10 on this Mac, branch `agent/develop`, HEAD `b63570e`.
- **Task:** A-5 (coordinator cycle c-255a1537), Connections agent.
- **Scope:** Names of environment variables only. No `.env*` file was opened and no value was read or printed. No external service was called. No account was created and no external setting was changed.
- **Status values:** Not started, Code present (not configured), Configured (unverified), Verified.
- **Owner-side settings** (Vercel, Supabase, Twilio, Postmark, Meta, Google, Vapi, Anthropic) are taken from `docs/agents/OWNER_TODO.md`, "Production status" (2026-11-07). I did not check those dashboards, so anything marked "per owner note" is unverified.

## Summary

| Connection | Required or optional | Status | Evidence (this session) | Owner action needed |
| --- | --- | --- | --- | --- |
| Model provider (Anthropic, used by the Setter and Receptionist) | Required for AI replies | Configured (unverified) | Code reads `ANTHROPIC_API_KEY`, `FRONT_OFFICE_MODEL`. Owner note says both are in Vercel. Scripted Setter tests 11/11 pass; live replay not run. Owner note: Claude Console balance A$0, so the AI cannot answer. | Add funds; re-save the key as Secret; set a spend limit if the console offers one |
| Website chat (`/api/front-office/chat`) | Optional (first channel to test) | Code present (not configured) | Chat tests 2/2 pass. Channel not created yet (`create_channels.sql` not run per owner to-do). | Run `create_channels.sql`; copy chat channel id and key into Vercel as Secret; redeploy; test |
| Meta: Instagram and Messenger DMs (`/api/front-office/meta/webhook`) | Optional | Code present (not configured) | Meta tests 5/5 pass (signature check, parsing, 24-hour window, webhook route). No `META_*` or Instagram variable is in the owner's Vercel list. | Meta developer app, Instagram account set-up, Meta App Review and Business Verification before outsiders can use it |
| WhatsApp Business | Optional | Not started | No WhatsApp code in `apps/web/lib` or `apps/web/app/api`. Only the name `whatsapp` in the connection-target list in `lib/front-office/contracts.ts` (planned as A-11). | Owner decision whether to build it; nothing to create yet |
| Vapi (AI Receptionist phone line, `/api/front-office/voice/vapi/...`) | Optional (needed for phone calls) | Code present (not configured) | Vapi tests 9/9 pass (scripted, fixture data; not a live Vapi call). Owner note: Vapi account not created; `FRONT_OFFICE_VOICE_*` not set; `FRONT_OFFICE_VOICE_LIVE` off. | Create Vapi account; create voice channel; set up assistant and tools; test call |
| Google Calendar OAuth (booking) | Required for booking; optional otherwise | Code present (not configured) | Calendar tests 9/9 pass (token refresh, free/busy, insert, retries). No consent or callback route in the app; the refresh token is made outside the app. Owner note: refresh token not yet made. | Make the refresh token in OAuth Playground; set the four Google variables in Vercel; share the bookings calendar |
| Twilio SMS (`/api/front-office/sms/inbound`) | Optional | Code present (not configured) | SMS tests 7/7 pass (signature round trip, forged-request refusal, opt-out, orchestrator). Owner note: SID and auth token in Vercel. `TWILIO_FROM_NUMBER`, the number and the SMS channel are missing. | Buy an AU mobile number (needs ID); set `TWILIO_FROM_NUMBER`; create SMS channel; set the Twilio webhook |
| Postmark email (`/api/front-office/email/inbound`) | Optional | Code present (not configured) | Email tests 3/3 pass (parsing, auth, webhook refusal, opt-out). Owner note: `POSTMARK_SERVER_TOKEN` in Vercel. `FRONT_OFFICE_EMAIL_FROM`, `FRONT_OFFICE_EMAIL_WEBHOOK_SECRET` and the email channel are missing. | Verify the sender domain in Postmark; set the two variables; set the inbound webhook; create email channel |

Tests in this table are unit and integration-style tests on fixture data. None of them calls a live provider, so no connection is "Verified" yet.

## Shared variables (not tied to one channel)

- `FRONT_OFFICE_SEND_LIVE` = `1` allows real SMS and email sends. Unset means every message is logged, not sent.
- `FRONT_OFFICE_CRON_SECRET` and `CRON_SECRET` (same value, 32+ characters) protect the job runner `POST /api/front-office/jobs/run`. Vercel Cron calls it every minute (`apps/web/vercel.json`). The schedule needs a Vercel Pro team.
- `FRONT_OFFICE_PUBLIC_ORIGIN` is the public address the Twilio signature check uses. Set it when a proxy sits in front of the app.
- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are required by every route that stores data. Supabase was not checked in this task.
- `LAUNCHPAD_APP_ORIGIN` is used by several routes (chat, outbox, settings, summary). Its value is not checked here.

## Per-channel details

### 1. Model provider (Anthropic)

- Code: `apps/web/lib/front-office/llm.ts` reads `ANTHROPIC_API_KEY` and `FRONT_OFFICE_MODEL`. With either missing, the AI does not answer.
- Routes: none of its own. Used by the chat, SMS, email, Meta and voice routes.
- Verified by: `apps/web/test/front-office-setter.test.ts` (scripted model, 11 of 11 pass). The anthropic client test checks that the key and model are required and that errors contain no key.
- Live check (not run): `apps/web/test/live/setter-live.ts`. It calls the real model and costs money, so it is not part of the test suite. Owner must approve and fund it first.
- Owner steps:
  1. Open https://console.anthropic.com and sign in.
  2. Click **Billing** and check the balance. You should see A$0 until you add funds.
  3. Add funds (the amount is your decision). You should see the balance go up.
  4. In the console, look for a **spend limit** or usage limit setting. If one exists, set a monthly limit. You should see it saved.
  5. Open https://vercel.com, open the project `ventra`, then **Settings** > **Environment Variables**.
  6. Find `ANTHROPIC_API_KEY`. Use **Rotate** (or edit) and set the type to **Secret**. You should see it marked as Secret.
  7. Do not paste the key into any chat.

### 2. Website chat

- Code: `apps/web/app/api/front-office/chat/route.ts` (POST and GET).
- Variables: `FRONT_OFFICE_CHAT_CHANNEL_ID`, `FRONT_OFFICE_CHAT_CHANNEL_KEY`, `FRONT_OFFICE_CHAT_LIVE` (AI answers only when `1`), `FRONT_OFFICE_CHAT_ORIGINS` (only if the widget sits on another site). The route also reads `FRONT_OFFICE_DEMO_CHANNEL_ID`, `FRONT_OFFICE_DEMO_CHANNEL_KEY`, `FRONT_OFFICE_DEMO_LIVE` for the demo test page only.
- Verified by: `apps/web/test/front-office-chat.test.ts` (2 of 2). Checks: not connected, foreign origins and bad input are refused; a message is recorded but not answered until chat is turned live; opt-out is confirmed; history works.
- Owner steps:
  1. Open the Supabase project "Ventra AI" and then the **SQL Editor**.
  2. Open the file `docs/agents/sql/create_channels.sql` on your Mac, copy its contents, and paste into the editor. Edit the top section only if the file says so.
  3. Click **Run**. You should see a result table with one row per channel.
  4. Copy the `web-chat` row's id and key. Put them in Vercel as Secret variables `FRONT_OFFICE_CHAT_CHANNEL_ID` and `FRONT_OFFICE_CHAT_CHANNEL_KEY`.
  5. Redeploy: in the Mac terminal, go to `apps/web` and run `vercel --prod`. You should see a URL printed at the end.
  6. Open https://www.aiventra.com.au and send a test message in the chat. You should see that the message was recorded, and the AI should not answer yet (because `FRONT_OFFICE_CHAT_LIVE` is off).
  7. When you are happy with the test, tell the coordinator. Turning on `FRONT_OFFICE_CHAT_LIVE=1` is your decision.

### 3. Meta (Instagram and Messenger)

- Code: `apps/web/app/api/front-office/meta/webhook/route.ts`. GET is the Meta handshake (checks `META_VERIFY_TOKEN`). POST checks the `x-hub-signature-256` signature with `META_APP_SECRET`.
- Variables: `META_APP_SECRET`, `META_VERIFY_TOKEN`, `META_GRAPH_VERSION`, `INSTAGRAM_ACCESS_TOKEN`, `MESSENGER_PAGE_TOKEN`, `FRONT_OFFICE_META_AUTOSEND` (AI replies without approval when `1`; keep it off for at least two weeks).
- Verified by: `apps/web/test/front-office-meta.test.ts` (5 of 5). Checks: signatures, real DMs only (echoes and reads ignored), the 24-hour window, the Graph send request shape, and the webhook route (refuses unsigned posts).
- Owner steps:
  1. Make your Instagram account a Professional (Business) account: in the Instagram app, open **Settings** > **Account type and tools** > **Switch to professional account**. You should see "Business" selected.
  2. Link it to a Facebook Page (Instagram > Settings > Account > Linked accounts).
  3. Open https://developers.facebook.com, click **My Apps** > **Create App**, pick **Business**, and choose the Instagram messaging use case. You should see the app dashboard.
  4. In the app, add yourself as a **tester** (App roles > Roles).
  5. Put the app's secret in Vercel as Secret `META_APP_SECRET` (App settings > Basic). Do not paste it into a chat.
  6. Make up a verify token of 20+ random characters and save it as `META_VERIFY_TOKEN` in Vercel.
  7. Once the site is live, set the webhook URL in the Meta app to `https://www.aiventra.com.au/api/front-office/meta/webhook?channel=<id>&key=<key>`, with the verify token, and subscribe to `messages`. You should see the webhook marked as verified.
  8. Before anyone outside your testers can use it: Meta requires **App Review** for the messaging permission and **Business Verification** (business details, probably your ABN). Start those only when you decide to.

### 4. WhatsApp Business

- Status: not started. No code, no route, no variables.
- Owner decision first: whether WhatsApp is wanted now. It needs a Meta Business account, a phone number that is not already on WhatsApp, and business verification. Do not create any of these until you decide.
- Policy that will shape the build: see the policy notes below (opt-in, approved templates, 24-hour window).

### 5. Vapi (AI Receptionist phone line)

- Code: `apps/web/app/api/front-office/voice/vapi/chat/completions/route.ts` (custom LLM endpoint), `.../voice/vapi/webhook/route.ts` (events and tool calls), and the same two under `.../voice/vapi/[channel]/` for one channel per business.
- Variables: `FRONT_OFFICE_VOICE_CHANNEL_ID`, `FRONT_OFFICE_VOICE_CHANNEL_KEY` (also the Bearer token in Vapi), `FRONT_OFFICE_VOICE_LIVE` (answers only when `1`, otherwise a "not switched on" line and call-back message).
- Verified by: `apps/web/test/front-office-receptionist-vapi.test.ts` (9 of 9). Scripted, using fixture data. The exact Vapi request fields and the transfer and end-call shapes follow Vapi's docs and have not been checked against a live call. The HANDOFF file says to confirm on the first test call.
- Owner steps:
  1. Open https://vapi.ai and create an account. Choose pay as you go. You should see the Vapi dashboard.
  2. In the Supabase SQL editor, run `docs/agents/sql/create_channels.sql` (it also creates the `voice` channel). Copy the voice channel id and key into Vercel as Secret variables.
  3. In Vapi, go to **Integrations** > **Custom LLM** (or the assistant's credentials). Add a **Bearer token** credential. Paste the voice channel key as its value. Do not paste it into a chat.
  4. Create an assistant. Set the model provider to **Custom LLM** with the URL `https://www.aiventra.com.au/api/front-office/voice/vapi/chat/completions`. Attach the credential.
  5. Set the first message mode to **assistant speaks first with model-generated message**.
  6. Set the assistant's **Server URL** to `https://www.aiventra.com.au/api/front-office/voice/vapi/webhook` with the same credential. Turn on the end-of-call report.
  7. Add Vapi's built-in **transferCall** tool (your transfer number) and **endCall**.
  8. Phone number: for a first test, use a Vapi test number and attach the assistant. Importing a Twilio AU number comes later, once it is bought.
  9. Test with `FRONT_OFFICE_VOICE_LIVE` unset. You should hear that the assistant "isn't switched on yet", and the call should end. Your number should appear as a call-back message in the app.
  10. Decide whether calls are recorded. If yes, write the recording notice in the settings page and check that the privacy policy covers it.
  11. Only when you approve it: set `FRONT_OFFICE_VOICE_LIVE=1` in Vercel, switch on "Answer phone calls" in settings, redeploy, and call again.

### 6. Google Calendar (OAuth, booking)

- Code: `apps/web/lib/front-office/calendar/google.ts` (REST, refresh-token flow, free/busy, event insert with invite). No consent or callback route exists under `apps/web/app/api`; the refresh token is created by hand in OAuth Playground.
- Variables: `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, `GOOGLE_CALENDAR_REFRESH_TOKEN`, `GOOGLE_CALENDAR_ID`. All four are needed; a partial set is treated as off.
- Verified by: `apps/web/test/front-office-calendar.test.ts` (9 of 9). Checks: config only from a complete env, token reused, free/busy parsed, errors carry no secret, retries do not double-book.
- Owner steps:
  1. Open https://console.cloud.google.com and pick the project `ventra-front-office`. You should see its name at the top.
  2. Go to **APIs & Services** > **Library**, search "Google Calendar API", open it. You should see **Manage** (meaning it is enabled).
  3. Go to **APIs & Services** > **OAuth consent screen**. You should see the publishing status "In production" (done on 2026-11-07 per the owner note).
  4. Go to **Credentials**, open the web client "Ventra calendar booking", and copy its Client ID and Client secret into Vercel as Secret variables `GOOGLE_CALENDAR_CLIENT_ID` and `GOOGLE_CALENDAR_CLIENT_SECRET`. Do not paste them into a chat.
  5. Open https://developers.google.com/oauthplayground. Click the gear icon, tick **Use your own OAuth credentials**, and enter the same Client ID and secret.
  6. In the left list, paste these two scopes: `https://www.googleapis.com/auth/calendar.events` and `https://www.googleapis.com/auth/calendar.freebusy`. Click **Authorize APIs**.
  7. Sign in with the Google account that owns the bookings calendar. Approve the consent. You should see "Authorization code" appear.
  8. Click **Exchange authorization code for tokens**. You should see a "Refresh token" value.
  9. Copy the refresh token into Vercel as Secret `GOOGLE_CALENDAR_REFRESH_TOKEN`. Do not paste it into a chat.
  10. In Google Calendar, open the bookings calendar's **Settings** > **Integrate calendar**. Copy the **Calendar ID** into Vercel as `GOOGLE_CALENDAR_ID`.
  11. Redeploy from `apps/web` with `vercel --prod`.
  12. Known limit: a refresh token from an app in "Testing" status expires after 7 days. The app is published, so this should not apply. If bookings stop after a week, make a new refresh token.

### 7. Twilio SMS

- Code: `apps/web/app/api/front-office/sms/inbound/route.ts` (POST webhook, signature check), `apps/web/lib/front-office/sms-send.ts` (sender), `apps/web/lib/front-office/twilio.ts`.
- Variables: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` (E.164, for example `+61...`), `FRONT_OFFICE_SEND_LIVE`, `FRONT_OFFICE_PUBLIC_ORIGIN`. `FRONT_OFFICE_ALLOW_UNSIGNED` skips the signature check, but only outside production.
- Verified by: `apps/web/test/front-office.test.ts` (7 of 7) and `apps/web/test/front-office-calendar.test.ts` (the SMS live-send gate test). Checks: signature round trip, tampering detected, opt-out words halt automation, webhook refuses unsigned or forged posts.
- Owner steps:
  1. Open https://console.twilio.com and sign in. You should see the account dashboard.
  2. Go to **Phone Numbers** > **Buy a number**. Choose Australia and a mobile number. Twilio will ask for ID. This costs money, so decide first.
  3. After buying, copy the number in E.164 format (starts with `+61`) into Vercel as `TWILIO_FROM_NUMBER`.
  4. Create the SMS channel: run `create_channels.sql` after editing the number in it. Copy the `sms` channel id and key into Vercel as Secret `FRONT_OFFICE_CHANNEL_ID` and `FRONT_OFFICE_CHANNEL_KEY`.
  5. In the number's settings, under **Messaging** > **A message comes in**, set the webhook to `https://www.aiventra.com.au/api/front-office/sms/inbound?channel=<channel id>&key=<channel key>` with the method **POST**. You should see the URL saved.
  6. Keep `FRONT_OFFICE_SEND_LIVE` unset. Text the number from your own phone. You should see the message in the app and a log entry that says "logged, not sent".
  7. Only later, and only when you approve it: set `FRONT_OFFICE_SEND_LIVE=1`. Test on your own phone first.

### 8. Postmark email

- Code: `apps/web/app/api/front-office/email/inbound/route.ts` (POST, basic-auth secret), `apps/web/lib/front-office/email.ts` (Postmark sender).
- Variables: `POSTMARK_SERVER_TOKEN`, `FRONT_OFFICE_EMAIL_FROM` (a verified sender), `FRONT_OFFICE_EMAIL_WEBHOOK_SECRET` (16+ random characters), `FRONT_OFFICE_SEND_LIVE`.
- Verified by: `apps/web/test/front-office-email.test.ts` (3 of 3). Checks: parsing (only the new part of an email is read), auth, live send only when approved, webhook refuses without the secret, opt-out by subject.
- Owner steps:
  1. Open https://postmarkapp.com and sign in (or create an account). Check the plan and its price before you continue; the owner decides on spending.
  2. Create a **Server** (for example "Ventra front office"). You should see the server page with an API token section. Copy the **Server API token** into Vercel as Secret `POSTMARK_SERVER_TOKEN`. Do not paste it into a chat.
  3. Go to **Sender Signatures** or **Domains** and add the domain you send from. Postmark shows DNS records. Add them at GoDaddy (the owner clicks Save). Wait until Postmark shows "Verified".
  4. Set `FRONT_OFFICE_EMAIL_FROM` in Vercel to the verified sender address.
  5. Make up a webhook secret of 16+ random characters and save it as `FRONT_OFFICE_EMAIL_WEBHOOK_SECRET`.
  6. Create the email channel with `create_channels.sql`. Copy its id and key into Vercel as Secret.
  7. In Postmark, open the server's **Inbound** settings. Note the inbound address shown. Set the inbound webhook to `https://ventra:<FRONT_OFFICE_EMAIL_WEBHOOK_SECRET>@www.aiventra.com.au/api/front-office/email/inbound?channel=<email channel id>&key=<email channel key>`.
  8. Forward the enquiry address to the Postmark inbound address. Send yourself a test email. You should see it in the app.
  9. Keep `FRONT_OFFICE_SEND_LIVE` unset until you approve sending.

## Policy notes

Sources were read on 2026-11-10. Policies change; check the links before you rely on them.

- **Meta (Instagram and Messenger): 24-hour window.** For most user actions, you can reply for 24 hours after the person's last message. Click-to-Messenger ads can allow up to 7 days. Message tags are for approved use cases only, and using them outside those cases can restrict sending. Source: https://developers.facebook.com/docs/messenger-platform/policy/policy-overview
- **Meta: no automated cold outreach.** The code only sends a reply inside the 24-hour window (`inReplyWindow` in `apps/web/lib/front-office/meta.ts`). Outside it, the reply waits in the approval queue. Source for the window rules: the same Meta page.
- **WhatsApp Business: opt-in and templates.** A business may contact a person only after that person has given opt-in permission. The business starts a conversation only with an approved message template. Inside the 24-hour customer-service window, free-form replies are allowed; outside it, only approved templates. Source: https://business.whatsapp.com/policy . Pricing and non-template rules: https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing
- **Australian Spam Act 2003 (email and SMS).** Commercial messages need consent from the person. Each message must identify the sender and include contact details. It must have a working unsubscribe, and unsubscribe requests must be honoured within 5 working days. The unsubscribe facility must work for at least 30 days after sending and must not charge a fee. Sources: https://www.acma.gov.au/avoid-sending-spam and the ACMA fact sheet https://www.acma.gov.au/sites/default/files/2024-05/Fact%20sheet%20-%20email%20and%20SMS%20unsubscribe%20rules.pdf
- **Consent for SMS replies.** The code handles STOP-style opt-out words (`lib/front-office/opt-out.ts`, tested). Whether a text to the number counts as consent for replies is the owner's decision (already listed in OWNER_TODO). Reactivation of past leads (tracker 1.11) must not be switched on until consent is confirmed.
- **Follow-ups.** The follow-up ladder (`lib/front-office/jobs.ts`) starts only after a person replies (tested: "follow-up starts after a reply"). No cold outreach is coded. Reactivation is not built.
- **Google OAuth.** A refresh token from an app in "Testing" status expires after 7 days. Tokens also stop working if the user revokes access or the token is unused for six months. Source: https://developers.google.com/identity/protocols/oauth2#expiration

## Verification commands run (2026-11-10)

All runs used the repo's own test command form (`node --experimental-strip-types --test <file>`) on Node v26.13.0, the default on this Mac. The repo's target is Node 24. Each run finished without an error. Pass and fail counts are from the test summary.

| Command (abbreviated) | Exit | Result |
| --- | --- | --- |
| `git status --short` | 0 | Working tree has many pending foreign changes, as recorded in HANDOFF.md. Nothing committed or changed by this task. |
| `ls -R .../apps/web/app/api/front-office` | 1 | My mistake: `ls -R` was given as a path. No effect. |
| `node --version` | 0 | v26.13.0 |
| `node ... test/front-office-calendar.test.ts` | 0 | pass 9, fail 0 |
| `node ... test/front-office-meta.test.ts` | 0 | pass 5, fail 0 |
| `node ... test/front-office-receptionist-vapi.test.ts` | 0 | pass 9, fail 0 |
| `node ... test/front-office-email.test.ts` | 0 | pass 3, fail 0 |
| `node ... test/front-office.test.ts` (SMS and Twilio) | 0 | pass 7, fail 0 |
| `node ... test/front-office-chat.test.ts` | 0 | pass 2, fail 0 |
| `node ... test/front-office-setter.test.ts` (model, scripted) | 0 | pass 11, fail 0 |

Not run, on purpose: `apps/web/test/live/setter-live.ts` (calls the real model, needs a key and costs money), `npm run test:local-integration` (needs local Supabase; not in this task), any live webhook call.

Existing verify record: `~/.ventra-dashboard/last-verify.json` (read only). It is from commit `5d5d38d` on 2026-11-09, so it is older than HEAD `b63570e`. lint, typecheck, unit tests, build and workspace-integration passed. Course and launcher steps are FROZEN (scope freeze), not passed. It has no step for any front-office channel.

## Summary of blockers for the owner

1. Fund the model account, and make the key a Secret. Until then the AI cannot answer anywhere.
2. Run `create_channels.sql`, then set the chat channel values in Vercel. This unlocks the first real test (website chat).
3. Decide on the Twilio number (paid, needs ID) and on Postmark sender verification.
4. Make the Google refresh token and set the four Google variables.
5. Vapi account and assistant (no cost until you approve live calls).
6. Meta app, tester role, App Review and Business Verification (before outsiders).
7. WhatsApp: decide whether to build it.
