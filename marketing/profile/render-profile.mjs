#!/usr/bin/env node
// VENTRA Instagram profile package renderer (task M-1).
// Reuses the shared pipeline in marketing/render.mjs (Playwright resolution, PNG measurement, font check, scale 2)
// for the two profile templates in this folder, which render.mjs does not list in its SIZES table.
//
//   node marketing/profile/render-profile.mjs           -> ~/Developer/VENTRA-MARKETING/profile/
//   node marketing/profile/render-profile.mjs --out <dir>
//
// Outputs: profile-picture.png (1080x1080) and five highlight covers (1080x1920).
// Exit code 1 if any PNG has the wrong size, a broken image, or fallback fonts.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { launchBrowser, pngSize, fontStatus, SCALE, DELIVERABLES, expandHome } from "../render.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const JOBS = [
  { file: "profile-picture.html", w: 540, h: 540, name: "profile-picture.png", data: {} },
  { file: "highlight-cover.html", w: 540, h: 960, name: "highlight-01-start-here.png", data: { icon: "mark", slots: { name: "Start here" } } },
  { file: "highlight-cover.html", w: 540, h: 960, name: "highlight-02-ai-setter.png", data: { icon: "chat", slots: { name: "AI Setter" } } },
  { file: "highlight-cover.html", w: 540, h: 960, name: "highlight-03-ai-receptionist.png", data: { icon: "phone", slots: { name: "AI Receptionist" } } },
  { file: "highlight-cover.html", w: 540, h: 960, name: "highlight-04-demos.png", data: { icon: "play", slots: { name: "Demos" } } },
  { file: "highlight-cover.html", w: 540, h: 960, name: "highlight-05-updates.png", data: { icon: "spark", slots: { name: "Updates" } } },
];

async function renderJob(browser, job, outDir) {
  const context = await browser.newContext({ viewport: { width: job.w, height: job.h }, deviceScaleFactor: SCALE });
  const page = await context.newPage();
  await page.addInitScript((d) => { window.__VENTRA__ = d; }, job.data);
  await page.goto(pathToFileURL(path.join(HERE, job.file)).href, { waitUntil: "networkidle", timeout: 30000 })
    .catch(async () => { await page.waitForLoadState("load").catch(() => {}); });
  await page.waitForSelector("html[data-filled='1']", { timeout: 10000 });
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(['600 40px "Outfit"', '700 16px "Hanken Grotesk"'].map((f) => document.fonts.load(f).catch(() => null)));
    const loaded = [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/"/g, ""));
    const imgs = [...document.images].filter((i) => i.offsetParent !== null);
    await Promise.all(imgs.map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; }))));
    return {
      outfit: loaded.includes("Outfit"),
      hanken: loaded.includes("Hanken Grotesk"),
      brokenImages: imgs.filter((i) => !i.naturalWidth).map((i) => i.getAttribute("src")),
    };
  });
  const out = path.join(outDir, job.name);
  await page.screenshot({ path: out, clip: { x: 0, y: 0, width: job.w, height: job.h }, type: "png" });
  await context.close();
  const measured = pngSize(out);
  const expected = { width: job.w * SCALE, height: job.h * SCALE };
  const sizeOk = measured.width === expected.width && measured.height === expected.height;
  // The profile picture has no text, so only the logo image matters there.
  const needsFonts = job.file !== "profile-picture.html";
  const fontsOk = !needsFonts || (fonts.outfit && fonts.hanken);
  const ok = sizeOk && fontsOk && fonts.brokenImages.length === 0;
  const img = fonts.brokenImages.length ? ` | BROKEN IMAGES: ${fonts.brokenImages.join(", ")}` : "";
  console.log(`[profile] ${ok ? "OK  " : "FAIL"} ${job.name.padEnd(34)} ${measured.width}x${measured.height} (expected ${expected.width}x${expected.height}) ${(fs.statSync(out).size / 1024).toFixed(0)} KB | ${needsFonts ? fontStatus(fonts) : "no text"}${img}`);
  return ok;
}

async function main(argv) {
  const i = argv.indexOf("--out");
  const outDir = i >= 0 && argv[i + 1] ? expandHome(argv[i + 1]) : path.join(DELIVERABLES, "profile");
  fs.mkdirSync(outDir, { recursive: true });
  const { browser } = await launchBrowser();
  let failed = 0;
  try {
    for (const job of JOBS) if (!(await renderJob(browser, job, outDir))) failed++;
  } finally {
    await browser.close();
  }
  console.log(`[profile] ${JOBS.length - failed}/${JOBS.length} OK -> ${outDir.replace(os.homedir(), "~")}`);
  return failed ? 1 : 0;
}

main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(e.message || e); process.exit(1); });
