# Scheduling note: Instagram native scheduling and Meta Business Suite (M-4)

Status: **FOR OWNER APPROVAL.** Checked **2026-11-10**. Free, built-in Meta tools only; no paid scheduler is proposed.

**Scheduling and publishing are owner actions.** The marketing agent and the coordinator never schedule, publish, post
Stories, reply to DMs or connect tools. Each post is scheduled only after the owner has approved it
(`marketing/PIPELINE.md`, stage 5), and the coordinator records it on the board as "needs approval" until then.

## How sure we are

Meta's help pages load their text with JavaScript, so the fetch tool used on 2026-11-10 got only the page titles, not
the article text. The table below therefore marks each fact:

- **Official**: stated by a Meta / Instagram help page (from the page title or the search engine's extract of that page).
- **Reported**: stated by third-party guides only, not confirmed on a Meta page. The owner checks these in the app
  before relying on them.

## What each tool can schedule

| | Instagram app (native scheduler) | Meta Business Suite (web at business.facebook.com and the mobile app) |
| --- | --- | --- |
| Account needed | Professional account (Business or Creator). Reported: some guides say eligible public personal accounts can also schedule since 2026; the guides disagree. VENTRA will be a Business account (PROFILE.md), so either way it qualifies. | Instagram professional account connected to Meta Business Suite (PROFILE.md checklist step 10) |
| Single-image feed posts | Yes (Official) | Yes (Official: "Schedule posts and stories") |
| Carousels | Yes (Reported: several guides list photos, carousels and Reels) | Yes (Reported) |
| Reels | Yes (Official: the help article covers scheduled posts and Reels) | Yes (Reported) |
| Stories | **No** (Reported, Buffer, Nov 2026: "Instagram's built-in scheduler doesn't cover stories") | **Yes** (Official: "Schedule posts and stories on the Business Suite mobile app"; desktop "Create story" also reported) |
| How far ahead | Up to **75 days** (Official, Instagram Help Center extract) | Reported as **29 or 30 days** in the Planner by some guides (and a 20-minute minimum for Stories); other guides say 75 days. Unconfirmed. |
| Daily limit | Reported: 25 scheduled posts per day (posts, Reels and carousels combined). Unconfirmed; irrelevant at our cadence (at most 2 items a day). | Not stated in any source found |
| Not compatible with scheduling | Official (Instagram Help Center extract): product tagging, collaborative posts, cross-posting to Facebook, sponsored posts and fundraisers | Reported: interactive stickers (poll, question, quiz, music) may not carry over to scheduled Stories |
| Edit or cancel before it goes out | Yes, from the scheduled content list (Official, article title "create and manage scheduled posts and Reels") | Yes, from the Planner / calendar (Official: Business Suite calendar best-practice page) |

## Recommended way of working (for owner approval)

1. **Feed posts, carousels and Reels: Meta Business Suite on the Mac (web).** The rendered files live on the Mac in
   `~/Developer/VENTRA-MARKETING/`, so uploading from the browser avoids moving files to the phone. The Instagram app
   scheduler is the fallback (Advanced settings → Schedule) if a format is missing on the web.
2. **Stories without stickers: Meta Business Suite** (Create story → schedule).
3. **Stories with a poll, question or link sticker: posted live by the owner** in the Instagram app on the calendar day
   (Days 3, 17, 19, 26 in `CALENDAR.md`), because scheduled Stories may lose stickers.
4. **Batch weekly, no more than 14 days ahead.** That stays inside even the shortest reported limit (29 days) and keeps
   room to change course after the weekly performance review.
5. Set times in the owner's local time zone. No "best time to post" figures are assumed; after two weeks the owner's own
   Insights (Audience → most active times) decide.
6. Paste caption, hashtags and alt text from each post's `caption.md`. Check that alt text is added for every image
   (in the Instagram app it is under Advanced settings → Accessibility; whether the Business Suite composer offers it
   for every format was not confirmed, so check before scheduling and fall back to the app if it does not).
7. Do not tick "share to Facebook" on scheduled Instagram posts unless the owner decides to run a Facebook Page;
   cross-posting is listed as not compatible with Instagram's scheduled content.
8. After scheduling, the owner sets the item's README status to `scheduled` (date and time); after it goes live,
   `published`.

## Owner check before the first batch (5 minutes, in the apps)

- Business Suite: does "Schedule" appear for a Reel and for a carousel, and what is the furthest date the picker allows?
- Business Suite: can a Story be scheduled, and is alt text available in the composer?
- Instagram app: does Advanced settings → Schedule appear on a post and a Reel?
Report the answers to the coordinator so this note can be corrected from "Reported" to "Checked in app".

## Not used (need the owner's approval first)

Paid schedulers (Buffer, Later, Hootsuite, etc.), link-in-bio services, automated DMs or auto-replies, ads or boosted
posts. They are mentioned in sources only as information, not as a recommendation.

## Sources (all checked 2026-11-10)

Official (Meta / Instagram):
- Instagram Help Center, "How to create and manage scheduled posts and Reels on Instagram":
  https://help.instagram.com/iphone-app/439971288310029 (75 days; incompatible features; text from the search engine's
  extract, page body did not load in the fetch tool)
- Meta Business Help Centre, "Schedule posts and stories on the Business Suite mobile app" (current title: "Schedule
  Facebook and Instagram content on Meta Business Suite mobile app"):
  https://www.facebook.com/business/help/609176706604372
- Meta Business Help Centre, "Best practices for using the planner in Meta Business Suite":
  https://www.facebook.com/business/help/1170295510042639
- Meta Business Help Centre, "About Creator Studio tools have moved to Meta Business Suite":
  https://www.facebook.com/business/help/825637908842087

Third-party (reported, used only where marked):
- Buffer, "How to Schedule Instagram Stories in 2026" (published 2026-11-04): native scheduler covers Reels, photos and
  carousels but not Stories; Business Suite Story scheduling on desktop and mobile:
  https://buffer.com/resources/how-to-schedule-instagram-stories/
- SocialBee, "Meta planner 30-day post scheduling restriction" (2023-06-30): users report a 30-day Planner limit
  versus Meta's documented 75 days: https://socialbee.com/blog/meta-planner-30-day-post-scheduling-restriction/
- SocialPilot, "How to Schedule Instagram Stories the Right Way" (29 days ahead, 20-minute minimum for Stories):
  https://www.socialpilot.co/strategy/schedule-instagram-stories
- SocialBu, "How to Schedule Instagram Posts and Reels in 2026" (75 days; 25 per day reported):
  https://socialbu.com/blog/schedule-instagram-reels-and-posts
