# F02 / F07 / S05: campaign assets, review queue and export (AMP-051)

Code: `apps/web/lib/aimp/campaign-assets/`. Test page: `/tools/aimp-campaign-assets` (DEMO). Tests: `apps/web/test/aimp-campaign-assets-*.test.ts`.

Turns an APPROVED campaign plan (AMP-050) into Pins, captions, short-video scripts and SEO copy, runs them through a review queue, and exports the approved ones as a ZIP. It works with no publishing account connected. Nothing here publishes or calls an outside service.

## Scope and ownership

Every function takes `scope = { workspaceId, businessId }` and a `campaignId`. The service reads the campaign through `deps.campaigns.get(workspaceId, businessId)` and requires the record to be `approved`, to have that `campaignId`, and to carry the same workspace and business ids on the record and on the plan. Anything else returns `campaign_not_approved` (another business's campaign looks the same as none). The asset store is keyed by workspace + business + campaign. `getApprovedCampaign` from AMP-050 is not used because it does not recheck ownership.

## Types (`types.ts`)

- `AssetKind`: `pin | caption | video_script | seo`. A Pin plan item gets `pin` and `seo`; a caption item gets `caption`; a video item gets `video_script`. Asset id: `<itemId>:<kind>`.
- `PinContent`: title (max 100), description (max 500), altText (max 500), destinationUrl, board (max 100), imageBrief, imageSpec `{1000, 1500, '2:3', fileName, textOverlay}`, publishDate (YYYY-MM-DD), keywords (1 to 10, each max 40).
- `CaptionContent`: variants (1 to 5, each max 2200), destinationUrl, publishDate.
- `VideoScriptContent`: hook (max 150), beats (3 to 8, each max 240), callToAction (max 150), onScreenText (1 to 6, each max 60), targetLengthSeconds (5 to 90), destinationUrl, publishDate.
- `SeoContent`: pageTitle (max 60), metaDescription (max 160), keywords (1 to 10), url.
- `AssetRecord`: `state` (`draft | approved | rejected`), `content`, `revision`, `attempt`, `generator`, `limitIssues[]`, `claimFlags[]`, `rejectionReason`, `decidedAt/By`, `history[]`.
- `AssetHistoryEntry`: `{ at, actor, action: generated | edited | regenerated | approved | rejected, reason?, before?, revision }`. `before` holds the text an edit or regeneration replaced.
- `AssetStore` (memory now, database later): `get(ws, biz, campaign)`, `archived(ws, biz, campaign)`, `mutate(ws, biz, campaign, change)` where `change` may return `{ set, result, archive? }`.
- `AssetGenerator`: `{ id, generate({ kind, item, plan, theme, attempt }) }`. The deterministic template writer is `createTemplateGenerator()` (`template-v1`). A real model implements the same interface; its output goes through the same validation.
- `AssetResult<T>`: `{ ok: true, ... } | { ok: false, errors: { code, message, field? }[] }`. Codes: `invalid scope not_found campaign_not_approved stale wrong_state approved_asset needs_fixes nothing_approved links_not_absolute generator_failed too_large attempt_limit in_progress`.

## Functions

| Function | What it does |
| --- | --- |
| `generateCampaignAssets(deps, scope, campaignId, { actor? })` | Makes the drafts for every plan item. Same campaign version again returns the existing set untouched. A new campaign version starts a new set and the previous set (approvals, history) is kept as an archive record in the same atomic step; the result carries `archivedVersion`. A generator error saves nothing. |
| `listAssets(deps, scope, campaignId)` | The saved set and `current` (matches the campaign version). |
| `listArchivedAssets(deps, scope, campaignId, campaignVersion?)` | Earlier sets replaced by a new campaign version, oldest first, optionally one version. Read-only copies (`ArchivedAssetSet`: the set plus `archivedAt`, `supersededByVersion`). Scoped by workspace + business + campaign; another business gets an empty list. Never the current set, never exported. |
| `approveAsset(..., assetId, { actor, expectedRevision })` | draft to approved. Refused if the text changed since it was read (`stale`), if it is not a draft, or if it has limit or claim problems (`needs_fixes`). |
| `rejectAsset(..., assetId, { actor, reason, expectedRevision })` | draft or approved to rejected. A reason is required. |
| `editAsset(..., assetId, { actor, patch, expectedRevision })` | Changes allowed text fields only (`editableFields`). Links, dates and image size cannot be edited. Revalidated, saved even if flagged (over the display limit), state returns to draft, replaced text kept in history. Refused with `too_large` above the hard caps below; nothing is stored or added to history. |
| `regenerateAsset(..., assetId, { actor, expectedRevision, replaceApproved? })` | New draft from the generator (attempt + 1). An approved asset is refused (`approved_asset`) unless `replaceApproved` is true. Refused with `attempt_limit` once the asset has been regenerated `MAX_REGENERATIONS` times, and with `in_progress` while another regeneration of the same asset is running. |

### Rules added in the AMP-051 rework

- `expectedRevision` is REQUIRED on every mutating call (approve, reject, edit, regenerate): a positive integer equal to the asset's current `revision`. Missing or malformed gives `invalid` (field `revision`); a mismatch gives `stale`. This closes lost updates between two people or two tabs.
- Edit hard caps (`EDIT_CAPS`, `types.ts`): `fieldChars` 5000 per text value or list item, `listItems` 50 per list, `totalChars` 20000 across one edit. They sit far above the display limits (`LIMITS`, e.g. pin description 500) which only raise a `too_long` flag. Above a cap the edit is refused with `too_large`. `targetLengthSeconds` must be a finite number.
- Regenerate ceiling: `MAX_REGENERATIONS` = 5 per asset (`attempt` 0 is the first draft). The check runs before the generator is called and again inside the atomic step. The test page shows the count and the refusal message.
- Regenerate in-flight guard: one regeneration per asset (workspace + business + campaign + asset) at a time, held per store object in process memory and released in `finally`, including when the generator throws. A second concurrent call is refused with `in_progress` without calling the generator. A database store must replace this with a row or advisory lock; the revision check in the atomic step still prevents a double write.
- New campaign version: the old set is archived, never discarded (`AssetStore.archived`, written by the same `mutate` through its optional `archive` result). `exportCampaign` only reads the current set.
| `exportCampaign(deps, scope, campaignId)` | ZIP of approved assets only (below). |

Review states: `draft -> approved | rejected`. Edit or regenerate: any state -> `draft`. Approved assets that are edited leave the export until approved again.

## Validation

`checkContent(kind, content, listing)` returns `limitIssues` (the limits above) and `claimFlags`. Claim flags come from the existing campaign `claimRules` (AMP-050: income, guarantees, medical, financial, scarcity, reviews, discounts, free, wrong price, links/handles/phones) run over every text field. Nothing is truncated or fixed silently; a flagged asset cannot be approved. The export re-checks every approved asset: if an approved record's text was changed outside the service so that it breaks a limit or claim rule, the whole export is refused with `needs_fixes` naming the asset (no ZIP is produced).

## Export (`exportCampaign`)

Result: `{ ok: true, zip, fileName, files, counts, publishing: 'not_connected', notice }`. Refusals: `nothing_approved` (nothing approved), `links_not_absolute` (any approved asset links to a store path because no store root domain is set; set the domain, plan and approve the campaign again), `needs_fixes`, `stale`, `campaign_not_approved`. Files are only included when they have approved content; `README.txt` is always included.

| File | Content |
| --- | --- |
| `pins.csv` | Columns `Title, Media URL, Pinterest board, Description, Link, Publish date, Keywords`. Media URL is the image file name only (replace with a public address before bulk upload). Cells are quoted; a leading `= + - @` is neutralised. CRLF rows. |
| `pin-images.md` | Image text, brief, size (1000x1500) and alt text per Pin. |
| `captions.txt` | Per item: link, then each caption variant. |
| `video-scripts.md` | Hook, beats, on-screen text, call to action, link, length. |
| `seo.json` | `{ pages: [{ itemId, url, pageTitle, metaDescription, keywords }] }`. |
| `README.txt` | Plain-English use of each file; states that nothing was published and no publishing account is connected. |

The ZIP is byte-for-byte reproducible for the same approved assets (`factory/zip.ts`).

## Not real yet

- No AI model: the template writer only rearranges the plan's own words. The `AssetGenerator` seam is ready for one.
- No images are made. Only a brief and a 1000x1500 spec are produced.
- The asset store is in memory (resets on restart); no database table yet.
- No publishing or scheduling (AMP-052). `publishing` is always `not_connected`.
- Links are absolute only when a store root domain or app origin is configured. The DEMO page uses a placeholder `stores.example.test` domain.
- No owner login on the test page: it acts as the demo user and is hidden in production unless `AIMP_TOOLS_ENABLED=1`.
- Store ownership is not rechecked here against the current brand and store (the campaign's own approval did that); this service checks workspace, business and campaign id.
