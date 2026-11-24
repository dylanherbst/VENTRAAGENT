# VENTRA content pipeline (M-4)

Status: **FOR OWNER APPROVAL.** This page describes how content is made. Nothing in it publishes, schedules or sends
anything. Every piece of content stops at the review gate until the owner (Dylan) approves it, and scheduling or
publishing is done by the owner, or only after the owner approves it.

Related: `marketing/BRIEF.md` (goal, audience, topics), `marketing/brand.md` (look and words),
`marketing/CALENDAR.md` (what goes out on which day), `marketing/SCHEDULING.md` (how Instagram and Meta Business Suite
schedule), `marketing/profile/PROFILE.md` (profile setup).

## Who is who

| Role | Who | Can do | Never does |
| --- | --- | --- | --- |
| Marketing agent | `ventra-marketing` | Research, ideas, scripts, captions, renders, README files, calendar updates | Publish, schedule, DM, buy ads or tools, change the Instagram account |
| Coordinator | Master Coordinator (Chief of Staff) | Delegates tasks, confirms which product screens/labs are real and working, checks file sizes, commits `marketing/**`, records "needs approval" on the board | Approves on the owner's behalf |
| Owner | Dylan | Approves or rejects content, provides links and contact details, applies the profile, schedules or publishes, reads Insights | - |

## Status values (used in every `README.md` and in `CALENDAR.md`)

`not started` → `in production` → `review` (waiting for the owner) → `approved` → `scheduled` → `published`.
Side states: `changes requested` (back to production), `blocked` (missing link, footage or decision; reason written down).
Only the owner moves a piece to `approved`, `scheduled` or `published`.

## Folders

- Repository (committed through the coordinator): `marketing/` — brief, brand kit, templates, render scripts, this
  pipeline, the calendar and per-post/per-reel source files (`marketing/posts/**`, `marketing/reels/**` when M-2 and
  M-3 run).
- Deliverables (not committed): `~/Developer/VENTRA-MARKETING/` — `posts/NN-slug/`, `reels/NN-slug/`,
  `stories/weekNN/`, `profile/`, `samples/`. Every post or reel folder has a `README.md` listing its files and status.

## Stages

### 1. Research

- Owner: `ventra-marketing` (on a coordinator task).
- Input: `marketing/BRIEF.md`; board states of the product tasks (A-3, A-4) from the coordinator; owner feedback;
  Instagram Insights notes from stage 7 (when they exist).
- Output: a short research note inside the task's folder (for example `marketing/posts/NN-slug/research.md`), listing
  any industry statistic with its source URL and the date it was checked. No statistic without a checkable source.
- Gate: none (internal). Anything that would need a claim about the product is checked with the coordinator first.

### 2. Ideas

- Owner: `ventra-marketing` proposes; the coordinator picks what enters the calendar.
- Input: research notes, BRIEF.md topics (first nine posts, first three Reels), the five leaks (slow reply, missed
  call, no follow-up, no booking link, after-hours silence).
- Output: a calendar slot in `marketing/CALENDAR.md` with topic, format, asset link and status `not started`.
- Gate: the owner approves the calendar as a whole (this file set). New topics added later are flagged "new" in the
  calendar so the owner sees them at review.

### 3. Script

- Owner: `ventra-marketing`.
- Input: the calendar slot, `marketing/brand.md` (one idea per slide, outcome language, Australian English).
- Output:
  - Feed post: `marketing/posts/NN-slug/post.json` (slide text for `render.mjs --spec`) and `caption.md` (hook, body,
    one CTA, 5-10 hashtags, alt text per slide).
  - Reel: `marketing/reels/NN-slug/script.md` (scene by scene: on-screen text, caption text, timing, source of each
    shot: "real lab footage" or "concept demonstration") and `reel.json` for `reel.mjs --spec`, plus `caption.md`.
  - Story: `marketing/stories/weekNN/stories.json` and a short `notes.md` (which stickers to add by hand, if any).
- Gate: truth check before production. The coordinator confirms any product screen or behaviour that is shown as real.
  Anything not confirmed is labelled **Concept demonstration** on the frame.

### 4. Production

- Owner: `ventra-marketing`.
- Input: the script files; templates in `marketing/templates/`; for real footage only the labs/screens the coordinator
  confirms are running (today: Receptionist Test Lab `/tools/receptionist-lab`, which runs simulated calls; the Setter
  Test Lab is not built yet).
- Output: rendered files in `~/Developer/VENTRA-MARKETING/`:
  - feed: `posts/NN-slug/slide-01.png …` (1080x1350), plus 1080x1080 where asked;
  - Reels: `reels/NN-slug/reel.mp4` (H.264, 1080x1920, 24-30 fps, under 60 s, captions burned in, CTA end card) and
    `cover.png`;
  - Stories: `stories/weekNN/story-NN.png` (1080x1920).
- Checks before leaving production: `node marketing/render.mjs --check` passes; every render log line says `OK` and
  `Outfit+Hanken Grotesk loaded` (no `FALLBACK`); sizes measured; reels probed with `node marketing/reel.mjs --probe`.
- Gate: none (internal), but nothing moves on if a check fails.

### 5. Review — **approval gate**

- Owner: the owner (Dylan) approves; the coordinator records the request.
- Input: each folder's `README.md` with status `review`, the files list, sizes, and which frames are real footage vs
  concept demonstration; any open question (link, contact detail, logo).
- Output: the owner's decision written into the README (`approved` or `changes requested` with notes) and on the board
  ("needs approval" → done).
- Gate: **nothing is scheduled or published without the owner's approval.** Approval happens with the owner directly
  (Command Center for system actions). A Telegram notification is a heads-up, not an approval; no agent message counts
  as approval.

### 6. Scheduling

- Owner: the owner (Dylan), by hand in the Instagram app or Meta Business Suite (see `marketing/SCHEDULING.md`).
  Agents prepare, they never schedule.
- Input: approved files, `caption.md` (caption, hashtags, alt text), the day number from `CALENDAR.md`.
- Output: the owner sets the README status to `scheduled` (with date and time) or `published`; the calendar row is
  updated on the next marketing task.
- Gate: scheduling and publishing are themselves owner actions. Stories with interactive stickers (poll, question,
  link) are posted live by the owner because scheduled Stories may not keep them.

### 7. Performance review

- Owner: the owner reads Instagram Insights (the professional dashboard); `ventra-marketing` writes the summary when the
  owner shares the numbers.
- Input: the numbers the owner exports or copies from Insights (reach, saves, shares, profile visits, link taps, follows,
  Reel plays and watch time). Agents have no Instagram access, so they never fetch or estimate these.
- Output: `marketing/performance/week-NN.md` (created on the first review): the numbers exactly as provided, what to
  keep, what to change, ideas for the next calendar. Fed back into stage 1.
- Gate: none for the note; any change of direction (new topics, paid tools, ads) goes back to the owner.
- Cadence: weekly, starting at the end of week 2 (a single week is too little to judge).

## Things that always need the owner

Publishing, scheduling, replying to or sending DMs, comments made as the brand, ads or boosted posts, paid tools or
apps, link-in-bio services, changing the profile, using real customer names, voices or data.

## Things the pipeline never does

Automated DMs, cold outreach, engagement bait ("comment YES"), invented testimonials, customers, follower numbers,
revenue or performance results, claims about features that do not work today.
