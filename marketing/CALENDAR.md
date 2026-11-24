# VENTRA 30-day Instagram calendar (M-4)

Status: **FOR OWNER APPROVAL.** Nothing here is scheduled or published. **Day 1 = the day the owner approves this
calendar** (and the profile from `marketing/profile/PROFILE.md` is applied). Day numbers only; the owner turns them into
dates when scheduling (`marketing/SCHEDULING.md`). How each piece is made and approved: `marketing/PIPELINE.md`.

Cadence per week (from `marketing/BRIEF.md`): **3 feed posts, 2 Reels, 4 Stories** (inside the 3-5 range). Days 29-30
are a short tail: 1 feed post and 1 Story.

Totals for 30 days: 13 feed posts (the nine M-2 posts + 4 new), 8 Reels (the three M-3 Reels + 5 new), 17 Stories.

## Key

- **Asset**: an existing file, or "to produce: M-2 #N" (first nine posts), "to produce: M-3 #N" (first three Reels),
  or "to produce: new" (not yet a board task; the coordinator creates one if the owner approves the slot).
- **Status**: `ready` (file exists and passed checks) / `in production` / `not started`. Checked 2026-11-10 against
  `~/Developer/VENTRA-MARKETING/`: only the profile picture and five highlight covers exist; no post, Reel or Story
  has been rendered yet (M-2 and M-3 are queued).
- **Footage**: `graphic` (designed slides, no product screens), `concept demonstration` (shows how the product would
  work; label on every such frame), `real lab footage` (only from a lab the coordinator confirms is running at capture
  time). Today the only committed lab is the **Receptionist Test Lab** `/tools/receptionist-lab` (simulated calls
  through the real Receptionist pipeline; nothing is sent). Real footage from it is labelled
  "Test lab · simulated call". The **Setter Test Lab is not built yet**, so every Setter frame is a concept
  demonstration until it exists and is confirmed.
- Story templates: `marketing/templates/story.html` (1080x1920). Stories with stickers (poll, question, link) are
  posted live by the owner, not scheduled.

## Before Day 1 (owner, from PROFILE.md)

| Item | Asset | Status |
| --- | --- | --- |
| Profile picture | `~/Developer/VENTRA-MARKETING/profile/profile-picture.png` | ready (awaiting approval) |
| Highlight covers x5 | `~/Developer/VENTRA-MARKETING/profile/highlight-01..05-*.png` | ready (awaiting approval) |
| Bio, name, category, links | `marketing/profile/PROFILE.md` | awaiting owner; waitlist URL missing |

Any slot whose CTA says "join the waitlist" needs the waitlist URL. Until the owner provides it, CTAs read
"Follow for the launch" instead.

## Week 1 — Days 1-7: what VENTRA is and why leads leak

| Day | Format | Topic | Asset | Status | Footage |
| --- | --- | --- | --- | --- | --- |
| 1 | Feed carousel | Introducing VENTRA: your AI front office, built in Australia, launching soon (BRIEF post 1) | to produce: M-2 #1 | not started | graphic |
| 1 | Story | Welcome / Start Here: what VENTRA is in one line; saved to the "Start Here" highlight | to produce: new (story.html); cover `highlight-01-start-here.png` ready | not started | graphic |
| 2 | Reel | "The call that didn't get answered": missed call at 5:02 pm (BRIEF Reel 1) | to produce: M-3 #1 | not started | concept demonstration |
| 3 | Feed carousel | Why businesses lose leads: the five leaks (BRIEF post 2) | to produce: M-2 #2 | not started | graphic |
| 3 | Story | Share of the five-leaks post + question sticker "Which leak costs you most?" (posted live by owner) | to produce: new | not started | graphic |
| 5 | Feed carousel | Meet the AI Receptionist: answers, understands, books, transfers; the three modes (BRIEF post 3) | to produce: M-2 #3 | not started | concept demonstration (real lab screenshots only if confirmed) |
| 5 | Story | AI Receptionist in three frames; saved to the "AI Receptionist" highlight | to produce: new; cover `highlight-03-ai-receptionist.png` ready | not started | concept demonstration |
| 6 | Reel | "Building VENTRA": the problem, the Build Plan, the labs, honest progress (BRIEF Reel 3) | to produce: M-3 #3 | not started | real lab footage (Receptionist lab, if confirmed) + graphic; anything else concept demonstration |
| 7 | Story | Behind the build: one honest "what we worked on this week" frame; saved to "Updates" | to produce: new; cover `highlight-05-updates.png` ready | not started | real lab footage if confirmed, else graphic |

## Week 2 — Days 8-14: the Setter and the cost of slow replies

| Day | Format | Topic | Asset | Status | Footage |
| --- | --- | --- | --- | --- | --- |
| 8 | Feed carousel | Meet the AI Setter: replies in minutes, asks the right questions, offers times, books, hands over (BRIEF post 4) | to produce: M-2 #4 | not started | concept demonstration |
| 8 | Story | AI Setter in three frames; saved to the "AI Setter" highlight | to produce: new; cover `highlight-02-ai-setter.png` ready | not started | concept demonstration |
| 9 | Reel | "From enquiry to booked in one conversation" (BRIEF Reel 2) | to produce: M-3 #2 | not started | concept demonstration (Setter lab not built) |
| 10 | Feed carousel | The cost of missed enquiries: a worked example with the reader's own numbers, no invented stats (BRIEF post 5) | to produce: M-2 #5 | not started | graphic |
| 11 | Story | "Work out your own number": the calculator framing from post 5 in one frame | to produce: new | not started | graphic |
| 12 | Feed carousel | How AI books appointments: enquiry → questions → availability → booking → reminder (BRIEF post 6) | to produce: M-2 #6 | not started | concept demonstration |
| 12 | Story | The booking journey in four frames (from post 6) | to produce: new | not started | concept demonstration |
| 13 | Reel | Receptionist Test Lab walkthrough: a simulated call answered, understood and booked, screen recorded | to produce: new | not started | real lab footage, labelled "Test lab · simulated call" (only if the coordinator confirms the lab runs; otherwise this slot swaps with the Day 16 Reel) |
| 14 | Story | Repost of the Day 13 Reel to Stories; saved to "Demos" | to produce: new; cover `highlight-04-demos.png` ready | not started | same as Day 13 |

## Week 3 — Days 15-21: proof of work and the bigger picture

| Day | Format | Topic | Asset | Status | Footage |
| --- | --- | --- | --- | --- | --- |
| 15 | Feed carousel | Behind the scenes: real screenshots of the test labs and dashboard, "in development" labelling (BRIEF post 7) | to produce: M-2 #7 | not started | real lab footage (screenshots) only if confirmed; anything else concept demonstration |
| 15 | Story | One behind-the-scenes screen from post 7 with "in development" label; saved to "Updates" | to produce: new | not started | same as Day 15 post |
| 16 | Reel | Five leaks in 30 seconds: motion version of post 2 | to produce: new (reuses M-2 #2 copy) | not started | graphic |
| 17 | Feed carousel | How VENTRA helps businesses grow: audit → fix the leaks → more booked work → time back (BRIEF post 8) | to produce: M-2 #8 | not started | graphic |
| 17 | Story | Share of post 8 + poll sticker "Do you answer calls after 5 pm? Yes / Not always" (posted live by owner) | to produce: new | not started | graphic |
| 19 | Feed carousel | Join the waitlist / request a demo: single CTA, what happens next (BRIEF post 9) | to produce: M-2 #9 | not started | graphic. Blocked until the waitlist URL exists; if still missing on Day 19, swap with the Day 22 post |
| 19 | Story | Waitlist link sticker (posted live by owner); saved to "Start Here" | to produce: new | not started | graphic. Needs waitlist URL |
| 20 | Reel | What happens after "book": the booking journey from post 6 in motion | to produce: new (reuses M-2 #6 copy) | not started | concept demonstration |
| 21 | Story | Behind the build, week 3 update; saved to "Updates" | to produce: new | not started | real lab footage if confirmed, else graphic |

## Week 4 — Days 22-28: practical help for owners

| Day | Format | Topic | Asset | Status | Footage |
| --- | --- | --- | --- | --- | --- |
| 22 | Feed carousel | After-hours silence: what happens to the enquiry that arrives at 9 pm (deep dive on leak 5) | to produce: new | not started | graphic |
| 22 | Story | "9:00 pm, new enquiry. Who replies?" one-frame teaser for post 22 | to produce: new | not started | graphic |
| 23 | Reel | Two common owner questions: "Will callers know?" and "Can it hand the call to me?" answered only with what the Receptionist lab does today | to produce: new | not started | real lab footage if confirmed; every answer checked against A-4 before production, else concept demonstration |
| 24 | Feed carousel | What a good first reply looks like: fast, answers the question, asks one thing, offers a time (saveable checklist) | to produce: new | not started | graphic |
| 24 | Story | One-frame version of the first-reply checklist | to produce: new | not started | graphic |
| 26 | Feed carousel | The five-minute front-office check: five yes/no questions an owner can ask about their own business (leak checklist, saveable) | to produce: new | not started | graphic |
| 26 | Story | Question sticker "What would you want an AI front office to handle first?" (owner reads replies; no automated DMs) | to produce: new | not started | graphic |
| 27 | Reel | Month one: what we built: honest progress from the build | to produce: new | not started | real lab footage if confirmed; anything else concept demonstration |
| 28 | Story | Repost of the Day 27 Reel; saved to "Updates" | to produce: new | not started | same as Day 27 |

## Days 29-30 — short tail

| Day | Format | Topic | Asset | Status | Footage |
| --- | --- | --- | --- | --- | --- |
| 29 | Feed carousel | Month-one build update in slides: what works in the labs today, what is next, launch status (no numbers unless real and provided by the owner) | to produce: new | not started | real lab screenshots if confirmed, else concept demonstration |
| 30 | Story | "What's next" teaser for month two + reminder of the Start Here highlight | to produce: new | not started | graphic |

## Count check

| Week | Feed posts | Reels | Stories |
| --- | --- | --- | --- |
| 1 (Days 1-7) | 3 (Days 1, 3, 5) | 2 (Days 2, 6) | 4 (Days 1, 3, 5, 7) |
| 2 (Days 8-14) | 3 (Days 8, 10, 12) | 2 (Days 9, 13) | 4 (Days 8, 11, 12, 14) |
| 3 (Days 15-21) | 3 (Days 15, 17, 19) | 2 (Days 16, 20) | 4 (Days 15, 17, 19, 21) |
| 4 (Days 22-28) | 3 (Days 22, 24, 26) | 2 (Days 23, 27) | 4 (Days 22, 24, 26, 28) |
| Days 29-30 | 1 (Day 29) | 0 | 1 (Day 30) |
| **Total** | **13** | **8** | **17** |

Every full week has 4 planned Stories, leaving room for one extra live Story by the owner (still within 3-5).

## Open items for the owner

- Approve the calendar (sets Day 1). The 4 new feed posts and 5 new Reels need board tasks after approval.
- Waitlist URL (Days 19 and every "join the waitlist" CTA) and website URL.
- Confirmation from the coordinator, at capture time, that the Receptionist Test Lab runs, before any "real lab
  footage" slot (Days 6, 7, 13, 14, 15, 21, 23, 27, 29) uses it. Until then those slots fall back to the concept or
  graphic version.
- Founder footage for "Building VENTRA" (Day 6): the owner decides whether to appear on camera or voice; without it the
  Reel is screens and text only.
