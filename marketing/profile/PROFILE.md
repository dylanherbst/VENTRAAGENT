# VENTRA Instagram profile package (M-1)

Status: **FOR OWNER APPROVAL.** Nothing here has been published, changed on Instagram or scheduled. Every field below is
a proposal; the owner applies it by hand after approving. No metrics, customers or testimonials are used anywhere.

Source: `marketing/BRIEF.md` (profile section) and `marketing/brand.md`. Rendered assets:
`~/Developer/VENTRA-MARKETING/profile/` (not committed). Re-render with
`node marketing/profile/render-profile.mjs`.

## 1. Display name (for owner approval)

**`VENTRA · AI Front Office`** (24 characters; Instagram allows 30)

The display name is searchable on Instagram, so it carries the category keyword. Alternatives if the owner prefers:
`VENTRA | AI Receptionist & Setter` (33, too long), `VENTRA AI Front Office` (22), `VENTRA` (6, brand only, loses search).

## 2. Username (for owner approval)

The brief says the account already exists; **keep the existing handle** unless the owner wants to change it.
If a change is wanted, candidates (availability NOT checked; the owner checks in the app):

1. `ventra.ai`
2. `ventra.hq`
3. `getventra`
4. `ventra.frontoffice`
5. `ventra.app`

Prefer the one that matches the website domain once the domain is decided.

## 3. Bio (for owner approval)

Recommended, **136 characters** (counted with line breaks as 1 character each; Instagram limit 150):

```
AI front office for service businesses
AI Receptionist answers calls
AI Setter replies to enquiries
Launching soon · join the waitlist ↓
```

Alternatives:

- **127 characters**, outcome-led, no product names:
  ```
  AI front office for service businesses
  Answers calls, replies to enquiries, books the work
  Launching soon · join the waitlist ↓
  ```
- **113 characters**, shortest:
  ```
  Fewer missed calls. More booked jobs.
  AI front office for service businesses
  Launching soon · join the waitlist ↓
  ```

Note: the 4-line bio in `BRIEF.md` (with emoji) is 171 characters without the emoji, so it is over the limit; the
recommended version above is the shortened form of it. "Launching soon" keeps the bio truthful while the
Receptionist and Setter are still in test labs. "join the waitlist" only goes live once the waitlist link exists
(see section 6); until then use the "Launching soon" line without "join the waitlist ↓".

## 4. Category (for owner approval)

- Account type: **Business** (Professional account). Business, not Creator, because it unlocks the contact buttons
  (email, phone, address) and Meta Business Suite scheduling.
- Category: **Software Company**. Fallback if not offered in the picker: "Product/Service" or "Internet Company".
- Display category on profile: on (shows "Software Company" under the name).

## 5. Contact fields checklist (owner provides; nothing invented)

| Field | Use? | Value | Status |
| --- | --- | --- | --- |
| Public business email | Yes (recommended) | `[OWNER TO PROVIDE]` | open |
| Public phone | Optional; only if someone answers it | `[OWNER TO PROVIDE or leave empty]` | open |
| Business address | No (online service; avoid showing a home address) | leave empty | proposed |
| Action button (e.g. "Book now") | Not yet; add when a demo booking page exists | none | later |
| Website (in Links) | Yes | see section 6 | open |

## 6. Link plan (for owner approval)

The owner has not yet given a waitlist link.

| Order | Link title | URL | Status |
| --- | --- | --- | --- |
| 1 | Join the waitlist | **`[PLACEHOLDER: WAITLIST URL, owner to provide]`** | blocked on owner |
| 2 | Website | `[PLACEHOLDER: website URL, owner to provide]` | blocked on owner |
| 3 | Request a demo (later) | add only when a working demo booking page exists | later |

- Until the waitlist link exists: use the website link alone (if any) and drop "join the waitlist ↓" from the bio.
- Use Instagram's own Links field (up to 5 links); no third-party link-in-bio tool without approval.
- Add UTM tags when the URL exists, e.g. `?utm_source=instagram&utm_medium=social&utm_campaign=profile`, so the waitlist
  can see where sign-ups came from.

## 7. Highlights (for owner approval)

Covers are rendered at story size 1080x1920 with all content inside the centre 600 px circle (the part Instagram
shows). Order left to right:

| # | Highlight name | Cover file | Icon | First content to add (when published) |
| --- | --- | --- | --- | --- |
| 1 | Start Here | `highlight-01-start-here.png` | VENTRA mark | What VENTRA is, who it is for, how to join the waitlist |
| 2 | AI Setter | `highlight-02-ai-setter.png` | chat bubble | Setter explainer stories (concept demonstration until lab footage is confirmed) |
| 3 | AI Receptionist | `highlight-03-ai-receptionist.png` | phone | Receptionist explainer stories (concept demonstration until lab footage is confirmed) |
| 4 | Demos | `highlight-04-demos.png` | play | Only real lab or app footage the coordinator confirms; otherwise labelled concept demonstration |
| 5 | Updates | `highlight-05-updates.png` | spark | Honest build progress and launch news |

A highlight needs at least one story before it can be created, so each cover is added when its first story is posted.

## 8. Profile picture

`profile-picture.png`, 1080x1080: the ribbon-V mark (file used as is) centred on the dark brand background with
plum/purple glows. The mark sits inside the centre 50 % of the canvas, well inside Instagram's circular crop.

## 9. Owner setup checklist (in order; owner does this by hand after approval)

1. Open the account in the Instagram app: Settings > Account type and tools > **Switch to professional account**.
2. Choose **Business** (not Creator).
3. Pick the category **Software Company** and turn on "Display category on profile".
4. Add the **contact details** from section 5 (public email; phone only if it is answered). Leave address empty.
5. Edit profile > **Name**: `VENTRA · AI Front Office`. Keep or change the **username** (section 2).
6. Edit profile > **Bio**: paste the approved bio from section 3 (check the counter shows 150 or fewer).
7. Edit profile > **Links** > Add external link: the waitlist URL when it exists (section 6); until then the website.
8. Edit profile > **Change profile picture**: upload `profile-picture.png`; check the circle preview shows the full mark.
9. **Highlights**: post the first story for each highlight, then "New highlight" > name it as in section 7 >
   Edit cover > choose the matching `highlight-0N-*.png` from the camera roll.
10. Connect the account to **Meta Business Suite** (for native scheduling later). Do not schedule anything until
    posts are approved.
11. Tell the coordinator which items were applied so the board can move M-1 from "needs approval" to done.

## Open questions for the owner

- Confirm the existing handle, or pick one from section 2.
- Waitlist URL and website URL (placeholders above).
- Public contact email (and phone, if wanted).
- Logo source file: `apps/web/public/brand/ventra-mark.png` is only **176x93 px**. It is enlarged about 3x in the
  profile picture and about 1.7x on the Start Here cover, so edges are slightly soft at full size (fine at the
  110-320 px Instagram shows). A high-resolution PNG (at least 1000 px wide) or SVG of the mark would make these sharp;
  the renders can be redone in one command once it exists. A white one-colour mark is also still missing.
