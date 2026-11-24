# Store team (from the SkillTree reference, 15 Nov 2026)

Source: `SkillTree_Ecommerce_AI_Agents_Breakdown` (video reference, 93 agents, 7 departments). The video's numbers are illustrative; its approval rules are unspecified, so ours are set here.

## Rules we adopted
- Reading and drafting run automatically. Anything a buyer sees (`send`) or that moves money or ad spend (`money`) waits for the owner. No automatic refunds.
- One workflow = one definition: trigger, data, rules, action, output, failure. Catalogue: `apps/web/lib/aimp/storeops/catalog.ts` (17 definitions; `built` / `next` / `later`).
- Digital shops (our default) skip physical-only workflows (stock, reorders, exchanges). "Order tracker" reports delivery status and a resend option instead of parcel tracking.
- Every run leaves one Ops-log line the owner can open on a phone.
- Per-business knowledge (catalogue, policies, suppliers, photos, brand voice) is loaded per run; nothing is shared across businesses.

## Built now (fixtures, no emails sent)
Order status -> verified lookup (sender email must match; wrong reference never reveals another order) -> reply draft (delivered / on its way / payment pending / refunded / hand-off / ask for details) -> Ops-log entry "waiting for you". Code: `lib/aimp/storeops/order-status.ts`, tests `test/aimp-storeops.test.ts`. Inbox tab shows the team map honestly (ready / next / later).

## Next
1. Feed real orders and fulfilment state into `lookupOrder` and show the draft + approve button in the Inbox (approval via `lib/aimp/automation`, new area `support`).
2. Resend download through the existing owner-orders action after approval.
3. Review asker (timer from delivery) and cart follow-up (re-check before send).
4. Home: "Yesterday" metrics, "Waits for you", Ops log.

## AI workflow runner (added 15 Nov 2026)
Every AI workflow (order status, receptionist, review replies, later Setter) goes through one runner, `lib/aimp/storeops/agent.ts`:
- A spec cannot be registered above `draft`. Sending, refunds and spend are owner-run code, never a model.
- The model sees only verified facts plus the buyer's text wrapped as untrusted data, and has no tools that change anything.
- Its answer must parse to the expected shape and pass the spec's guard (own links only, no promises). Otherwise: standard reply or hand-off to the owner, with the reason recorded.
- Provider seam `AgentModel`: tests use a fake; with no `ANTHROPIC_API_KEY` the shop runs on templates. First spec: `receptionist.ts`. To add a workflow: define the spec, add its catalogue entry, add tests with a fake model.

## Claude Small Business plugin: feature map (16 Nov 2026)
All 44 plugin skills and commands are mapped in `lib/aimp/storeops/plugin.ts` (bucket, summary, carrying workflow, highest action, phase, connector categories, no-connector fallback). The plugin's concierge is reproduced as a deterministic router, `router.ts` (ordered by urgency, one best match, honest about availability).
- **launch** (first release): Monday brief, business pulse, inbox manager, content engine, design creator, Marketing Monday, content strategy, growth pulse, be-found/SEO, outreach composer, speed to lead, order questions, reviews, set-up interview, brand style, concierge.
- **later** (documented): lead finder/triage, call list, grow pipeline, CRM autopilot, win-back, ad manager, proposals, grants, invoice chase, cash snapshot, reports, contract review, build-agent, build-connector.
- **outside_brief** (catalogued, switched off): payroll, hiring, inventory/restock, supplier bills, bookkeeping/month-end, tax. The rework brief keeps these out of the default journey; the owner can lift that later.
What is NOT done: no plugin code runs in the app. Each launch feature still needs its spec on the runner (`agent.ts`) plus real data and the Anthropic key.

## Inbox approve flow (built 16 Nov 2026)
`/app/<business>/inbox`: add a buyer message (test form), get a drafted reply, edit it, then "Approve and send" or "I will handle it". Order questions are answered from the shop's real order and delivery state, only when the sender's email matches. Other enquiries go through the receptionist (standard hand-off reply until an AI key is connected). Approving twice sends once; one shop never sees another's messages; replies go to the fixture outbox. Code: `lib/aimp/storeops/inbox.ts`, `app/start/_server/inbox-runtime.ts`, `app/app/[business]/inbox/*`. Tests: `aimp-storeops-inbox`, plus a real-services test in `aimp-start-runtime-orders`.
Not yet: threads are in memory (lost on restart); real buyer messages do not arrive automatically; "resend download" is still done from Orders.
