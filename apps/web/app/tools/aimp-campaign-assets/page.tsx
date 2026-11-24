import { notFound } from 'next/navigation';
import { assetsRuntime } from '../../../lib/aimp/campaign-assets/demo';
import { listAssets } from '../../../lib/aimp/campaign-assets/service';
import { MAX_REGENERATIONS } from '../../../lib/aimp/campaign-assets/types';
import type { AssetRecord, CaptionContent, PinContent, SeoContent, VideoScriptContent } from '../../../lib/aimp/campaign-assets/types';
import { approve, edit, generate, regenerate, reject } from './actions';

export const dynamic = 'force-dynamic';

type Params = { [key: string]: string | string[] | undefined };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
const box = { display: 'block', width: '100%', minHeight: 44, padding: 8, boxSizing: 'border-box' } as const;
const btn = { minHeight: 44, minWidth: 44, padding: '8px 16px' } as const;

function Preview({ a }: { a: AssetRecord }) {
  if (a.kind === 'pin') {
    const c = a.content as PinContent;
    return <div data-testid="preview">
      <p><strong>{c.title}</strong> ({c.title.length}/100)</p>
      <p>{c.description} ({c.description.length}/500)</p>
      <p>Alt text: {c.altText}</p>
      <p>Board: {c.board} · publish date {c.publishDate} · keywords {c.keywords.join(', ')}</p>
      <p>Image: {c.imageSpec.width}x{c.imageSpec.height} · {c.imageBrief}</p>
      <p>Link: {c.destinationUrl}</p>
    </div>;
  }
  if (a.kind === 'caption') {
    const c = a.content as CaptionContent;
    return <div data-testid="preview">{c.variants.map((v, i) => <pre key={i} style={{ whiteSpace: 'pre-wrap' }}>{v}</pre>)}<p>Link: {c.destinationUrl}</p></div>;
  }
  if (a.kind === 'video_script') {
    const c = a.content as VideoScriptContent;
    return <div data-testid="preview">
      <p><strong>Hook:</strong> {c.hook} · about {c.targetLengthSeconds}s</p>
      <ol>{c.beats.map((b, i) => <li key={i}>{b}</li>)}</ol>
      <p>On screen: {c.onScreenText.join(' / ')}</p>
      <p>Call to action: {c.callToAction} · link {c.destinationUrl}</p>
    </div>;
  }
  const c = a.content as SeoContent;
  return <div data-testid="preview">
    <p><strong>{c.pageTitle}</strong> ({c.pageTitle.length}/60)</p>
    <p>{c.metaDescription} ({c.metaDescription.length}/160)</p>
    <p>Keywords: {c.keywords.join(', ')} · {c.url}</p>
  </div>;
}

function editDefaults(a: AssetRecord): [string, string] {
  const c = a.content as unknown as Record<string, unknown>;
  if (a.kind === 'pin') return [String(c.title), String(c.description)];
  if (a.kind === 'caption') return [(c.variants as string[]).join('\n---\n'), ''];
  if (a.kind === 'video_script') return [String(c.hook), String(c.callToAction)];
  return [String(c.pageTitle), String(c.metaDescription)];
}

// Isolated test page for AMP-051 (campaign assets and review queue): the real asset generator, review queue and exporter on
// in-memory stores, for the demo business's approved campaign. Plain markup, no design system. Nothing is published.
export default async function CampaignAssetsTest({ searchParams }: { searchParams: Promise<Params> }) {
  const p = assetsRuntime();
  if (!p) notFound(); // production: hidden unless AIMP_TOOLS_ENABLED=1
  const rt = await p;
  const msg = one((await searchParams).msg);
  const listed = await listAssets(rt.deps, rt.scope, rt.campaignId);
  const set = listed.ok ? listed.set : null;
  const count = (s: string) => set?.assets.filter((a) => a.state === s).length ?? 0;

  return <main style={{ maxWidth: 760, margin: '0 auto', padding: 12, fontFamily: 'system-ui, sans-serif', lineHeight: 1.5 }}>
    <h1>Campaign assets test</h1>
    <p>
      <span data-testid="page-mode"><strong>DEMO</strong></span>
      {' '}· Connection: <span data-testid="connection-state">no AI provider call (built-in template writer); database not connected (in-memory, resets on server restart)</span>
    </p>
    <p data-testid="publishing-state"><strong>Publishing account: not connected.</strong> You can still preview and export. Nothing is ever posted from this page.</p>
    <p data-testid="store-domain">{rt.storeDomain === 'configured' ? 'Links use the configured store domain.' : 'No store domain is configured, so the demo uses a placeholder domain (stores.example.test) to give full links. It is not a real store.'}</p>
    {msg && <p role="alert" data-testid="assets-message">{msg}</p>}

    <form action={generate}><p><button type="submit" style={btn} data-testid="generate">{set ? 'Check for new campaign version' : 'Generate assets'}</button></p></form>

    {!set ? <p data-testid="no-assets">{listed.ok ? '' : listed.errors.map((e) => e.message).join(' ')}</p> : <>
      <p data-testid="counts">{set.assets.length} assets · draft {count('draft')} · approved <span data-testid="approved-count">{count('approved')}</span> · rejected {count('rejected')} · campaign version {set.campaignVersion}{listed.ok && !listed.current ? ' (OUT OF DATE)' : ''}</p>
      <p><a href="/tools/aimp-campaign-assets/download" data-testid="download">Download export ZIP (approved assets only)</a></p>

      {set.assets.map((a) => {
        const [d1, d2] = editDefaults(a);
        const problems = a.limitIssues.length + a.claimFlags.length;
        return <details key={a.id} data-testid="asset" style={{ borderTop: '1px solid #ccc', marginTop: 8, paddingTop: 8 }}>
          <summary>{a.id} · <strong data-testid="asset-state">{a.state}</strong>{problems ? ` · ${problems} problem(s)` : ''} · revision {a.revision}</summary>
          <Preview a={a} />
          {problems > 0 && <ul data-testid="asset-problems">
            {a.limitIssues.map((i, n) => <li key={`l${n}`}>{i.message}</li>)}
            {a.claimFlags.map((i, n) => <li key={`c${n}`}>{i.field}: {i.message} [rule: {i.ruleId}]</li>)}
          </ul>}
          {a.rejectionReason && <p>Rejected because: {a.rejectionReason}</p>}
          <p>History: {a.history.map((h) => `${h.action} (rev ${h.revision})`).join(' → ')}</p>
          <form action={approve}><input type="hidden" name="assetId" value={a.id} /><input type="hidden" name="revision" value={a.revision} /><button type="submit" style={btn} data-testid="approve">Approve</button></form>
          <form action={reject}><input type="hidden" name="assetId" value={a.id} /><input type="hidden" name="revision" value={a.revision} />
            <label>Reason <input name="reason" style={box} /></label><button type="submit" style={btn} data-testid="reject">Reject</button></form>
          <form action={edit}><input type="hidden" name="assetId" value={a.id} /><input type="hidden" name="revision" value={a.revision} /><input type="hidden" name="kind" value={a.kind} />
            <label>{a.kind === 'caption' ? 'Variants (separate with a line of ---)' : 'Main text'} <textarea name="a" defaultValue={d1} style={box} /></label>
            {a.kind !== 'caption' && <label>Second text <textarea name="b" defaultValue={d2} style={box} /></label>}
            <button type="submit" style={btn} data-testid="edit">Save edit</button></form>
          <form action={regenerate}><input type="hidden" name="assetId" value={a.id} /><input type="hidden" name="revision" value={a.revision} />
            <p data-testid="attempts">Regenerated {a.attempt} of {MAX_REGENERATIONS} times{a.attempt >= MAX_REGENERATIONS ? ' (limit reached: edit by hand instead)' : ''}</p>
            <label><input type="checkbox" name="replaceApproved" value="1" /> Replace even if approved</label>
            <button type="submit" style={btn} data-testid="regenerate">Regenerate</button></form>
        </details>;
      })}
    </>}
  </main>;
}
