# VENTRA — URGENT LAUNCH DEVELOPMENT: AI Setter + AI Receptionist + Live Test Playground

Owner brief, 2026-11-10 (Perth). Priority **P0**. Delivered to the Master Coordinator through `docs/agents/OWNER_NOTES.md`.
The coordinator's reconciliation with existing work (what already exists, what this changes) is in that note; where
this brief and `COORDINATOR.md` differ, the OWNER_NOTES entry dated 2026-11-10 says which wins.

To: Coordinator, Backend Engineer (ventra-backend), Research (ventra-research), Feature (ventra-feature), Voice
(ventra-voice), Frontend (ventra-frontend, limited — see note), QA (ventra-qa).

## Objective

1. **AI Setter** — connects to business social accounts, responds to enquiries, qualifies leads, follows up
   appropriately and books appointments.
2. **AI Receptionist** — answers incoming calls, handles questions, gathers customer information, prepares quotes
   and manages bookings.

Both get an interactive Test Playground where the owner personally tests intelligence, functionality, integrations
and workflows. Implementation, not another planning document. Audit and extend what exists; do not start over;
keep existing task ids. Website & Store (Workstream D) continues in its own queue; A tasks go first.

## Research (time-boxed, never blocks build work) → `docs/agents/FRONT_OFFICE_RESEARCH.md`

Setter: Meta Instagram Messaging API, Messenger Platform, webhooks + OAuth, permitted automated replies,
comment-triggered private replies, 24-hour window / message tags / approved follow-ups; Anthropic Claude API (in use)
vs OpenAI Responses API; agent frameworks; Supabase storage; Google Calendar free/busy; Cal.com; CRM integrations;
job queues. No cold-DM automation, scraping, impersonation or bypassing platform limits.

Receptionist: Vapi (already integrated), Twilio Programmable Voice, ConversationRelay, Media Streams, LiveKit Agents +
SIP, OpenAI Realtime, ElevenLabs Conversational AI, Deepgram, STT/TTS alternatives, Australian numbers, transfer and
escalation, transcripts/summaries, realtime tool calling, Australian privacy, call-recording consent and telco rules.
Compare at least two voice architectures (speech-to-speech realtime vs telephony + independently controlled
STT→LLM→TTS pipeline).

Output sections: best architecture per product; recommended service per capability; reusable open source;
integration complexity; setup + operating cost in AUD; latency/reliability; keys/accounts/approvals needed; risks and
platform limits; build vs buy; concrete implementation instructions for the backend.

## Shared backend

Reuse Supabase auth, workspaces, CRM, booking, API contracts. Common services: business profiles, leads/customers,
conversation history, contact + consent preferences, appointments, knowledge base, agent configuration, human
takeover, AI action/execution logs, provider integrations, notifications, event-driven workflows. One customer record
across both products (a lead qualified on Instagram is recognised when they phone, once identity is verified and
authorised). Strict tenancy. All state-changing actions go through validated backend tools, never the model's text.

## AI Setter — launch behaviour

Connect authorised accounts; receive permitted inbound via official webhooks; understand intent; answer from business
info; ask qualification questions; decide lead/not-lead; collect details (service, budget, location, timing); check
real availability; book or request approval; save lead + full conversation to CRM; approved follow-ups per platform
rules and consent; escalate; owner takeover at any time. Handles pricing, services, objections, availability,
changes, ambiguity, multiple questions, "talk to a human", silence, returning customers, different tones.
Never fabricates prices, slots, discounts, policies or confirmations.

**Industry presets:** Beauty (nails, lashes, beauty), Fitness (PTs, coaches), Trades (electricians, plumbers,
cleaners). Each: realistic knowledge base, qualification rules, booking types, example conversations.

## AI Receptionist — launch behaviour

Answer calls via supported telephony; introduce itself as the business's AI receptionist; answer from verified info;
identify service; qualify; collect details; check availability; book/reschedule/cancel per settings; capture quote
requests; transfer/escalate urgent or complex matters; save call record + permitted transcript; post-call summary;
update CRM; notify owner. Voice: natural, Australian English, interruptions/turn-taking, silence and noise, names,
clarification, escalation, recovery from connection failures. Quotes: distinguish estimate (authorised pricing) /
quote request awaiting review / confirmed quote approved by the business; never invent or approve binding prices.
No phone-number purchases, subscriptions or billable live calling without owner approval.

## Test Playground (critical)

Routes: `/tools/setter-lab`, `/tools/receptionist-lab` (both exist — extend), new `/tools/front-office-lab` overview.
Same business logic and agent pipelines as production; simulation replaces only external transport.

Setter Lab: simulated IG/FB chat, message input, streamed AI reply, preset selector, knowledge editor,
personality/settings, qualification status, lead score + extracted details, booking state, CRM record preview,
action log, human takeover, reset, save/reload scenarios. A completed booking appears in the test booking system and
CRM, with the backend actions that produced it shown.

Receptionist Lab: start/stop voice, mic permission, live voice, audio playback, live transcript, agent status, call
events, caller details, booking/quote actions, CRM updates, post-call summary, errors + latency, reset/replay. Browser
voice uses the same rules, knowledge, tools and booking pipeline as phone calls. Real-phone test mode added once
telephony credentials are approved.

Modes, always labelled with estimated API usage visible: **Demo** (scripted scenarios, mocked integrations),
**Live AI Test** (real model calls on the real backend, external side effects sandboxed), **Connected Integration**
(official messaging/telephony, only after authorisation + passing tests). Mocked results never shown as live success.

## Shared booking + CRM engine

One engine: availability, create, confirm, reschedule, cancel, owner approval, no double booking, time zones +
business hours, persisted outcomes, follow-up actions. Workflows: Automatic / Owner approval. Idempotency, conflict
handling, audit log, retry safety. "You're booked" is not success unless the booking is persisted.

## QA

Setter scenarios: new lead, pricing, qualified, unqualified, booking, objection, wants human, interruption, returning
customer, out of hours, booking conflict, API failure. Receptionist: booking enquiry, pricing, reschedule, cancel,
quote, urgent/emergency, wants human, misheard speech, background noise, interruption, calendar down, call dropped,
failed booking. Each records inputs, outputs, tool calls, expected vs actual DB state, errors, latency, model usage,
estimated cost, pass/fail. Regression suite; privacy, prompt injection, unauthorised tool calls, cross-tenant access.

## Launch acceptance

Setter: authenticated social connection, real permitted inbound, intelligent qualification, persistent CRM, verified
booking, human takeover, approved follow-up workflow, recovery from API failure.
Receptionist: browser voice demo, real inbound test call, natural multi-turn, accurate info, verified booking, call
summary, CRM persistence, human escalation, reliable telephony.
Both: secure multi-tenancy, verified end-to-end tests, transparent API cost, owner controls, auditable tool actions,
no fake success in live mode, documented deployment + recovery.

## Order

Wave 1: research + playground foundations (Setter real-AI text first; Receptionist browser voice scaffold; first
QA scenarios). Wave 2: tool calling, shared CRM/bookings, knowledge config, real browser voice, official social
webhooks, owner approvals, histories. Wave 3: connected Meta testing, real inbound call, calendar, handoff, E2E,
cost/perf. Wave 4: security, reliability, privacy/consent, onboarding, billing deps, pilots, launch checklist.

## Execution rules

Start from existing infrastructure; executable progress over documents; vertical slice first; research without
blocking; official APIs and maintained open source; no duplicate infrastructure; one-writer worktree policy;
VENTRA-CLEAN protected; keep existing task ids; automatic local changes, tests and safe commits; never payments or
production deploys; respect spending limits; customer-facing features disabled until verified; escalate missing
credentials but keep building; report only verifiable results with files, tests and preview links.

## Success milestones

1. Open the Setter Lab, type a realistic customer message, get a genuine AI reply, watch the lead qualify, create a
   test booking, verify it in CRM.
2. Open the Receptionist Lab, speak into the mic, hear the AI answer naturally, request an appointment, confirm a
   real test booking and call record were created.

## Required report after the first cycle

Reused code; agents assigned; research findings + recommended APIs; what was implemented; which tests are
interactive; playground URLs; backend routes + data contracts; commits; blockers; keys/approvals needed; next tasks.
