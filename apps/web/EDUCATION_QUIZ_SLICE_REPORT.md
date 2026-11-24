# Education lesson quiz slice — follow-up report

**Date:** 2026-10-17

## Scope

Evidence-driven fixes only: lint, failing tests, replace-import quiz-loss preflight in creator workflow. No new product features.

## Changes

| Area | Fix |
|------|-----|
| Lint | Removed unused `map` index in `education-lesson-quiz-editor.tsx`. |
| `local-education-course.test.ts` | Learner lesson allowlist includes optional `quiz`; assertions prove `quizDraft`, grading fields, and author notes never appear in learner projection. |
| `local-education-lesson-quiz.test.ts` | Replace-import test revises saved outline before second apply so `lastApplyCommandKey` idempotency does not short-circuit; added `quizBearingLessonsDroppedOnReplaceImport` test. |
| `local-education-lesson-quiz.ts` | `quizBearingLessonsDroppedOnReplaceImport` for preflight detection (same ID rules as merge preservation). |
| `education-creator-workflow.tsx` | Replace import: preflight lists quiz-bearing lessons that would be dropped; user must confirm via in-page actions (no `alert`). Append unchanged. Course restore still scoped by `profileId`. |

## Coordinator checks

| Check | Result |
|-------|--------|
| `npm run typecheck` | Not run (shell unavailable in agent session). |
| Isolated build | Not run (shell unavailable). |
| `npm run lint` | Not run (shell unavailable). |
| `npm run test` | Not run (shell unavailable). |

**Expected after local run:** 103 tests (one new detection test), all pass; lint clean on quiz editor.

## Review finding addressed

Replace import can drop creator-authored quizzes when lesson IDs leave the outline. UI now blocks silent discard: count + lesson titles, explicit confirm before `importOutlineToCourseStorage('replace')`. CAS/stale guards and quiz preservation for matching IDs unchanged.

## Out of scope

- `docs/PLATFORM_CHECKLIST.md`, `docs/PRODUCTION_READINESS_TRACKER.md`
- Backend, production deploy, external services
