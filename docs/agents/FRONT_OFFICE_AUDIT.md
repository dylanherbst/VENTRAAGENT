# AI Front Office audit (A-0), 2026-11-10

Written by the Master Coordinator (cycle c-255a1537) from a read-only `ventra-research` report. It is a code reading, not a
test run: no test below was executed for this audit (see `~/.ventra-dashboard/last-verify.json` for the last real run).
Standard: `docs/agents/COORDINATOR.md` > CURRENT PRIORITY.

Status key: KEEP = works and is tested · REPAIR = exists but wrong or unsafe · FINISH = partly built · BUILD = absent ·
BLOCKED = needs an owner action. `FO` = `apps/web/lib/front-office`, `API` = `apps/web/app/api/front-office`,
`T` = `apps/web/test/front-office-*.test.ts`.

## Headline findings

1. **Operating modes are not wired into any live path.** `decide()`/`gate()` are called only from `setter/lab.ts` and
   `/tools/front-office-outbox`. The orchestrator, `setter/agent.ts`, `receptionist/agent.ts`, `booking.ts`, every
   `/api/front-office` route and `vapi-route.ts` act directly. `setter_mode`/`receptionist_mode` are stored but unread.
   A-8 (Setter) and A-7 (Receptionist) cover the agents; the API routes need A-17.
2. **One business per deployment.** Chat, SMS, email, Meta and Google Calendar read a single set of env variables. Only
   Vapi routes per business (`/voice/vapi/[channel]/`). "Per business" is not met yet (A-15).
3. **Two customer records and two approval queues** (see Duplicates).

## 1. AI Setter

| Step | Channel | Code / route / table | Test | Status | Gap | Task |
|---|---|---|---|---|---|---|
| Message arrives | Web chat | `API/chat/route.ts` → `FO/orchestrator.ts handleInbound` → `fo_ingest` | T chat, chat-audit | KEEP | Single business (env channel id/key); replies only with `FRONT_OFFICE_CHAT_LIVE=1` | A-15 |
| Message arrives | Instagram/Messenger | `API/meta/webhook/route.ts`, `FO/meta.ts` (signature, challenge, 24h window) | T meta | FINISH | Sandbox only; Meta app review not done; channel key in URL query | A-11, A-5 |
| Message arrives | WhatsApp | none | none | BUILD | No webhook, parser or sender | A-11 |
| Message arrives | SMS | `API/sms/inbound/route.ts`, `FO/twilio.ts`, `fo_ingest_sms` | T db, chat | KEEP | Confirm `FRONT_OFFICE_ALLOW_UNSIGNED` is off outside tests | A-5 |
| Message arrives | Email | `API/email/inbound/route.ts`, `FO/email.ts` (Postmark) | T email | KEEP | One mailbox per deployment | A-15 |
| Opt-out / opt-in | All | `FO/opt-out.ts` in `handleInbound` | T db, contracts | KEEP | STOP/START only; Meta/WhatsApp rules not encoded | A-8, A-11 |
| Agent ownership | All | `FO/router.ts`, `FO/state.ts`, `fo_set_state` | T modes, sales | KEEP | — | — |
| AI qualification | All | `FO/setter/agent.ts runSetterTurn`, `setter/prompt.ts`, `fo_save_details` | T setter, setter-lab | KEEP | — | — |
| Business knowledge | All | `FO/settings.ts` (`offer`, `idealCustomer`, `notAFit`, `faqs[]`, `hours`) | T channel-setup, db | FINISH | No structured services, pricing, policies | A-16 |
| Objection handling | All | hard-coded in `setter/prompt.ts` | T setter | FINISH | No per-business rules | A-16 |
| Customer record | All | `fo_ingest*`, `fo_save_details`, `fo_contacts` unique on phone/email | T db | KEEP | Chat/IG contacts without phone/email are never merged later | A-9 |
| Mode check before acting | All | `FO/permissions.ts decide()`, `pending-actions.ts gate()`, `fo_pending_actions` | T modes, modes-db, setter-lab | REPAIR | Lab only; live enquiry-only business still books | A-8, A-17 |
| Offer times / booking | Chat, SMS, Meta | `booking.ts offerTimes/bookSlot`, `calendar/google.ts`, `fo_appointments` | T setter, calendar, audit-booking-e2e | FINISH | One Google account from env; no per-business OAuth | A-12 |
| Confirmation | SMS, email | `booking.ts confirmationText`, `sms-send.ts`, `email.ts` | T calendar, e2e | FINISH | `book_time` uses a stub sender (`sent:false`) but tells the model it was sent | A-8 |
| Logged result | All | `fo_messages`, `fo_events`, `fo_log_outbound` | T db | KEEP | — | — |
| Follow-ups | SMS, email | `FO/jobs.ts`, `fo_jobs`, `API/jobs/run` | T jobs-run | FINISH | No quiet hours, consent evidence or mode check; Meta >24h not allowed | A-8 |
| Human transfer | All | `escalate_human`, `FO/handoff.ts`, `fo_handoffs` | T setter, contracts | FINISH | No owner notification for chat/Meta; confirm a handed-off contact stops the AI | A-8 |
| CRM history | UI | `API/summary`, `FO/summary.ts` | T summary | FINISH | Counts only; no contacts/activity endpoint | A-9 |
| Lead→booking performance | UI | none | none | BUILD | No per-channel conversion | A-10 |
| Owner approval queue | Social DMs | `fo_outbox`, `/tools/front-office-outbox`, `API/outbox` | T meta | REPAIR | Two queues (`fo_outbox` and `fo_pending_actions`) | A-18 |
| Test lab | — | `/tools/setter-lab`, `FO/setter/lab.ts` | T setter-lab | KEEP | Proves mode logic, not live routes | A-3 |

## 2. AI Receptionist

| Step | Channel | Code / route / table | Test | Status | Gap | Task |
|---|---|---|---|---|---|---|
| Call arrives | Vapi | `API/voice/vapi/**` incl. `[channel]/`, `FO/vapi-route.ts`, `FO/vapi.ts`, `fo_calls`, `fo_voice_*` | T receptionist-vapi, receptionist-db | FINISH | Needs `FRONT_OFFICE_VOICE_LIVE=1`; never tested with a real call | A-13 |
| Real number + test call | Phone | Vapi dashboard | none | BLOCKED | Owner Vapi account, number, test window | A-13 |
| Not-live behaviour | Phone | `vapi-route.ts` not-live branch | T receptionist-vapi | KEEP | — | — |
| Disclosure / greeting / recording notice | Phone | `receptionist/prompt.ts`, settings | T receptionist | KEEP | — | — |
| Answers from approved info | Phone | `answer_faq`, `matchFaqs` (word overlap) | T receptionist | FINISH | FAQ only; no services/pricing | A-16 |
| Caller details + reason | Phone | `qualify`, `fo_voice_contact`, `fo_save_details` | T receptionist-db | KEEP | — | — |
| Quote requests | Phone | none | none | BUILD | Not tagged or stored | A-19 |
| Calendar check | Phone | `check_availability`, `calendar/google.ts` | T calendar | FINISH | Single account | A-12 |
| Book / reschedule / cancel | Phone | `receptionist/agent.ts`, `booking.ts`, `fo_appointments` | T receptionist, receptionist-db, receptionist-lab | REPAIR | No `decide()`/`gate()`; identity is caller number only | A-7, A-20 |
| Three modes | Phone | `receptionist/simulate.ts`, receptionist-lab | T receptionist-lab, modes | REPAIR | Simulated only | A-7 |
| Human transfer | Phone | `transfer` (falls back to `take_message`) | T receptionist | FINISH | Code and contract disagree on transfer per mode | A-14 (owner decision) |
| Urgent / uncertain | Phone | prompt rules; urgent `take_message` emails staff | T receptionist | KEEP | No SMS alert; no "ring 000" wording (owner decision, see HANDOFF) | — |
| CRM / calendar / activity | Phone | `fo_voice_outcome`, `fo_record_handoff`, `fo_events`, reminders | T receptionist-db | KEEP | — | A-9 |
| Test lab | Sim | `/tools/receptionist-lab` | T receptionist-lab | KEEP | Simulation only | A-4 |

## 3. Duplicate or disconnected data

| Item | Problem | Keep |
|---|---|---|
| `fo_contacts` vs browser-only `apps/web/lib/local-crm-contacts.ts` (+ pipeline, lead scoring, reports, `app/ui/crm-*`) | AI leads never reach the CRM screens; two `Contact` types | `fo_contacts` (A-9); local-crm only as a migration source |
| `fo_outbox` vs `fo_pending_actions` | Two approval inboxes | `fo_pending_actions` (A-18) |
| `fo_agent_settings` per workspace vs global channel/calendar env | One business per deployment | Per-workspace connection rows, secrets stay in env/vault (A-15) |
| `fo_appointments` vs Google Calendar vs `launcher_drafts_booking_page` | Three booking notions | `fo_appointments` = record, Google = availability (A-12) |
| `setterOn`/`receptionistOn`/`voiceOn` vs `setter_mode`/`receptionist_mode` | Overlap, different defaults | "On" = master switch, mode = behaviour; document in API_CONTRACTS.md |
| `faqs`+`offer`, `sales/config.ts`, `templates/*` | Three knowledge places | One knowledge object in settings (A-16) |

## 4. External dependencies (env names only; no values read)

| Dependency | Env / code | Owner action needed |
|---|---|---|
| Anthropic model | `ANTHROPIC_API_KEY` (`llm.ts`) | Paid key, spending cap |
| Supabase | all | Hosted project + production migrations |
| Meta (IG/Messenger) | `META_APP_SECRET`, `META_VERIFY_TOKEN`, `META_GRAPH_VERSION`, `META_AUTOSEND` | Developer app, business verification, app review, page/IG linking |
| WhatsApp Cloud API | not built | Business account, number, template approval |
| Vapi | `FRONT_OFFICE_VOICE_LIVE`, `FRONT_OFFICE_VOICE_CHANNEL_*` | Account, number, test window (A-13) |
| Google Calendar | `GOOGLE_CALENDAR_CLIENT_ID/_SECRET/_REFRESH_TOKEN/_ID` | OAuth app + consent screen verification |
| Twilio | `TWILIO_ACCOUNT_SID/_AUTH_TOKEN/_FROM_NUMBER`, `FRONT_OFFICE_SEND_LIVE` | Account, AU number, sender registration |
| Postmark | `POSTMARK_SERVER_TOKEN`, `FRONT_OFFICE_EMAIL_WEBHOOK_SECRET` | Server, DKIM/SPF, inbound domain |
| Cron | `FRONT_OFFICE_CRON_SECRET` | Scheduler + deploy |
| Public origin | `FRONT_OFFICE_PUBLIC_ORIGIN` | Deployed HTTPS URL for webhooks |

Platform messaging rules are checked against official docs in A-5 (`docs/agents/CONNECTIONS.md`).

## 5. New board tasks created from this audit

A-15 per-business connection records · A-16 business knowledge base · A-17 mode check in every live route ·
A-18 merge `fo_outbox` into `fo_pending_actions` · A-19 Receptionist quote capture · A-20 caller identity check before
reschedule/cancel · A-21 modes and approval-queue API routes.

## 6. Not verified by this audit

No tests were run. Quiet hours, "handoff stops the AI" and the SMS unsigned bypass were inferred from names and greps.
The A-14 contradiction comes from the board task text. Platform rules come from general knowledge until A-5 cites them.
