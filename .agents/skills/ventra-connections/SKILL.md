---
name: ventra-connections
description: Run the VENTRA connections workflow (requirements, owner approval, backend wiring, connection test, QA, connected status). Use when an integration, account or external service is needed or needs checking.
user-invocable: true
---

# Connections workflow

1. **Requirements.** `ventra-setup` lists what is needed, required vs optional, and what the owner must do (accounts, permissions, costs). It writes beginner-simple steps.
2. **Owner approval.** Stop. The owner creates accounts, approves permissions and any spending. Never create accounts, buy, or publish for them. Secrets go in local env files only, never in chat, Git or docs.
3. **Wire it.** `ventra-backend` implements the integration using environment variables (names only in code).
4. **Connection test.** `ventra-setup` runs a harmless real check and records the command and result in `docs/agents/STATUS.md`.
5. **QA.** `ventra-qa` verifies behavior and that no secret is exposed.
6. **Status.** Use only: Not required, Owner action needed, Ready to configure, Configured, Functionally verified. "Connected" means Functionally verified.
