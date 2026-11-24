// Export of APPROVED campaign assets as a ZIP (AMP-051, S05). Works with no publishing account connected: the files are for the
// merchant to upload or post by hand, and the result says plainly that nothing was published. Draft and rejected assets never
// leave. Links must be full web addresses: a store path would be useless outside the store, so the export refuses instead.
import { createZip } from '../factory/zip.ts';
import type { ZipEntry } from '../factory/zip.ts';
import { loadApprovedCampaign } from './service.ts';
import { checkContent, linkOf } from './validate.ts';
import type { AssetDeps, AssetIssue, AssetRecord, AssetResult, AssetScope } from './types.ts';

export const PIN_CSV_COLUMNS = ['Title', 'Media URL', 'Pinterest board', 'Description', 'Link', 'Publish date', 'Keywords'] as const;
export const EXPORT_FILES = { pins: 'pins.csv', pinImages: 'pin-images.md', captions: 'captions.txt', videoScripts: 'video-scripts.md', seo: 'seo.json', readme: 'README.txt' } as const;

export interface CampaignExport {
  zip: Uint8Array;
  fileName: string;
  /** File names inside the ZIP. */
  files: string[];
  counts: { pins: number; captions: number; videoScripts: number; seo: number };
  /** No publishing account is connected, and this export never publishes. */
  publishing: 'not_connected';
  notice: string;
}

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim();
/** CSV cell: quoted, quotes doubled, and a leading = + - @ neutralised so a spreadsheet never runs it as a formula. */
function cell(s: string): string {
  const t = oneLine(s);
  return `"${(/^[=+\-@]/.test(t) ? `'${t}` : t).replace(/"/g, '""')}"`;
}

const ofKind = <K extends 'pin' | 'caption' | 'video_script' | 'seo'>(assets: AssetRecord[], kind: K) => assets.filter((a) => a.kind === kind) as (AssetRecord<K>)[];
const label = (a: AssetRecord, dates: Map<string, string>): string => `${dates.get(a.itemId) ?? ''} · ${a.itemId}`;

function pinsCsv(pins: AssetRecord<'pin'>[]): string {
  const rows = pins.map((a) => {
    const c = a.content;
    return [c.title, c.imageSpec.fileName, c.board, c.description, c.destinationUrl, c.publishDate, c.keywords.join(', ')].map(cell).join(',');
  });
  return `${[PIN_CSV_COLUMNS.map(cell).join(','), ...rows].join('\r\n')}\r\n`;
}
function pinImages(pins: AssetRecord<'pin'>[]): string {
  return ['# Pin images to make', '', `Make each image ${pins[0]?.content.imageSpec.width}x${pins[0]?.content.imageSpec.height} pixels (2:3) with the file name shown, then upload it where pins.csv says.`, '',
    ...pins.flatMap((a) => [`## ${a.content.imageSpec.fileName}`, `- Text on the image: ${a.content.imageSpec.textOverlay}`, `- Brief: ${a.content.imageBrief}`, `- Alt text: ${a.content.altText}`, '']),
  ].join('\n');
}
function captionsTxt(items: AssetRecord<'caption'>[], dates: Map<string, string>): string {
  return items.map((a) => [`=== ${label(a, dates)} ===`, `Link: ${a.content.destinationUrl}`, ...a.content.variants.flatMap((v, i) => ['', `--- Variant ${i + 1} ---`, v])].join('\n')).join('\n\n\n') + '\n';
}
function videoMd(items: AssetRecord<'video_script'>[]): string {
  return ['# Short-video scripts', '', ...items.flatMap((a) => {
    const c = a.content;
    return [`## ${a.itemId} · post on ${c.publishDate} · about ${c.targetLengthSeconds} seconds`, '', `**Hook:** ${c.hook}`, '', '**Beats:**', ...c.beats.map((b, i) => `${i + 1}. ${b}`), '', '**On-screen text:**', ...c.onScreenText.map((t) => `- ${t}`), '', `**Call to action:** ${c.callToAction}`, `**Link:** ${c.destinationUrl}`, ''];
  })].join('\n');
}
function seoJson(items: AssetRecord<'seo'>[]): string {
  return `${JSON.stringify({ pages: items.map((a) => ({ itemId: a.itemId, url: a.content.url, pageTitle: a.content.pageTitle, metaDescription: a.content.metaDescription, keywords: a.content.keywords })) }, null, 2)}\n`;
}
function readme(files: string[], counts: CampaignExport['counts'], campaign: { version: number; brand: string }): string {
  const has = (f: string) => files.includes(f);
  const lines = [
    `Campaign assets for ${campaign.brand} (campaign version ${campaign.version})`,
    '',
    'NOTHING HAS BEEN PUBLISHED. No publishing account is connected, and this export never posts anything. Every file below is for you to use by hand.',
    'Only assets you approved are in this folder. Anything still in draft, or rejected, was left out.',
    '',
    'What to do with each file:',
  ];
  if (has('pins.csv')) lines.push(`- pins.csv (${counts.pins} Pins): Pinterest bulk-upload columns. The "Media URL" column holds the image file name only. Make the images (see pin-images.md), put them at a public web address, and replace each file name with that address before you upload. Publish date is the day we suggest, not a scheduled post.`);
  if (has('pin-images.md')) lines.push('- pin-images.md: what each Pin image should show, its size (1000x1500) and its alt text.');
  if (has('captions.txt')) lines.push(`- captions.txt (${counts.captions} captions, each with variants): copy one variant, paste it into Instagram or another app, and post it yourself. The product link is listed under each caption.`);
  if (has('video-scripts.md')) lines.push(`- video-scripts.md (${counts.videoScripts} scripts): record a short video from each script (hook, beats, call to action) and post it yourself.`);
  if (has('seo.json')) lines.push(`- seo.json (${counts.seo} pages): the page title, meta description and keywords for each product page. Copy them into your store settings if you want them.`);
  lines.push('', 'Before you post, read each piece once more. The wording was checked against the listing, but you are the one who publishes it.', '');
  return lines.join('\n');
}

export async function exportCampaign(deps: AssetDeps, scope: AssetScope, campaignId: string): Promise<AssetResult<CampaignExport>> {
  const loaded = await loadApprovedCampaign(deps, scope, campaignId);
  if (!loaded.ok) return loaded;
  const { campaign } = loaded;
  const set = await deps.assets.get(scope.workspaceId, scope.businessId, campaignId);
  if (!set) return { ok: false, errors: [{ code: 'not_found', message: 'No assets have been generated for this campaign yet.' }] };
  if (set.campaignVersion !== campaign.version) return { ok: false, errors: [{ code: 'stale', message: `These assets were made from campaign version ${set.campaignVersion}; the campaign is now version ${campaign.version}. Generate the assets again.` }] };

  const approved = set.assets.filter((a) => a.state === 'approved');
  if (approved.length === 0) return { ok: false, errors: [{ code: 'nothing_approved', message: 'Nothing is approved yet, so there is nothing to export. Approve at least one asset in the review queue first.' }] };

  // Defence in depth: an approved asset is re-checked, so text that no longer passes can never leave.
  const errors: AssetIssue[] = [];
  for (const a of approved) {
    const item = campaign.plan.items.find((i) => i.id === a.itemId);
    const check = checkContent(a.kind, a.content, item ? { priceMinor: item.priceMinor, currency: item.currency } : null);
    if (!item || check.limitIssues.length || check.claimFlags.length) errors.push({ code: 'needs_fixes', field: a.id, message: `The approved asset ${a.id} no longer passes the limits and claim rules. Edit it and approve it again.` });
  }
  if (errors.length) return { ok: false, errors };
  const relative = approved.filter((a) => !/^https?:\/\/\S+$/i.test(linkOf(a.kind, a.content)));
  if (relative.length) {
    return { ok: false, errors: [{ code: 'links_not_absolute', field: 'links', message: `${relative.length} approved asset(s) link to a store path (for example ${linkOf(relative[0]!.kind, relative[0]!.content)}), not a full web address. Set the store's domain, plan the campaign again, and approve it, so the links work outside the store.` }] };
  }

  const dates = new Map(campaign.plan.items.map((i) => [i.id, i.scheduledDate]));
  const pins = ofKind(approved, 'pin');
  const captions = ofKind(approved, 'caption');
  const videos = ofKind(approved, 'video_script');
  const seo = ofKind(approved, 'seo');
  const counts = { pins: pins.length, captions: captions.length, videoScripts: videos.length, seo: seo.length };

  const entries: ZipEntry[] = [];
  if (pins.length) entries.push({ name: EXPORT_FILES.pins, data: enc(pinsCsv(pins)) }, { name: EXPORT_FILES.pinImages, data: enc(pinImages(pins)) });
  if (captions.length) entries.push({ name: EXPORT_FILES.captions, data: enc(captionsTxt(captions, dates)) });
  if (videos.length) entries.push({ name: EXPORT_FILES.videoScripts, data: enc(videoMd(videos)) });
  if (seo.length) entries.push({ name: EXPORT_FILES.seo, data: enc(seoJson(seo)) });
  const names = entries.map((e) => e.name);
  entries.push({ name: EXPORT_FILES.readme, data: enc(readme(names, counts, { version: campaign.version, brand: campaign.plan.brand.name })) });

  return {
    ok: true,
    zip: createZip(entries),
    fileName: `campaign-assets-${campaignId}-v${campaign.version}.zip`,
    files: entries.map((e) => e.name),
    counts,
    publishing: deps.publishing ?? 'not_connected',
    notice: 'Exported without a publishing account. Nothing was published; the files are for you to upload or post by hand.',
  };
}
