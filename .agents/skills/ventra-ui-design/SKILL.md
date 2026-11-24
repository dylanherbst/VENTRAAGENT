---
name: ventra-ui-design
description: Run the VENTRA UI design workflow (reference, component audit, responsive build, visual comparison, QA, preview, owner approval). Use when the owner supplies a design reference or asks for UI changes.
user-invocable: true
---

# UI design workflow

Chief of Staff runs this; `ventra-frontend` is the only writer. Details: `docs/agents/WORKFLOWS.md`.

1. **Reference.** Get the owner's reference image or approved screen. Do not invent a new direction. Direction is the approved subtle frosted-glass VENTRA look (V5 teal glass).
2. **Audit.** `ventra-frontend` lists existing components and tokens that already cover the reference (read only), and what is genuinely missing.
3. **Build.** Implement desktop and mobile (375px) layouts reusing components. No business-logic or database edits.
4. **Compare.** Open the page and compare with the reference side by side. Note differences honestly.
5. **QA.** `ventra-qa` runs lint, typecheck, tests, build and the relevant `apps/web/test/*-browser.mjs`.
6. **Preview.** Give the owner the local URL and a screenshot where tools allow.
7. **Approval.** Stop for owner approval before any further screens.
