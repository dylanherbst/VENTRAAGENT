# Agent architecture

```
Owner -> pages (Home, Sales, Social, Marketing, Profile, Settings)
        -> server actions (owner's business only)
          -> Growth Manager (lib/aimp/growth/manager.ts)   reads everything, decides the next safe step
          -> AI Team orchestrator (lib/aimp/agents/team.ts)  Social + Marketing runs: limits, retries, cost, audit, approvals
          -> AI Sales pipeline (lib/aimp/setter/pipeline.ts)  DMs: eligibility, policy gate, drafts or sends, CRM
        shared: BusinessProfile (one per business) -> copied into AI Sales config (lib/aimp/growth/knowledge.ts)
        providers: Claude / OpenAI text, OpenAI images, Creatomate, Zernio, Instagram (each mock until keyed, labelled)
```

## Agents

- **AI Sales:** inbound DMs only (no scraping, no cold messaging). It qualifies, answers from the profile, handles objections, and sends the booking or buy link.
  - Handoffs: complaints, "real person" requests and low confidence go to the owner.
  - It never claims to be human.
  - It only says it is automated when asked, as the owner chose.
- **Social Media:** the backend lays out a slot grid (cadence, platforms, pillars), and the model writes each slot.
  - The validator enforces platform limits, banned claims and repetition.
  - Approval is bound to the exact revision and account.
- **Marketing:** writes 5 distinct angles with claim evidence status (verified only when backed by the owner's facts).
  - Also covers image and video briefs, competitor research and the 100-ad playbook.
  - Paid ads are off.
- **Growth Manager:** pure and deterministic.
  - Order of priorities: profile gaps, handoffs, AI Sales drafts, post approvals, unscheduled approved posts, retries, plan the week, write ads, pick an angle, connect accounts.
  - It runs only safe steps (drafts) when the owner presses "Do it now". It never publishes, sends or spends.
  - Duplicate work is prevented: it does not plan a week when posts are already planned for the next 3 days, and it does not write ads while a run is active.

## Structured handoff

- The Marketing campaign is handed to the Social plan as JSON (approach, hook, CTA).
- Tasks are `AgentRun` records: kind, status, attempts, usage, cost, error.

## Safety enforced in code

- Workspace scoping on every read and write.
- A tool allowlist per agent.
- External actions need approval plus server flags.
- Spend and run limits.
- One provider schedule per revision.
- Webhooks are signature-checked and deduplicated.
