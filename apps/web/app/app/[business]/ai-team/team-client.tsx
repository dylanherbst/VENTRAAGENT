'use client';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { adsAction, approvePostAction, connectAction, disconnectAction, editPostAction, imageAction, launchAction, planAction, refreshAction, saveConfigAction, saveProfileAction, schedulePostAction, videoAction } from './actions';
import type { TeamView } from './view';
import { CalendarBoard } from './calendar-board';
import { SetupWizard } from './setup-wizard';
import { CATS, formOf, label, payloadOf, PLATFORMS, toggle } from './team-helpers';
import './team.css';
import '../ai-surfaces.css';

export type Tab = 'team' | 'ads' | 'posts' | 'settings' | 'results' | 'setup';
type Post = TeamView['posts'][number];
const STATE: Record<string, string> = { draft: 'Draft', needs_review: 'Needs review', approved: 'Approved', scheduled: 'Scheduled', published: 'Published', failed: 'Failed', cancelled: 'Cancelled' };
const APPROACH: Record<string, string> = { pattern_interrupt: 'Pattern interrupt', value_contrast: 'Value contrast', curiosity_teaching: 'Curiosity + teaching', identification_objection: 'Objection buster', specific_proof: 'Show-me proof' };

export function TeamClient({ business, initial, startTab }: { business: string; initial: TeamView; startTab?: Tab }) {
  const [v, setV] = useState(initial);
  const [tab, setTab] = useState<Tab>(initial.profile ? (startTab ?? 'team') : 'setup');
  const [busy, setBusy] = useState(false);
  const run = async (p: Promise<TeamView | null>) => {
    setBusy(true);
    try { const n = await p; setV(n ?? { ...v, message: 'This page is not switched on here.', errors: [] }); }
    catch { setV({ ...v, message: 'Something went wrong. Nothing was changed.', errors: [] }); }
    finally { setBusy(false); }
  };
  const [toast, setToast] = useState<string | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  // Back from connecting an account (Zernio sends the browser to ?connected=<platform>): show a message, open Connections and refresh the account list.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const c = q.get('connected');
    if (!c || !/^[a-z]{2,20}$/.test(c)) return;
    router.replace(pathname, { scroll: false });
    setTab('results');
    setToast(`${label(c)} connected.`);
    void refreshAction(business).then((n) => { if (n) setV({ ...n, message: `${label(c)} connected. Your account list is up to date.` }); }).catch(() => undefined);
  }, [business, router, pathname]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 6000); return () => clearTimeout(t); }, [toast]);
  const mock = (k: keyof TeamView['providers']) => v.providers[k] === 'mock' || v.providers[k] === 'demo';

  return (
    <div className="at">
      <div className="at-row at-between">
        <div className="at-tabs" role="tablist">
          {((v.profile && tab !== 'setup' ? ['team', 'ads', 'posts', 'settings', 'results'] : ['setup', 'team', 'ads', 'posts', 'settings', 'results']) as Tab[]).map((t) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{{ setup: 'Set up', team: 'AI Team', ads: 'Marketing studio', posts: 'Social & calendar', settings: 'Agent settings', results: 'Connections & results' }[t]}</button>)}
        </div>
        <div className="at-row">
          {(['text', 'images', 'video', 'publishing'] as const).map((k) => <span key={k} className={`at-tag ${mock(k) ? 'mock' : 'live'}`}>{{ text: 'Writing', images: 'Images', video: 'Video', publishing: 'Publishing' }[k]}: {mock(k) ? 'mock' : 'live'}</span>)}
          <button type="button" disabled={busy} onClick={() => run(refreshAction(business))}>Refresh</button>
        </div>
      </div>
      {v.message ? <p className="at-msg" role="status">{v.message}</p> : null}
      {v.errors.length ? <ul className="at-errors">{v.errors.map((e) => <li key={e}>{e}</li>)}</ul> : null}
      {toast ? <p className="at-toast" role="status">{toast}</p> : null}
      {tab === 'setup' ? <SetupWizard business={business} view={v} onView={setV} onDone={() => setTab('posts')} /> : null}
      {tab === 'team' ? <TeamTab v={v} busy={busy} business={business} run={run} go={setTab} /> : null}
      {tab === 'ads' ? <AdsTab v={v} busy={busy} business={business} run={run} /> : null}
      {tab === 'posts' ? <PostsTab v={v} busy={busy} business={business} run={run} /> : null}
      {tab === 'settings' ? <SettingsTab v={v} busy={busy} business={business} run={run} go={setTab} /> : null}
      {tab === 'results' ? <ResultsTab v={v} busy={busy} business={business} run={run} setV={setV} /> : null}
    </div>
  );
}

type P = { v: TeamView; busy: boolean; business: string; run: (p: Promise<TeamView | null>) => Promise<void> };

function TeamTab({ v, busy, business, run, go }: P & { go: (t: Tab) => void }) {
  const [days, setDays] = useState<7 | 30>(7);
  const stats = [['Waiting for you', v.pending], ['Approved', v.approved], ['Scheduled', v.upcoming.length], ['AI runs this month', v.usage.aiRuns]] as const;
  return (
    <>
      {!v.profile ? <div className="at-card"><h2>Start here</h2><p className="at-muted">Tell your team about the business once. Both agents use it.</p><div className="at-row"><button className="at-primary" onClick={() => go('setup')}>Describe my business</button></div></div> : (
        <div className="at-card">
          <h2>Ask your team</h2>
          <p className="at-muted">The Marketing agent writes five ad ideas, then the Social agent plans your posts to match. Everything waits for your approval.</p>
          <div className="at-row">
            <label className="at-checks"><input type="radio" checked={days === 7} onChange={() => setDays(7)} /> 7 days</label>
            <label className="at-checks"><input type="radio" checked={days === 30} onChange={() => setDays(30)} /> 30 days</label>
            <button className="at-primary" disabled={busy} onClick={() => run(launchAction(business, days))}>{busy ? 'Working...' : `Five ads + ${days} days of posts`}</button>
          </div>
        </div>
      )}
      <div className="at-grid four">{stats.map(([k, n]) => <div className="at-card at-stat" key={k}><span className="at-muted">{k}</span><strong>{n}</strong></div>)}</div>
      <div className="at-grid two">
        <div className="at-card">
          <h2>Your agents</h2>
          <ul className="at-list">
            {(['marketing', 'social'] as const).map((a) => { const c = v.configs[a]; return <li key={a}><span><strong>{a === 'marketing' ? 'Marketing & Ads' : 'Social Media'}</strong> · {c?.presetId} v{c?.presetVersion}</span><span className={`at-tag ${c?.enabled ? 'ok' : 'bad'}`}>{c?.enabled ? 'On' : 'Off'}</span></li>; })}
          </ul>
          <p className="at-muted">Usage this month: {v.usage.aiRuns} runs, {v.usage.images} images, {v.usage.renders} videos, about US${v.usage.costUsd.toFixed(4)}.</p>
        </div>
        <div className="at-card">
          <h2>Coming up</h2>
          {v.upcoming.length ? <ul className="at-list">{v.upcoming.map((p) => <li key={p.id}><span>{p.slot.date} {p.slot.time} · {p.slot.platform}</span><span className={`at-tag ${p.publish?.live ? 'live' : 'mock'}`}>{p.publish?.live ? 'Zernio' : 'Mock'}</span></li>)}</ul> : <p className="at-muted">Nothing scheduled yet.</p>}
        </div>
        <div className="at-card at-wide">
          <h2>Agent activity</h2>
          {v.runs.length ? <ul className="at-list">{v.runs.slice(0, 10).map((r) => <li key={r.id}><span>{r.agent} · {r.kind}{r.demo ? ' (demo writer)' : ` (${r.writer})`}{r.attempts > 1 ? ` · ${r.attempts} tries` : ''}</span><span className={`at-tag ${r.status === 'succeeded' ? 'ok' : r.status === 'running' ? '' : 'bad'}`}>{r.status}{r.error ? `: ${r.error}` : ''}</span></li>)}</ul> : <p className="at-muted">No runs yet.</p>}
          <details><summary>Audit log</summary><ul className="at-list">{v.audit.map((a, i) => <li key={i}><span>{a.at.slice(0, 16).replace('T', ' ')} · {a.actor} · {a.action}</span><span className="at-muted">{a.detail}</span></li>)}</ul></details>
        </div>
      </div>
    </>
  );
}

function Media({ v, target, busy, business, run }: P & { target: { type: 'post' | 'angle'; id: string; campaignId?: string } }) {
  const assets = v.assets.filter((a) => a.target.id === target.id);
  const renders = v.renders.filter((r) => r.target.id === target.id && r.status !== 'completed');
  return (
    <div className="at-form">
      {assets.map((a) => a.kind === 'image' && a.src && a.live ? <img key={a.id} src={a.src} alt="Generated image" /> : <div key={a.id} className="at-ph">{a.live ? `${a.kind === 'video' ? 'Video' : 'Image'} ready (${Math.round(a.size / 1024)} KB)` : `Mock ${a.kind}: no real file was made`}</div>)}
      {renders.map((r) => <div key={r.id} className="at-ph">Video {r.status}{r.error ? `: ${r.error}` : ''}{r.live ? '' : ' (mock)'}</div>)}
      <div className="at-row">
        <button type="button" disabled={busy} onClick={() => run(imageAction(business, target))}>Make image</button>
        <button type="button" disabled={busy} onClick={() => run(videoAction(business, target))}>Make video</button>
      </div>
    </div>
  );
}

function AdsTab(p: P) {
  const { v, busy, business, run } = p;
  const c = v.campaigns[0];
  return (
    <>
      <div className="at-card">
        <div className="at-row at-between"><h2>Marketing studio</h2><div className="at-row"><button disabled={busy || !v.profile} className="at-primary" onClick={() => run(adsAction(business))}>Write five new ad ideas</button><a href={`/app/${business}/marketing/angles`}>Edit and approve angles</a></div></div>
        <p className="at-muted">Five different ways to sell the same thing. Paid ads are off: nothing is created in Meta and nothing is spent.</p>
      </div>
      {c ? (
        <div className="at-grid two">
          {c.angles.map((a) => (
            <article className="at-card at-post" key={a.id}>
              <div className="at-row at-between"><strong>{APPROACH[a.approach]}</strong><span className="at-row">{c.approvedAngleId === a.id ? <span className="at-tag ok">Approved</span> : null}{a.evidenceStatus === 'needs_validation' ? <span className="at-tag mock">Check claims</span> : null}</span></div>
              <p className="at-hook">{a.hook}</p><p>{a.primaryCopy}</p><p className="at-muted">{a.headline} · {a.cta}</p>
              <details><summary>Image and video brief</summary><p className="at-muted">{a.imageBrief}</p>{a.storyboard.length ? <ol>{a.storyboard.map((b, i) => <li key={i}>{b.atSeconds}s {b.visual}</li>)}</ol> : null}</details>
              <Media {...p} target={{ type: 'angle', id: a.id, campaignId: c.id }} />
            </article>
          ))}
        </div>
      ) : <p className="at-muted">No ad ideas yet.</p>}
    </>
  );
}

function PostsTab(p: P) {
  const { v, busy, business, run } = p;
  const [days, setDays] = useState<7 | 30>(7);
  const [open, setOpen] = useState<string | null>(null);
  const plan = v.plans[0];
  const sel = v.posts.find((x) => x.id === open) ?? null;
  return (
    <>
      <div className="at-card">
        <div className="at-row at-between"><h2>Social plan</h2>
          <div className="at-row">
            <select value={days} onChange={(e) => setDays(Number(e.target.value) === 30 ? 30 : 7)} aria-label="Plan length"><option value={7}>7 days</option><option value={30}>30 days</option></select>
            <button className="at-primary" disabled={busy || !v.profile} onClick={() => run(planAction(business, days, v.campaigns[0]?.id ?? null))}>Plan my posts</button>
          </div>
        </div>
        {plan ? <p className="at-muted">{plan.days} days from {plan.startDate} ({plan.timezone}){plan.demo ? ' · demo writer' : ''}{plan.handoff ? ' · matches your latest ad ideas' : ''}. Post times are starting defaults, not data.</p> : <p className="at-muted">No plan yet.</p>}
      </div>
      <div className="at-card"><div className="at-row at-between"><h2>Calendar</h2><a href={`/app/${business}/marketing/calendar`}>Campaign plan and text export</a></div>
        <CalendarBoard v={v} business={business} busy={busy} run={run} onOpen={setOpen} /></div>
      {sel ? <PostEditor key={`${sel.id}:${sel.revision}`} post={sel} {...p} close={() => setOpen(null)} /> : null}
    </>
  );
}

function PostEditor({ post, v, busy, business, run, close }: P & { post: Post; close: () => void }) {
  const [e, setE] = useState({ hook: post.hook, caption: post.caption, cta: post.cta, hashtags: post.hashtags.join(' '), date: post.slot.date, time: post.slot.time });
  const [acct, setAcct] = useState(v.accounts.find((a) => a.platform === post.slot.platform && a.state === 'connected')?.id ?? '');
  const [checked, setChecked] = useState(false);
  const flagged = post.claims.filter((c) => c.status === 'hypothesis');
  const locked = post.state === 'scheduled' || post.state === 'published';
  const accounts = v.accounts.filter((a) => a.platform === post.slot.platform && a.state === 'connected');
  return (
    <article className="at-card at-post">
      <div className="at-row at-between"><h3>{post.slot.platform} {post.slot.format} · {post.slot.pillar}</h3><span className="at-row"><span className="at-tag peach">v{post.revision}</span><span className="at-tag">{STATE[post.state]}</span><button onClick={close}>Close</button></span></div>
      <div className="at-grid two">
        <div className="at-form">
          <label>Hook<input value={e.hook} maxLength={150} disabled={locked} onChange={(x) => setE({ ...e, hook: x.target.value })} /></label>
          <label>Caption<textarea rows={6} value={e.caption} disabled={locked} onChange={(x) => setE({ ...e, caption: x.target.value })} /></label>
          <label>Hashtags<input value={e.hashtags} disabled={locked} onChange={(x) => setE({ ...e, hashtags: x.target.value })} /></label>
          <div className="at-row"><label>Date<input type="date" value={e.date} disabled={locked} onChange={(x) => setE({ ...e, date: x.target.value })} /></label><label>Time<input type="time" value={e.time} disabled={locked} onChange={(x) => setE({ ...e, time: x.target.value })} /></label></div>
          {!locked ? <div className="at-row"><button disabled={busy} onClick={() => run(editPostAction(business, post.id, e))}>Save as new version</button></div> : null}
          <details><summary>Visual brief{post.storyboard.length ? ` and ${post.storyboard.length} beats` : ''}</summary><p className="at-muted">{post.assetBrief || 'Text post'}</p>{post.storyboard.length ? <ol>{post.storyboard.map((b, i) => <li key={i}>{b.atSeconds}{post.slot.format === 'carousel' ? '' : 's'} {b.visual}{b.overlay ? ` · "${b.overlay}"` : ''}</li>)}</ol> : null}</details>
        </div>
        <div className="at-form">
          <Media v={v} busy={busy} business={business} run={run} target={{ type: 'post', id: post.id }} />
          {flagged.length ? <div className="at-claims"><strong>Check before posting</strong><ul>{flagged.map((c) => <li key={c.text}>{c.text}</li>)}</ul><label className="at-checks"><input type="checkbox" checked={checked} onChange={(x) => setChecked(x.target.checked)} /> I checked these are true</label></div> : null}
          {!locked && post.state !== 'approved' ? (
            accounts.length ? <div className="at-row"><select value={acct} onChange={(x) => setAcct(x.target.value)} aria-label="Account">{accounts.map((a) => <option key={a.id} value={a.id}>{a.live ? '' : 'Mock '}@{a.username ?? a.accountId}</option>)}</select><button className="at-primary" disabled={busy || !acct || (flagged.length > 0 && !checked)} onClick={() => run(approvePostAction(business, post.id, acct, checked))}>Approve this version</button></div>
              : <p className="at-muted">Connect a {post.slot.platform} account in Connections & results to approve this post.</p>
          ) : null}
          {post.state === 'approved' ? <div className="at-row"><button className="at-primary" disabled={busy} onClick={() => run(schedulePostAction(business, post.id))}>Schedule {post.slot.date} {post.slot.time}</button></div> : null}
          {post.publish ? <p className="at-muted">{post.publish.live ? 'Zernio' : 'MOCK, not sent anywhere'} · {post.publish.providerPostId ?? 'no id'} · {post.publish.providerStatus ?? ''}{post.publish.error ? ` · error ${post.publish.error}` : ''}{post.publish.url ? <> · <a href={post.publish.url} target="_blank" rel="noreferrer">View post</a></> : null}</p> : null}
        </div>
      </div>
    </article>
  );
}

function SettingsTab({ v, busy, business, run, go }: P & { go: (t: Tab) => void }) {
  const pr = v.profile;
  const [b, setB] = useState({ businessName: pr?.businessName ?? '', industry: pr?.industry ?? 'fitness', offer: pr?.offer ?? '', audience: pr?.audience ?? '', region: pr?.region ?? 'Australia', timezone: pr?.timezone ?? 'Australia/Perth', website: pr?.website ?? '', facts: (pr?.facts ?? []).join('\n') });
  const [agent, setAgent] = useState<'marketing' | 'social'>('social');
  const c = v.configs[agent];
  const [cf, setCf] = useState(() => formOf(c));
  const [newCat, setNewCat] = useState('');
  const save = () => run(saveConfigAction(business, agent, payloadOf(cf)));
  return (
    <div className="at-grid two">
      <form className="at-card at-form" onSubmit={(e) => { e.preventDefault(); run(saveProfileAction(business, b)); }}>
        <div className="at-row at-between"><h2>Your business</h2><button type="button" onClick={() => go('setup')}>Run setup wizard</button></div>
        <p className="at-muted">Shared by both agents.</p>
        <label>Business name<input value={b.businessName} onChange={(e) => setB({ ...b, businessName: e.target.value })} required maxLength={80} /></label>
        <label>Industry<select value={b.industry} onChange={(e) => setB({ ...b, industry: e.target.value })}>{v.presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label>What you sell<textarea rows={2} value={b.offer} onChange={(e) => setB({ ...b, offer: e.target.value })} required maxLength={400} /></label>
        <label>Who it is for<input value={b.audience} onChange={(e) => setB({ ...b, audience: e.target.value })} maxLength={300} /></label>
        <div className="at-row"><label>Region<input value={b.region} onChange={(e) => setB({ ...b, region: e.target.value })} /></label><label>Time zone<input value={b.timezone} onChange={(e) => setB({ ...b, timezone: e.target.value })} /></label></div>
        <label>Website<input value={b.website} onChange={(e) => setB({ ...b, website: e.target.value })} placeholder="https://" /></label>
        <label>Facts you can prove, one per line<textarea rows={3} value={b.facts} onChange={(e) => setB({ ...b, facts: e.target.value })} placeholder={'First session free\n4.9 stars from 87 Google reviews'} /><span className="at-muted">Only these can be stated as true. Reviews here unlock testimonial posts.</span></label>
        <div className="at-row"><button className="at-primary" disabled={busy}>Save business</button></div>
      </form>
      <div className="at-card at-form">
        <div className="at-row at-between"><h2>Agent settings</h2><div className="at-tabs">{(['social', 'marketing'] as const).map((a) => <button type="button" key={a} aria-selected={agent === a} onClick={() => { setAgent(a); setCf(formOf(v.configs[a])); }}>{a === 'social' ? 'Social' : 'Marketing'}</button>)}</div></div>
        <label className="at-checks"><input type="checkbox" checked={cf.enabled} onChange={(e) => setCf({ ...cf, enabled: e.target.checked })} /> Agent on</label>
        <label>Industry preset<select value={cf.presetId} onChange={(e) => setCf({ ...cf, presetId: e.target.value })}>{v.presets.map((p) => <option key={p.id} value={p.id}>{p.name} (v{p.version})</option>)}</select></label>
        <label>Goals, one per line<textarea rows={2} value={cf.goals} onChange={(e) => setCf({ ...cf, goals: e.target.value })} /></label>
        <label>Brand voice<input value={cf.brandVoice} onChange={(e) => setCf({ ...cf, brandVoice: e.target.value })} maxLength={200} /></label>
        <label>Words to avoid, one per line<textarea rows={2} value={cf.avoidPhrases} onChange={(e) => setCf({ ...cf, avoidPhrases: e.target.value })} /></label>
        <fieldset className="at-checks"><legend className="at-muted">Platforms</legend>{PLATFORMS.map((x) => <label key={x}><input type="checkbox" checked={cf.platforms.includes(x)} onChange={() => setCf({ ...cf, platforms: toggle(cf.platforms, x) })} /> {label(x)}</label>)}</fieldset>
        <div className="at-row">{(['reel', 'image', 'carousel', 'text'] as const).map((k) => <label key={k}>{label(k)}s / week<input type="number" min={0} max={14} value={cf[k]} onChange={(e) => setCf({ ...cf, [k]: Number(e.target.value) })} /></label>)}</div>
        <fieldset className="at-checks"><legend className="at-muted">Content types</legend>{CATS.map((x) => <label key={x}><input type="checkbox" checked={cf.categories.includes(x)} onChange={() => setCf({ ...cf, categories: toggle(cf.categories, x) })} /> {label(x)}</label>)}</fieldset>
        <div className="at-form"><span className="at-muted">Your own content sections</span>{cf.customCategories.map((x, i) => <div className="at-row" key={i}><span className="at-tag peach">{x.name}</span><button type="button" onClick={() => setCf({ ...cf, customCategories: cf.customCategories.filter((_, j) => j !== i) })}>Remove</button></div>)}
          <div className="at-row"><input value={newCat} placeholder="e.g. Trainer tips" maxLength={40} onChange={(e) => setNewCat(e.target.value)} /><button type="button" disabled={!newCat.trim()} onClick={() => { setCf({ ...cf, customCategories: [...cf.customCategories, { name: newCat.trim(), description: '', category: 'educational' }] }); setNewCat(''); }}>Add section</button></div></div>
        <div className="at-row"><label>Hashtags per post<input type="number" min={0} max={30} value={cf.hashtags} onChange={(e) => setCf({ ...cf, hashtags: e.target.value })} /></label><label>Mention location<input value={cf.location} onChange={(e) => setCf({ ...cf, location: e.target.value })} /></label></div>
        <label>Common question to answer<input value={cf.faq} onChange={(e) => setCf({ ...cf, faq: e.target.value })} /></label>
        <label>Image style<input value={cf.creativeStyle} onChange={(e) => setCf({ ...cf, creativeStyle: e.target.value })} /></label>
        <label>Anything else (low priority)<textarea rows={2} value={cf.customInstructions} maxLength={500} onChange={(e) => setCf({ ...cf, customInstructions: e.target.value })} /></label>
        <label>Approval<select value={cf.approvalMode} onChange={(e) => setCf({ ...cf, approvalMode: e.target.value as 'manual' | 'draft_only' })}><option value="manual">Drafts, then I approve each post</option><option value="draft_only">Drafts only, I post myself</option></select></label>
        <div className="at-row"><label>Images / month<input type="number" min={0} max={60} value={cf.imagesPerMonth} onChange={(e) => setCf({ ...cf, imagesPerMonth: Number(e.target.value) })} /></label><label>Videos / month<input type="number" min={0} max={20} value={cf.rendersPerMonth} onChange={(e) => setCf({ ...cf, rendersPerMonth: Number(e.target.value) })} /></label><label>AI US$ / month<input type="number" min={0} max={20} value={cf.aiUsdPerMonth} onChange={(e) => setCf({ ...cf, aiUsdPerMonth: Number(e.target.value) })} /></label></div>
        <p className="at-muted">Paid ads stay off. Our safety rules can&apos;t be changed here.</p>
        <div className="at-row"><button className="at-primary" type="button" disabled={busy} onClick={save}>Save {agent} settings</button></div>
      </div>
    </div>
  );
}

function ResultsTab({ v, busy, business, run, setV }: P & { setV: (x: TeamView) => void }) {
  const perf = v.performance;
  const n = (x: number | null) => (x === null ? 'Not measured yet' : x.toLocaleString('en-AU'));
  const connect = async (platform: (typeof PLATFORMS)[number]) => { const r = await connectAction(business, platform); if (r.view) setV(r.view); if (r.redirect) window.location.href = r.redirect; };
  return (
    <div className="at-grid two">
      <div className="at-card">
        <h2>Connected accounts</h2>
        {v.accounts.length ? <ul className="at-list">{v.accounts.map((a) => <li key={a.id}><span>{label(a.platform)} @{a.username ?? a.accountId}</span><span className="at-row"><span className={`at-tag ${a.live ? 'live' : 'mock'}`}>{a.live ? 'Zernio' : 'Mock'}</span><span className={`at-tag ${a.state === 'connected' ? 'ok' : 'bad'}`}>{a.state}</span>{a.state === 'connected' ? <button disabled={busy} onClick={() => run(disconnectAction(business, a.id))}>Disconnect</button> : null}</span></li>)}</ul> : <p className="at-muted">No accounts yet.</p>}
        <div className="at-row">{PLATFORMS.map((x) => <button key={x} disabled={busy} onClick={() => connect(x)}>Connect {label(x)}</button>)}</div>
        <p className="at-muted">{v.providers.publishing === 'live' ? 'Instagram needs a Business or Creator account.' : 'Mock mode: connecting adds a test account. Nothing can reach a real account until Zernio is set up.'}</p>
      </div>
      <div className="at-card">
        <h2>Results</h2>
        <ul className="at-list">
          <li><span>Published (live)</span><strong>{perf.publishedLive}</strong></li>
          {perf.publishedMock ? <li><span>Published (mock)</span><strong>{perf.publishedMock}</strong></li> : null}
          <li><span>Scheduled</span><strong>{perf.scheduled}</strong></li>
          <li><span>Reach</span><strong>{n(perf.reach)}</strong></li>
          <li><span>Engagement</span><strong>{n(perf.engagement)}</strong></li>
          <li><span>Clicks</span><strong>{n(perf.clicks)}</strong></li>
          <li><span>Leads</span><strong>{n(perf.leads)}</strong></li>
          <li><span>Paid ads</span><strong>Not connected</strong></li>
        </ul>
        <p className="at-muted">{perf.lastSynced ? `Last synced ${perf.lastSynced.slice(0, 16).replace('T', ' ')} UTC` : 'Numbers appear only when your accounts report them.'}</p>
        <h3>Recommendations</h3>
        <ul className="at-list">{perf.recommendations.map((r) => <li key={r}>{r}</li>)}</ul>
      </div>
    </div>
  );
}
