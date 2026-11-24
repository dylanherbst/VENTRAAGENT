#!/usr/bin/env node
// VENTRA marketing renderer: HTML templates (marketing/templates) -> PNG via Playwright/Chromium.
//
// SCALE: templates are authored at HALF the Instagram pixel size and rendered at deviceScaleFactor 2,
// so the PNG pixel size = template CSS size x 2:
//   carousel  540x675 CSS -> 1080x1350 PNG (feed portrait)
//   post      540x540 CSS -> 1080x1080 PNG (square)
//   story     540x960 CSS -> 1080x1920 PNG (story / reel cover)
//   highlight 540x540 CSS -> 1080x1080 PNG (highlight cover, centre-circle content)
// Every render is measured from the PNG header and fails if the size is not exactly as above.
//
// Usage:
//   node marketing/render.mjs --check
//       renders one sample of each template to ~/Developer/VENTRA-MARKETING/samples/
//   node marketing/render.mjs --template carousel --out <file.png> [--data '{"theme":"light","slots":{"title":"..."}}']
//   node marketing/render.mjs --spec <spec.json>
//       spec: { "outDir": "~/Developer/VENTRA-MARKETING/posts/01-intro",
//               "items": [ { "template": "carousel", "name": "slide-01", "theme": "dark", "slots": { ... } } ] }
//
// Slots are plain text: *word* = gradient accent, "\n" = line break, arrays = bullet list, "" hides a slot.
// Fonts: Outfit + Hanken Grotesk from Google Fonts (free, OFL); needs network at render time. Each render reports
// whether both fonts actually loaded; "FALLBACK" means a system font was used and the PNG must not be shipped.
//
// Playwright: resolved from marketing/node_modules, apps/web/node_modules, the repo root, $PLAYWRIGHT_CORE_PATH,
// or the npx cache (~/.npm/_npx). Browser: Playwright default, else $CHROMIUM_PATH, else the newest
// chromium_headless_shell / chromium build in the Playwright browser cache.

import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, "..");
export const TEMPLATES = path.join(HERE, "templates");
export const DELIVERABLES = path.join(os.homedir(), "Developer", "VENTRA-MARKETING");
export const SCALE = 2;

export const SIZES = {
  carousel: { file: "carousel.html", w: 540, h: 675 },
  post: { file: "post.html", w: 540, h: 540 },
  story: { file: "story.html", w: 540, h: 960 },
  highlight: { file: "highlight.html", w: 540, h: 540 },
  reel: { file: "reel.html", w: 540, h: 960 },
};

export function expandHome(p) {
  return p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : path.resolve(p);
}

// ---------- Playwright resolution ----------
function versionKey(v) {
  const [core, pre] = v.split("-");
  const nums = core.split(".").map((n) => parseInt(n, 10) || 0);
  return { nums, pre: pre ? 0 : 1 };
}
function cmpVersion(a, b) {
  const A = versionKey(a), B = versionKey(b);
  for (let i = 0; i < 3; i++) if (A.nums[i] !== B.nums[i]) return A.nums[i] - B.nums[i];
  return A.pre - B.pre;
}

function playwrightCandidates() {
  const out = [];
  for (const base of [HERE, path.join(REPO, "apps", "web"), REPO]) {
    const req = createRequire(path.join(base, "package.json"));
    for (const name of ["playwright-core", "playwright"]) {
      try { out.push({ from: `${name} (${path.relative(REPO, base) || "."})`, main: req.resolve(name) }); } catch {}
    }
  }
  if (process.env.PLAYWRIGHT_CORE_PATH) {
    const p = process.env.PLAYWRIGHT_CORE_PATH;
    try { out.push({ from: "$PLAYWRIGHT_CORE_PATH", main: createRequire(path.join(p, "package.json")).resolve(p) }); } catch {}
  }
  const npx = path.join(os.homedir(), ".npm", "_npx");
  const found = [];
  if (fs.existsSync(npx)) {
    for (const dir of fs.readdirSync(npx)) {
      const pkg = path.join(npx, dir, "node_modules", "playwright-core", "package.json");
      if (!fs.existsSync(pkg)) continue;
      try {
        const v = JSON.parse(fs.readFileSync(pkg, "utf8")).version;
        found.push({ from: `npx cache playwright-core@${v}`, main: path.join(path.dirname(pkg), "index.js"), v });
      } catch {}
    }
  }
  // stable releases first, newest first
  found.sort((a, b) => cmpVersion(b.v, a.v));
  return out.concat(found);
}

function browserCacheDir() {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH && process.env.PLAYWRIGHT_BROWSERS_PATH !== "0") return process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Caches", "ms-playwright");
  return path.join(os.homedir(), ".cache", "ms-playwright");
}

function cachedChromiumExecutables() {
  const dir = browserCacheDir();
  if (!fs.existsSync(dir)) return [];
  const list = [];
  for (const d of fs.readdirSync(dir)) {
    const m = d.match(/^(chromium_headless_shell|chromium)-(\d+)$/);
    if (!m) continue;
    if (!fs.existsSync(path.join(dir, d, "INSTALLATION_COMPLETE"))) continue;
    const root = path.join(dir, d);
    const candidates = m[1] === "chromium_headless_shell"
      ? ["chrome-headless-shell-mac-arm64/chrome-headless-shell", "chrome-headless-shell-mac-x64/chrome-headless-shell", "chrome-headless-shell-linux64/chrome-headless-shell"]
      : ["chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing", "chrome-mac/Chromium.app/Contents/MacOS/Chromium", "chrome-linux/chrome"];
    for (const c of candidates) {
      const exe = path.join(root, c);
      if (fs.existsSync(exe)) list.push({ exe, rev: +m[2], shell: m[1] === "chromium_headless_shell" });
    }
  }
  list.sort((a, b) => (b.shell - a.shell) || (b.rev - a.rev));
  return list.map((x) => x.exe);
}

export async function launchBrowser({ quiet = false } = {}) {
  const errors = [];
  for (const cand of playwrightCandidates()) {
    let mod;
    try { mod = await import(pathToFileURL(cand.main).href); } catch (e) { errors.push(`${cand.from}: import failed (${e.message.split("\n")[0]})`); continue; }
    const chromium = mod.chromium || (mod.default && mod.default.chromium);
    if (!chromium) { errors.push(`${cand.from}: no chromium export`); continue; }
    const exes = [undefined];
    if (process.env.CHROMIUM_PATH) exes.unshift(process.env.CHROMIUM_PATH);
    exes.push(...cachedChromiumExecutables());
    for (const exe of exes) {
      try {
        const browser = await chromium.launch({ headless: true, ...(exe ? { executablePath: exe } : {}) });
        const info = { playwright: cand.from, browser: exe ? exe.replace(os.homedir(), "~") : "playwright default", version: browser.version() };
        if (!quiet) console.log(`[render] Playwright: ${info.playwright} | Chromium ${info.version} | ${info.browser}`);
        return { browser, info };
      } catch (e) {
        errors.push(`${cand.from} + ${exe ? exe.replace(os.homedir(), "~") : "default browser"}: ${e.message.split("\n")[0]}`);
      }
    }
  }
  const msg = ["[render] MISSING: no working Playwright + Chromium found.", ...errors.map((e) => "  - " + e),
    "  Fix: npm install in marketing/ (playwright-core), then `npx playwright install chromium`, or set PLAYWRIGHT_CORE_PATH / CHROMIUM_PATH."].join("\n");
  throw new Error(msg);
}

// ---------- PNG measurement ----------
export function pngSize(file) {
  const fd = fs.openSync(file, "r");
  const buf = Buffer.alloc(24);
  fs.readSync(fd, buf, 0, 24, 0);
  fs.closeSync(fd);
  if (buf.toString("ascii", 12, 16) !== "IHDR") throw new Error(`${file} is not a PNG`);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

// ---------- Page preparation (shared with reel.mjs) ----------
export async function openTemplate(browser, template, data) {
  const t = SIZES[template];
  if (!t) throw new Error(`Unknown template "${template}". Use one of: ${Object.keys(SIZES).join(", ")}`);
  const context = await browser.newContext({ viewport: { width: t.w, height: t.h }, deviceScaleFactor: SCALE });
  const page = await context.newPage();
  if (data) await page.addInitScript((d) => { window.__VENTRA__ = d; }, data);
  await page.goto(pathToFileURL(path.join(TEMPLATES, t.file)).href, { waitUntil: "networkidle", timeout: 30000 }).catch(async () => {
    // offline: continue with whatever loaded; the font check below reports it
    await page.waitForLoadState("load").catch(() => {});
  });
  await page.waitForSelector("html[data-filled='1']", { timeout: 10000 });
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    const want = ['600 40px "Outfit"', '400 16px "Hanken Grotesk"'];
    await Promise.all(want.map((f) => document.fonts.load(f).catch(() => null)));
    const loaded = [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/"/g, ""));
    const imgs = [...document.images];
    await Promise.all(imgs.map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; }))));
    const brokenImages = imgs.filter((i) => !i.naturalWidth).map((i) => i.getAttribute("src"));
    return { outfit: loaded.includes("Outfit"), hanken: loaded.includes("Hanken Grotesk"), brokenImages };
  });
  return { context, page, size: t, fonts };
}

export function fontStatus(f) {
  return f.outfit && f.hanken ? "Outfit+Hanken Grotesk loaded" : `FALLBACK (Outfit ${f.outfit ? "ok" : "missing"}, Hanken ${f.hanken ? "ok" : "missing"})`;
}

export async function renderOne(browser, { template, data, out }) {
  const { context, page, size, fonts } = await openTemplate(browser, template, data);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await page.screenshot({ path: out, clip: { x: 0, y: 0, width: size.w, height: size.h }, type: "png" });
  await context.close();
  const measured = pngSize(out);
  const expected = { width: size.w * SCALE, height: size.h * SCALE };
  const ok = measured.width === expected.width && measured.height === expected.height;
  return { out, template, measured, expected, ok, fonts, bytes: fs.statSync(out).size };
}

function report(r) {
  const tag = r.ok ? "OK  " : "FAIL";
  const img = r.fonts.brokenImages.length ? ` | BROKEN IMAGES: ${r.fonts.brokenImages.join(", ")}` : "";
  console.log(`[render] ${tag} ${r.template.padEnd(9)} ${r.measured.width}x${r.measured.height} (expected ${r.expected.width}x${r.expected.height}) ${(r.bytes / 1024).toFixed(0)} KB | ${fontStatus(r.fonts)}${img} | ${r.out.replace(os.homedir(), "~")}`);
}

// ---------- Samples for --check (truthful copy from marketing/BRIEF.md; no stats, no customers) ----------
const SAMPLES = [
  { template: "carousel", name: "sample-carousel-1080x1350.png", data: { theme: "dark", slots: {
    eyebrow: "Introducing VENTRA", title: "Your AI *front office*", page: "01 / 07",
    body: "One place that answers calls, replies to enquiries and books the work in.",
    points: ["AI Receptionist: answers and books calls", "AI Setter: replies, qualifies and books enquiries", "Built for service businesses"],
    cta: "Swipe →", label: "" } } },
  { template: "post", name: "sample-post-1080x1080.png", data: { theme: "light", slots: {
    eyebrow: "Launching soon", title: "Fewer missed calls.\nMore *booked jobs*.",
    body: "VENTRA is an AI front office for service businesses.", cta: "Join the waitlist", label: "" } } },
  { template: "story", name: "sample-story-1080x1920.png", data: { theme: "dark", slots: {
    eyebrow: "AI Setter", title: "Replies in *minutes*,\nnot hours.",
    body: "It asks the right questions, offers times and books the enquiry in.",
    cta: "Join the waitlist", label: "Concept demonstration" } } },
  { template: "highlight", name: "sample-highlight-1080x1080.png", data: { slots: { name: "Start here" } } },
];

async function main(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
      args[k] = v;
    }
  }
  let jobs = [];
  if (args.check) {
    const dir = path.join(DELIVERABLES, "samples");
    jobs = SAMPLES.map((s) => ({ template: s.template, data: s.data, out: path.join(dir, s.name) }));
  } else if (args.spec) {
    const spec = JSON.parse(fs.readFileSync(expandHome(args.spec), "utf8"));
    const dir = expandHome(spec.outDir || path.join(DELIVERABLES, "renders"));
    jobs = spec.items.map((it, i) => ({
      template: it.template,
      data: { theme: it.theme, slots: it.slots || {} },
      out: path.join(dir, `${it.name || `${it.template}-${String(i + 1).padStart(2, "0")}`}.png`),
    }));
  } else if (args.template) {
    const data = args.data ? JSON.parse(args.data) : undefined;
    jobs = [{ template: args.template, data, out: expandHome(args.out || path.join(DELIVERABLES, "renders", `${args.template}.png`)) }];
  } else {
    console.log("Usage: node marketing/render.mjs --check | --template <carousel|post|story|highlight> --out <png> [--data <json>] | --spec <json>");
    return 2;
  }

  const { browser } = await launchBrowser();
  let failed = 0, fallback = 0;
  try {
    for (const job of jobs) {
      const r = await renderOne(browser, job);
      report(r);
      if (!r.ok || r.fonts.brokenImages.length) failed++;
      if (!(r.fonts.outfit && r.fonts.hanken)) fallback++;
    }
  } finally {
    await browser.close();
  }
  console.log(`[render] scale: CSS size x ${SCALE} = PNG pixels | ${jobs.length - failed}/${jobs.length} OK${fallback ? ` | ${fallback} with FALLBACK fonts (network needed for Google Fonts)` : ""}`);
  return failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => { console.error(e.message || e); process.exit(1); });
}
