# Front Office research: AI Setter and AI Receptionist

Task A-22, cycle c-90917b1a, 2026-11-11 (Perth). Research by `ventra-research` (read-only); written to file by the
coordinator. No code changed. Conversion used: **1 USD = 1.43 AUD** (early November 2026; exact rate unverified —
re-check before quoting a customer). "Unverified" = not confirmed against an official page in this session.

## Short answer

1. **Receptionist at launch: keep Vapi.** Our custom-LLM route (`lib/front-office/vapi-route.ts`) already works on
   Vercel. Browser voice in two steps: step 1 Web Speech API in the Lab; step 2 Vapi Web SDK pointed at the same stored
   assistant, so browser and phone share one pipeline.
2. **Setter: stay on Claude + official Meta webhooks.** The gaps are mostly process (Meta app review, Business
   Verification) plus a hard guard on the 24-hour window — our follow-up ladder currently runs past it (risk 1).
3. **Real phone calls need an Australian number.** Vapi does not supply AU numbers; route is a Twilio AU number
   (regulatory bundle) imported into Vapi. Owner approval + documents needed.
4. **Do not rebuild the voice pipeline now.** Twilio ConversationRelay or LiveKit need an always-on WebSocket/worker
   host (not Vercel). Keep as a later cost/latency escape hatch; `llm.ts` and `receptionist/agent.ts` are
   transport-independent, so switching later is cheap.

## 1. Best architecture per product

**AI Setter (Instagram, Messenger, website chat):** Meta webhook → `meta.ts` (signature check) → inbox row
(idempotent on message id) → `setter/agent.ts` (Claude + validated tools) → `meta.ts` send → CRM/booking tables.
Every state change goes through a validated tool (`setter/actions.ts`, `pending-actions.ts` `gate()`); model text
never changes state. Acknowledge the webhook with 200 quickly, then process via Next `after()` (check
`apps/web/node_modules/next/dist/docs/` first) or the `fo_jobs` queue. Rejected: agent frameworks (LangGraph, OpenAI
Agents SDK) — they duplicate our tenancy/consent/mode/audit layer and weaken the "no tool call without gate()" proof.

**AI Receptionist (phone + browser):** (a) Vapi + our custom LLM.

| | (a) Vapi + custom LLM | (b) Twilio ConversationRelay / Media Streams + own STT/TTS | (c) OpenAI Realtime / LiveKit Agents + SIP |
|---|---|---|---|
| USD price | Hosting $0.05/min + STT ~$0.010 + TTS ~$0.015–0.024 + telephony ~$0.008–0.01; Claude on top | ConversationRelay $0.07/min + voice ~$0.01/min + Claude; DIY: voice ~$0.01 + Deepgram + ElevenLabs | Realtime audio $32 in / $64 out per 1M tokens; LiveKit session $0.01/min + SIP $0.003–0.004/min (example $0.048/min, US numbers) |
| AUD / min | **~0.14–0.17** | ConversationRelay ~0.13–0.16; DIY ~0.09–0.11 | Realtime ~0.15–0.35 (estimate); LiveKit ~0.09–0.14 + ~AUD 72/month plan |
| AU number | Import Twilio AU number or SIP trunk | Twilio AU, same bundle rules | Twilio SIP trunk to LiveKit |
| Latency | Medium (Vapi hop + endpoint + Supabase RPC + first token) | Lower if WS host near Sydney | Lowest for speech-to-speech |
| Tool calling | Server-side in our endpoint; transfer/end-call already coded | Fully ours | Realtime function calls must hit our backend over HTTP |
| Vercel compatible | **Yes** (HTTP SSE) | **No** (needs Fly/Railway/Cloud Run) | **No** (worker on LiveKit Cloud/VM) |

Rejected for launch: (c) — a speech-to-speech model replaces Claude, so prompts, tools, `gate()` approvals and quote
rules would need re-proving, and cost is harder to cap. The OpenAI `gpt-realtime` page lists that model as
deprecated (check the successor).

Sources: https://vapi.ai/pricing · https://www.twilio.com/en-us/voice/pricing/au ·
https://twilio.com/en-us/products/conversational-ai/pricing (via search results) ·
https://developers.openai.com/api/docs/models/gpt-realtime · https://livekit.com/pricing ·
https://elevenlabs.io/pricing/api. OpenAI per-minute figure is an estimate from token prices (unverified).

## 2. Recommended service per capability

| Capability | Recommendation | Why |
|---|---|---|
| LLM (text + voice) | Anthropic Claude (`llm.ts`); a small fast model for voice | Tool use + streaming already work; model id in `FRONT_OFFICE_MODEL` |
| LLM alternative | OpenAI Responses API: no switch | Re-validation of every prompt/tool for no gain; `llm.ts` is the seam |
| Cost/latency | Anthropic prompt caching on system prompt + tools | `system` is a plain string today (details unverified) |
| Voice orchestration | Vapi (phone + Web SDK) | Section 1 |
| STT / TTS | Deepgram / ElevenLabs Flash via Vapi | Vapi price page; en-AU voice quality is an owner check |
| Telephony | Twilio AU number imported into Vapi | Some community reports of import failures (unverified): https://support.vapi.ai/t/18774287/unable-to-import-twilio-number |
| SMS | Twilio (`twilio.ts`, `sms-send.ts`) | Existing |
| Social | Meta official webhooks + Graph Send API (`meta.ts`) | Only permitted route |
| Calendar | Google `freeBusy` + `events.insert` (`calendar/google.ts`) behind our booking engine | Existing; our DB is source of truth |
| Jobs | `fo_jobs` + scheduled runner endpoint | Existing |
| CRM integrations | None at launch | One CRM (ours) |

## 3. Reusable open source (licences unverified — confirm before adding)

- LiveKit Agents (Apache-2.0) / Pipecat (BSD): only if we move to (b)/(c) self-hosted pipelines.
- `@vapi-ai/web` (MIT): browser client for step 2; needs the Vapi public key + assistant id.
- Vercel AI SDK (Apache-2.0): optional for streaming lab replies; our SSE already exists.
- Cal.com (AGPL core): not needed; optional import later. Chatwoot (MIT): human-takeover UI reference only.
- pg-boss / Graphile Worker: need a persistent worker; do not fit Vercel.

## 4. Integration complexity

| Piece | Complexity | Notes |
|---|---|---|
| Browser voice step 1 (Web Speech API) | Low | Free; Chrome/Safari; Chrome sends audio to Google (privacy notice item); fine for owner testing |
| Browser voice step 2 (Vapi Web SDK) | Low–medium | Public-key web calls cannot override `model.url` (403): use a stored assistant with our endpoint. https://docs.vapi.ai/customization/custom-llm/using-your-server |
| AU number + Vapi import | Medium | Bundle approval time unknown |
| Meta Instagram/Messenger live | **High (process)** | Business Verification, app review, screencasts, privacy + data-deletion URLs |
| Comment-triggered private replies | Medium | Extra permission + webhook subscription |
| WhatsApp Cloud API | Medium–high | Templates, verification; not for launch |
| Google Calendar OAuth per business | Medium | Sensitive scopes may need Google verification (unverified) |
| Own STT→Claude→TTS pipeline (b) | High | VAD, barge-in, WS host |

## 5. Setup and operating cost (AUD)

Assumptions: 1.43 AUD/USD; Claude ~USD 0.01–0.03 per voice minute (unverified); 3-minute average call.

| Receptionist per minute | USD | AUD |
|---|---|---|
| Vapi hosting | 0.050 | 0.07 |
| STT (Deepgram) | 0.010 | 0.014 |
| TTS (ElevenLabs) | ~0.020 | ~0.03 |
| Twilio AU local inbound | 0.010 | 0.014 |
| Claude (our endpoint) | ~0.01–0.03 | ~0.014–0.043 |
| **Total (a)** | ~0.10–0.12 | **~0.14–0.17** |

100 min/month ≈ AUD 15–17; 1,000 min/month ≈ AUD 140–170; one 3-minute call ≈ AUD 0.45–0.50.

Fixed/setup (Twilio and Vapi pages disagree internally — **unverified until the owner sees console prices**):
Twilio AU local number USD 3.00/month (~AUD 4.30), toll-free USD 8.25 (~AUD 11.80), mobile USD 20 (~AUD 28.60).
Outbound for transfer legs: landline USD 0.0252/min, mobile USD 0.075/min. Vapi: pay-as-you-go includes 4 concurrent
calls; Core USD 29/month and extra lines USD 10/line/month mentioned (which applies: unverified). WS host for (b)
~AUD 10–40/month (unverified). LiveKit Ship USD 50/month (~AUD 72). Per-minute Vercel Cron needs Pro.

Setter: Meta replies inside the window carry no per-message fee (unverified for all cases); a 6-turn qualification
chat ≈ AUD 0.02–0.08 of Claude (unverified, model/caching dependent). Lab "Live AI Test" shows token counts × a
configurable price table (A-23).

## 6. Latency and reliability

- Voice target: first audio within ~1.5 s of the caller finishing; measure in the Lab (vendor claims unverified).
- `vapi-route.ts` awaits `fo_voice_turn` (Supabase RPC) before the first token — run it in parallel or bound it.
- `anthropicStream` has a 20 s timeout and 400 max tokens; for voice use ~8 s and 150–250 tokens. Keep the fixed
  greeting (no model wait). Consider a warm-up ping at call start (cold starts unverified).
- Failure: the route already apologises and ends cleanly; add "transfer to owner if configured" when Claude is down.
- Vendors in path: Vapi, Deepgram, ElevenLabs, Anthropic, Twilio — list status pages in the runbook.
- Meta retries webhooks; inbox must be idempotent on message id; boosted posts can duplicate comment notifications.

## 7. Keys, accounts and approvals the owner must provide

Nothing here was requested or used.

| Item | For | Owner action |
|---|---|---|
| Anthropic key + `FRONT_OFFICE_MODEL` | Live AI Test | Present in `.env.local` per owner note; confirm monthly spend cap |
| Vapi account + public key + assistant per business | Browser step 2, phone | Create account, choose plan, approve spend |
| Twilio account + AU regulatory bundle | Number, SMS | Business registry extract, officer names, AU street address (no PO box). https://www.twilio.com/en-us/guidelines/au/regulatory |
| **Phone number purchase** | Real inbound test call | **Explicit approval** |
| Meta app + Business Verification | IG/Messenger live | App review for `instagram_manage_messages`, `pages_messaging`, `instagram_manage_comments` |
| Meta test accounts | Wave 3 testing | Standard Access reaches only app-role holders — enough for owner testing. https://developers.facebook.com/docs/messenger-platform/instagram/features/send-message |
| Google OAuth client + consent screen | Calendar | Owner creates; verification may follow |
| Privacy policy, terms, data-deletion URLs | Meta review, APP 1 | Owner/lawyer |
| Legal review of recording wording | Receptionist go-live | Owner approves |
| Vercel Pro cron or Supabase `pg_cron` | Follow-up jobs | Owner approves any spend |

## 8. Risks and platform limits

1. **Follow-up ladder vs Meta's 24-hour window (highest impact).** `jobs.ts` `ladderGaps` = 5 min, 55 min, 23 h,
   2 d, 4 d, then monthly (cumulative 5 min, 1 h, 24 h, 3 d, 7 d). Bots may reply only within 24 h of the person's
   last message; `HUMAN_AGENT` (7 days) is for real people only, never automation. Step 3 lands on the edge; steps
   4+ are outside. `meta.ts` has `REPLY_WINDOW_MS` / `inReplyWindow()` but no call to it was found in the job send
   path (**unverified whether gate() or the runner calls it** — coordinator follow-up task). Fix: runner checks
   `inReplyWindow` for IG/Messenger; outside it reroute to consented SMS/email or create an owner task; move step 3
   to 20–22 h. **Coordinator check (c-90917b1a):** today the runner's follow-ups go only by SMS or email
   (`jobs.ts:233`), and both Meta send paths already check the window (`api/front-office/meta/webhook/route.ts:60`,
   `api/front-office/outbox/route.ts:44`), so this is not a live bug; it becomes one the moment follow-ups are added
   on Meta channels — the guard must ship with that change. Sources: https://developers.facebook.com/docs/messenger-platform/instagram/features/private-replies/ ·
   https://www.chatwoot.com/hc/user-guide/articles/1745225158-what-is-human-agent-tag-in-instagram-messenger-channel
2. **Message tags.** Possibly narrowed to `HUMAN_AGENT` only (unverified). Do not design around other tags;
   appointment reminders on IG/Messenger are window-limited — use SMS/email with consent.
   `messaging_type: 'RESPONSE'` in `meta.ts` is correct inside the window.
3. **Comment private replies:** one message per comment, within 7 days (IG Live: during broadcast only); needs
   `instagram_manage_comments`, `pages_messaging`, Advanced Access; owner opts in per post/keyword; no mass DMs.
4. **App review / access levels:** Advanced Access needs review + Business Verification + working demo; plan as a
   calendar dependency.
5. **WhatsApp (not researched this session):** 24 h service window, templates outside it, opt-in required. Wave 4.
6. **Call recording (not legal advice — lawyer to approve wording).** WA Surveillance Devices Act 1998 s5 prohibits
   recording a private conversation without consent of the principal parties even as a party (limited exceptions);
   s9 restricts sharing. Other states differ (unverified). Federal Telecommunications (Interception and Access) Act
   1979 s7: knowledge/consent matters; reach for a business recording its own AI-answered calls unverified. Sources:
   https://www.armstronglegal.com.au/criminal-law/wa/offences/perjury-and-public-order/record-phone-calls/ ·
   https://www.lavan.com.au/advice/cyber-and-data-protection/evidence_recording_private_communications_and_activities ·
   https://legislation.wa.gov.au. Product rules: greeting says AI receptionist + recording; offer "say 'no
   recording'"; store consent evidence (greeting version + time); default transcript + summary, no audio retention;
   never share recordings.
7. **Australian Privacy Principles (general knowledge; check https://www.oaic.gov.au):** APP 1, 3, 5, 6, 8 (offshore
   processors: Anthropic, Vapi, Deepgram, ElevenLabs, Twilio), 11, 12. Don't rely on the small-business exemption.
   Add per-workspace retention + delete-contact cascade. Spam Act 2003 for SMS/email (`opt-out.ts`).
8. **Quotes:** keep the three states (estimate / request pending review / confirmed by business); no binding price
   without owner approval via `gate()`.
9. **Other limits:** Vapi 4 concurrent calls on PAYG; Vercel Hobby cron is daily, Pro per minute
   (https://vercel.com/docs/cron-jobs/usage-and-pricing); use Twilio's Sydney edge; +61 caller ids not allocated by
   ACMA are blocked (https://www.twilio.com/en-us/guidelines/au/voice). No cold DMs, scraping, impersonation or tag
   misuse anywhere.

## 9. Build vs buy

| Capability | Decision |
|---|---|
| Voice transport, STT, TTS | Buy (Vapi now); revisit (b) only if spend/latency justify a host |
| LLM | Buy (Anthropic) |
| Tools, consent, modes, approvals, audit, tenancy | Build (done — the product's value) |
| Booking engine | Build (one engine); mirror to Google Calendar |
| Availability | Google `freeBusy` (coded); Cal.com rejected as core (second booking system) |
| Job queue | Keep `fo_jobs` + scheduled runner; Vercel Workflow/Queues later if retries/fan-out grow |
| Social inbox + takeover UI | Build (small) |
| Third-party CRM sync, WhatsApp | Defer |

## 10. Concrete implementation instructions for the backend

Paths relative to `apps/web`. Verify names with `ls` first.

**Setter**
1. **Window guard (correctness bug, first).** In `lib/front-office/jobs.ts` / `pending-actions.ts` `gate()`, for
   instagram/messenger contacts call `inReplyWindow(lastInbound, now)` before any automated send; outside the window
   reroute to consented SMS/email or create an owner task; never `HUMAN_AGENT` from automation; third ladder gap 23 h
   → 20 h; tests at 23/24/25 h.
2. **Idempotent inbox:** dedupe Meta events on message/comment id; 200 fast, process with `after()` or `fo_jobs`.
3. **Live AI Test for the Setter Lab** (A-23/A-23b): same `setter/agent.ts`, sandboxed side effects, tokens + AUD
   cost per turn from a configurable price table.
4. **Prompt caching in `llm.ts`:** allow `system` as blocks with `cache_control`; cache knowledge base + tools.
5. **Private replies:** `sendPrivateReply(commentId, text)` in `meta.ts`, one per comment, 7 days, owner opt-in per
   keyword, through `gate()`.
6. **Instagram login mode:** `meta.ts` sends via `graph.instagram.com`; confirm Instagram Login vs Facebook Login
   (permissions and review differ).
7. **Scheduler:** protected runner route every minute — Vercel Cron (Pro, owner approval) or Supabase `pg_cron` +
   `pg_net` with the shared secret (unverified).

**Receptionist**
8. **Browser voice step 1 (A-26):** `app/tools/receptionist-lab` client uses `SpeechRecognition` (en-AU) +
   `speechSynthesis`, posting each turn to a route such as `app/api/front-office/voice/browser/turn/route.ts` that
   calls the existing Receptionist turn in `lib/front-office/receptionist/agent.ts` — no duplicated prompt/tools;
   label Demo / Live AI Test; call record `source: 'browser-test'`; sandbox SMS/email/calendar writes; latency per turn.
9. **Step 2 (provider swap, needs owner key):** `lib/front-office/voice/transport.ts` interface
   (start/stop/onTranscript/onAudio) with Web Speech and Vapi Web SDK implementations; stored assistant id per
   business; public key only in the browser; confirm `parseVapiChat` tolerates a missing caller number for web calls.
10. **Latency in `vapi-route.ts`:** don't block the first token on `fo_voice_turn` where possible; lower max tokens
    and stream timeout for voice.
11. **Recording consent:** extend `receptionist/prompt.ts` `greeting()` with the decline line, bump
    `RECEPTIONIST_GREETING_VERSION`, add a `decline_recording` tool + call-record flag; retention setting and
    delete-contact cascade (new migration, owner reviews).
12. **Transfer:** configure the Vapi assistant transfer tool; fallback transfer destination when Claude errors.
13. **Real phone test (owner approval):** Twilio AU number + bundle, import into Vapi, keep `FRONT_OFFICE_VOICE_LIVE`
    off until the owner flips it.
14. **Escape hatch:** keep `receptionist/agent.ts` free of Vapi types; one test runs a full turn through a fake
    transport.

**QA (A-28):** window-boundary follow-ups, duplicate webhooks, comment reply twice, decline-recording call, Claude
timeout (apology + message), cross-tenant channel-key misuse; latency and estimated cost per scenario.

Suggested order: 1 → 2 → 3 → 8 → 4 → 10 → 11 → 7 → 9 → 12 → 5 → 6 → 13 (13 needs approval).

## Unknowns

Exact Twilio AU prices and bundle approval time; which Vapi plan applies and whether hosting fees change with a
custom LLM; OpenAI Realtime successor pricing; Claude per-token price for the configured model; state recording laws
beyond WA, TIA Act reach, APP details; Meta's current tag list, review turnaround, IG rate limits, WhatsApp templates;
whether `gate()`/the runner already calls `inReplyWindow`; Vapi transfer with our tool shape and web calls without a
caller number; Vercel Queues quotas, Next `after()` in this Next version, function timeouts; AUD/USD on quote day.
