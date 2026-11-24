#!/usr/bin/env node
// Quick skeleton: serves the real feature list from docs/agents/FEATURES.md at http://localhost:4180
// Zero dependencies. Read-only. Re-reads the file on every request, so edits show up on refresh.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FILE = path.join(ROOT, 'docs/agents/FEATURES.md');
const PORT = Number(process.env.PORT || 4180);

function features() {
  return readFileSync(FILE, 'utf8').split('\n')
    .filter(l => l.startsWith('|') && !l.startsWith('| Phase') && !l.startsWith('| ---'))
    .map(l => l.trim().replace(/^\||\|$/g, '').split('|').map(x => x.trim()))
    .filter(c => c.length >= 7)
    .map(([phase, module, feature, status, demo, evidence, next]) => ({ phase, module, feature, status, demo, evidence, next }));
}

const page = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>VENTRA features</title>
<style>
:root{--bg:#0f1115;--card:#171a21;--line:#262b36;--text:#e8eaf0;--mute:#9aa3b5;--ok:#3ecf8e;--draft:#f5b84b;--block:#ef6a6a;--none:#6b7385}
@media (prefers-color-scheme:light){:root{--bg:#f6f7fa;--card:#fff;--line:#e3e6ee;--text:#1b1f2a;--mute:#5b6478}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 system-ui,sans-serif}
main{max-width:980px;margin:0 auto;padding:24px 16px 64px}
h1{margin:0 0 4px;font-size:22px}p.sub{margin:0 0 16px;color:var(--mute)}
.bar{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 16px}
button,input{font:inherit;color:var(--text);background:var(--card);border:1px solid var(--line);border-radius:999px;padding:6px 14px}
button{cursor:pointer}button.on{border-color:var(--text)}input{flex:1;min-width:160px;border-radius:8px}
.row{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin:0 0 8px;display:grid;grid-template-columns:1fr auto;gap:4px 12px}
.row b{font-weight:600}.mod{color:var(--mute);font-size:13px}.ev{grid-column:1/-1;color:var(--mute);font-size:13px}
.tag{align-self:start;font-size:12px;border-radius:999px;padding:2px 10px;border:1px solid currentColor;white-space:nowrap}
.Working{color:var(--ok)}.Local{color:var(--draft)}.Blocked{color:var(--block)}.Not{color:var(--none)}
a{color:inherit}
</style>
<main><h1>VENTRA features</h1><p class="sub" id="sub">Loading…</p>
<div class="bar" id="bar"></div><div id="list"></div></main>
<script>
let all=[],filter='All',q='';
const cls=s=>s==='Working'?'Working':s==='Local draft'?'Local':s==='Blocked'?'Blocked':'Not';
function draw(){
  const rows=all.filter(f=>(filter==='All'||f.status===filter)&&(f.module+' '+f.feature).toLowerCase().includes(q));
  const list=document.getElementById('list');list.textContent='';
  for(const f of rows){
    const r=document.createElement('div');r.className='row';
    const l=document.createElement('div');const b=document.createElement('b');b.textContent=f.feature;
    const m=document.createElement('div');m.className='mod';m.textContent=f.module+(f.demo?' · demo: '+f.demo:'');
    l.append(b,m);
    const t=document.createElement('span');t.className='tag '+cls(f.status);t.textContent=f.status;
    r.append(l,t);
    const e=document.createElement('div');e.className='ev';e.textContent=f.status==='Working'?f.evidence:(f.next||f.evidence);
    r.append(e);list.append(r);
  }
  if(!rows.length){list.textContent='No features match.'}
}
function bar(){
  const bar=document.getElementById('bar');bar.textContent='';
  for(const s of ['All','Working','Local draft','Blocked','Not started']){
    const n=s==='All'?all.length:all.filter(f=>f.status===s).length;
    const b=document.createElement('button');b.textContent=s+' '+n;if(s===filter)b.className='on';
    b.onclick=()=>{filter=s;bar_();draw()};bar.append(b);
  }
  const i=document.createElement('input');i.placeholder='Search features';i.oninput=e=>{q=e.target.value.toLowerCase();draw()};bar.append(i);
}
const bar_=bar;
fetch('/api/features').then(r=>r.json()).then(d=>{all=d;document.getElementById('sub').textContent=d.length+' features, read live from docs/agents/FEATURES.md';bar();draw()});
</script></html>`;

createServer((req, res) => {
  if (req.url === '/api/features') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify(features()));
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(page);
}).listen(PORT, '127.0.0.1', () => console.log(`Features skeleton: http://localhost:${PORT}`));
