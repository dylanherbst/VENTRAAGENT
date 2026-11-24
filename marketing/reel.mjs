#!/usr/bin/env node
// VENTRA reel renderer: animated HTML scene (marketing/templates/reel.html) -> MP4 (H.264, 1080x1920).
//
// How it works
//  1. Playwright opens reel.html at 540x960 CSS with deviceScaleFactor 2 (=> 1080x1920 frames).
//  2. Frames are captured deterministically: for every frame the page is seeked with window.__seek(t), then screenshotted.
//     (This replaces Playwright's real-time video recorder, which drops frames and only writes VP8/WebM.)
//  3. Captions are part of the HTML scene, so they are burned into every frame (no ffmpeg drawtext/libass needed).
//  4. Encoding to MP4/H.264 (faststart), in this order:
//       a) ffmpeg: $FFMPEG_PATH, `ffmpeg` on PATH, /opt/homebrew/bin, /usr/local/bin, or marketing/node_modules/ffmpeg-static
//          (libx264 High, yuv420p, CRF 18, plus a silent AAC track for Instagram compatibility)
//       b) fallback without ffmpeg: Chromium WebCodecs H.264 encoder (hardware VideoToolbox on macOS), muxed into a
//          faststart MP4 by the small muxer in this file (video only, no audio track). It fails loudly if the encoder
//          reorders frames (B-frames), because this muxer writes no ctts box.
//  5. The MP4 is probed with a built-in MP4 box reader (codec, size, fps, duration), so ffprobe is not required.
//
// Usage
//   node marketing/reel.mjs --check                 5 s sample -> ~/Developer/VENTRA-MARKETING/samples/sample-reel-1080x1920.mp4
//   node marketing/reel.mjs --spec <reel.json>      { "out": "~/.../reel.mp4", "fps": 30, "duration": 30, "theme": "dark",
//                                                    "label": "Concept demonstration", "scenes": [...], "captions": [...] }
//   node marketing/reel.mjs --probe <file.mp4>
//   --keep-frames keeps the PNG frames (path printed); --encoder webcodecs forces the fallback encoder.
// Limits: duration <= 60 s, fps 24-30. Capture speed is roughly 0.5 s per 1080x1920 frame on this Mac.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { launchBrowser, openTemplate, pngSize, fontStatus, DELIVERABLES, SCALE, expandHome } from "./render.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ---------- sample (truthful copy; labelled as a concept demonstration) ----------
const SAMPLE = {
  out: path.join(DELIVERABLES, "samples", "sample-reel-1080x1920.mp4"),
  fps: 30,
  duration: 5,
  theme: "dark",
  label: "Concept demonstration",
  scenes: [
    { start: 0, end: 2.6, eyebrow: "5:02 pm", title: "A call comes in.\nYou are *on the tools*." },
    { start: 2.4, end: 5.2, eyebrow: "AI Receptionist", title: "It gets *answered*.", body: "The caller gets help and a booking time." },
  ],
  captions: [
    { start: 0.2, end: 2.5, text: "A customer calls while you are busy." },
    { start: 2.6, end: 4.95, text: "VENTRA answers and books the job." },
  ],
};

// ---------- encoder a) ffmpeg ----------
function findFfmpeg() {
  const cands = [];
  if (process.env.FFMPEG_PATH) cands.push(process.env.FFMPEG_PATH);
  for (const dir of (process.env.PATH || "").split(path.delimiter)) if (dir) cands.push(path.join(dir, "ffmpeg"));
  cands.push("/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg");
  try { cands.push(createRequire(path.join(HERE, "package.json"))("ffmpeg-static")); } catch {}
  return cands.find((c) => c && fs.existsSync(c)) || null;
}

function encodeFfmpeg(bin, framesDir, fps, out) {
  const args = ["-y", "-hide_banner", "-loglevel", "error",
    "-framerate", String(fps), "-i", path.join(framesDir, "frame_%05d.png"),
    "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-shortest",
    "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "medium", "-r", String(fps),
    "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", out];
  const r = spawnSync(bin, args, { encoding: "utf8" });
  return { ok: r.status === 0, err: `exit ${r.status}: ${(r.stderr || "").trim()}` };
}

// ---------- encoder b) Chromium WebCodecs + MP4 muxer ----------
async function encodeWebCodecs(framesDir, fps, w, h, out, workDir) {
  const files = fs.readdirSync(framesDir).filter((f) => f.endsWith(".png")).sort();
  const { browser } = await launchBrowser({ quiet: true });
  try {
    const html = path.join(workDir, "encoder.html");
    fs.writeFileSync(html, "<!doctype html><meta charset=utf-8><title>encoder</title>");
    const page = await browser.newPage();
    await page.goto(pathToFileURL(html).href);
    const init = await page.evaluate(async ({ w, h, fps }) => {
      if (typeof VideoEncoder === "undefined") return { ok: false, err: "WebCodecs VideoEncoder not available" };
      const config = { codec: "avc1.640028", width: w, height: h, bitrate: 12_000_000, framerate: fps, avc: { format: "avc" }, latencyMode: "quality" };
      const sup = await VideoEncoder.isConfigSupported(config);
      if (!sup.supported) return { ok: false, err: "H.264 1080x1920 not supported by this Chromium" };
      window.__chunks = [];
      window.__desc = null;
      window.__err = null;
      window.__enc = new VideoEncoder({
        output: (chunk, meta) => {
          const b = new Uint8Array(chunk.byteLength);
          chunk.copyTo(b);
          if (meta && meta.decoderConfig && meta.decoderConfig.description && !window.__desc) {
            const d = meta.decoderConfig.description;
            window.__desc = (ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength) : new Uint8Array(d)).slice();
          }
          window.__chunks.push({ key: chunk.type === "key", ts: chunk.timestamp, data: b });
        },
        error: (e) => { window.__err = String(e); },
      });
      window.__enc.configure(config);
      return { ok: true };
    }, { w, h, fps });
    if (!init.ok) return { ok: false, err: init.err };

    const b64 = (u8) => Buffer.from(u8).toString("base64");
    const samples = [];
    let desc = null;
    const drain = async () => {
      const r = await page.evaluate(() => {
        const c = window.__chunks.splice(0);
        const toB64 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
        return { err: window.__err, desc: window.__desc ? toB64(window.__desc) : null, chunks: c.map((x) => ({ key: x.key, ts: x.ts, data: toB64(x.data) })) };
      });
      if (r.err) throw new Error(`WebCodecs encoder error: ${r.err}`);
      if (r.desc && !desc) desc = Buffer.from(r.desc, "base64");
      for (const c of r.chunks) samples.push({ key: c.key, ts: c.ts, data: Buffer.from(c.data, "base64") });
    };
    for (let i = 0; i < files.length; i++) {
      const png = b64(fs.readFileSync(path.join(framesDir, files[i])));
      await page.evaluate(async ({ png, i, fps }) => {
        const bin = atob(png);
        const u8 = new Uint8Array(bin.length);
        for (let k = 0; k < bin.length; k++) u8[k] = bin.charCodeAt(k);
        const bmp = await createImageBitmap(new Blob([u8], { type: "image/png" }));
        const frame = new VideoFrame(bmp, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
        while (window.__enc.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 5));
        window.__enc.encode(frame, { keyFrame: i % (fps * 2) === 0 });
        frame.close();
        bmp.close();
      }, { png, i, fps });
      if (i % 10 === 9) await drain();
    }
    await page.evaluate(() => window.__enc.flush());
    await drain();
    if (!desc) return { ok: false, err: "encoder returned no avcC decoder description" };
    if (samples.length !== files.length) return { ok: false, err: `encoder returned ${samples.length} chunks for ${files.length} frames` };
    for (let i = 1; i < samples.length; i++) {
      if (samples[i].ts <= samples[i - 1].ts) return { ok: false, err: "encoder reordered frames (B-frames); this muxer has no ctts support" };
    }
    if (!samples[0].key) return { ok: false, err: "first chunk is not a key frame" };
    fs.writeFileSync(out, muxMp4({ samples, avcC: desc, w, h, fps }));
    return { ok: true };
  } finally {
    await browser.close();
  }
}

// Minimal faststart MP4 writer for one H.264 track (ISO/IEC 14496-12 / 14496-15).
function muxMp4({ samples, avcC, w, h, fps }) {
  const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };
  const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
  const box = (type, ...parts) => { const body = Buffer.concat(parts); return Buffer.concat([u32(8 + body.length), Buffer.from(type, "ascii"), body]); };
  const full = (type, version, flags, ...parts) => box(type, u32(((version & 0xff) << 24) | (flags & 0xffffff)), ...parts);
  const matrix = Buffer.concat([0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000].map(u32));
  const zeros = (n) => Buffer.alloc(n);

  const TS = 90000;
  const delta = Math.round(TS / fps);
  const n = samples.length;
  const mediaDur = n * delta;
  const movieDur = Math.round((n / fps) * 1000);

  const avc1 = box("avc1",
    zeros(6), u16(1),                 // reserved, data_reference_index
    zeros(16),                        // pre_defined/reserved
    u16(w), u16(h),
    u32(0x00480000), u32(0x00480000), // 72 dpi
    zeros(4), u16(1),                 // reserved, frame_count
    Buffer.concat([Buffer.from([6]), Buffer.from("VENTRA"), zeros(25)]), // compressorname (32 bytes)
    u16(0x0018), u16(0xffff),
    box("avcC", avcC));

  const stbl = (chunkOffset) => box("stbl",
    full("stsd", 0, 0, u32(1), avc1),
    full("stts", 0, 0, u32(1), u32(n), u32(delta)),
    full("stss", 0, 0, u32(samples.filter((s) => s.key).length), ...samples.map((s, i) => (s.key ? u32(i + 1) : null)).filter(Boolean)),
    full("stsc", 0, 0, u32(1), u32(1), u32(n), u32(1)),
    full("stsz", 0, 0, u32(0), u32(n), ...samples.map((s) => u32(s.data.length))),
    full("stco", 0, 0, u32(1), u32(chunkOffset)));

  const moov = (chunkOffset) => box("moov",
    full("mvhd", 0, 0, u32(0), u32(0), u32(1000), u32(movieDur), u32(0x00010000), u16(0x0100), zeros(10), matrix, zeros(24), u32(2)),
    box("trak",
      full("tkhd", 0, 3, u32(0), u32(0), u32(1), u32(0), u32(movieDur), zeros(8), u16(0), u16(0), u16(0), u16(0), matrix, u32(w * 65536), u32(h * 65536)),
      box("mdia",
        full("mdhd", 0, 0, u32(0), u32(0), u32(TS), u32(mediaDur), u16(0x55c4), u16(0)),
        full("hdlr", 0, 0, u32(0), Buffer.from("vide"), zeros(12), Buffer.from("VideoHandler\0")),
        box("minf",
          full("vmhd", 0, 1, u16(0), zeros(6)),
          box("dinf", full("dref", 0, 0, u32(1), full("url ", 0, 1))),
          stbl(chunkOffset)))));

  const ftyp = box("ftyp", Buffer.from("isom"), u32(512), Buffer.from("isomiso2avc1mp41"));
  const moovSize = moov(0).length;
  const mdatData = Buffer.concat(samples.map((s) => s.data));
  const offset = ftyp.length + moovSize + 8;
  return Buffer.concat([ftyp, moov(offset), u32(8 + mdatData.length), Buffer.from("mdat"), mdatData]);
}

// ---------- minimal MP4 probe (replaces ffprobe for verification) ----------
export function probeMp4(file) {
  const buf = fs.readFileSync(file);
  const info = { file, bytes: buf.length, tracks: [] };
  const CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "stbl", "edts", "udta"]);
  function walk(start, end, track) {
    let p = start;
    while (p + 8 <= end) {
      let size = buf.readUInt32BE(p);
      const type = buf.toString("ascii", p + 4, p + 8);
      let hdr = 8;
      if (size === 1) { size = Number(buf.readBigUInt64BE(p + 8)); hdr = 16; }
      else if (size === 0) size = end - p;
      if (size < hdr || p + size > end) break;
      const body = p + hdr;
      if (type === "mvhd") {
        const v = buf[body];
        const ts = v === 1 ? buf.readUInt32BE(body + 20) : buf.readUInt32BE(body + 12);
        const du = v === 1 ? Number(buf.readBigUInt64BE(body + 24)) : buf.readUInt32BE(body + 16);
        info.duration = du / ts;
      } else if (type === "trak") {
        const t = {};
        info.tracks.push(t);
        walk(body, p + size, t);
      } else if (type === "tkhd" && track) {
        const off = body + (buf[body] === 1 ? 88 : 76);
        track.width = buf.readUInt32BE(off) / 65536;
        track.height = buf.readUInt32BE(off + 4) / 65536;
      } else if (type === "mdhd" && track) {
        const v = buf[body];
        track.timescale = v === 1 ? buf.readUInt32BE(body + 20) : buf.readUInt32BE(body + 12);
        const du = v === 1 ? Number(buf.readBigUInt64BE(body + 24)) : buf.readUInt32BE(body + 16);
        track.duration = du / track.timescale;
      } else if (type === "hdlr" && track) {
        track.handler = buf.toString("ascii", body + 8, body + 12);
      } else if (type === "stsd" && track) {
        track.codec = buf.toString("ascii", body + 12, body + 16);
        if (track.codec === "avc1" || track.codec === "hvc1") {
          track.codedWidth = buf.readUInt16BE(body + 40);
          track.codedHeight = buf.readUInt16BE(body + 42);
          const avcC = buf.indexOf("avcC", body);
          if (avcC > 0 && avcC < p + size) {
            const prof = buf[avcC + 5];
            track.profile = ({ 66: "Baseline", 77: "Main", 100: "High" })[prof] || `profile ${prof}`;
            track.level = buf[avcC + 7] / 10;
          }
        }
      } else if (type === "stts" && track) {
        const count = buf.readUInt32BE(body + 4);
        let frames = 0;
        for (let i = 0; i < count; i++) frames += buf.readUInt32BE(body + 8 + i * 8);
        track.samples = frames;
      } else if (CONTAINERS.has(type)) {
        walk(body, p + size, track);
      }
      p += size;
    }
  }
  walk(0, buf.length, null);
  for (const t of info.tracks) if (t.samples && t.duration) t.fps = Math.round((t.samples / t.duration) * 100) / 100;
  info.faststart = buf.indexOf("moov") < buf.indexOf("mdat");
  return info;
}

function describe(info) {
  const v = info.tracks.find((t) => t.handler === "vide") || {};
  const a = info.tracks.find((t) => t.handler === "soun");
  return `${v.codec || "?"}${v.profile ? ` (H.264 ${v.profile}${v.level ? ` L${v.level}` : ""})` : ""} ${v.codedWidth || v.width}x${v.codedHeight || v.height} @ ${v.fps} fps, ${info.duration?.toFixed(2)} s, ${v.samples} frames, ${(info.bytes / 1024).toFixed(0)} KB, audio: ${a ? a.codec : "none"}, faststart: ${info.faststart ? "yes" : "no"}`;
}

// ---------- main ----------
async function renderReel(spec, { keepFrames = false, encoder = "auto" } = {}) {
  const fps = Math.round(spec.fps || 30);
  const duration = Number(spec.duration || 5);
  if (fps < 24 || fps > 30) throw new Error("fps must be 24-30");
  if (!(duration > 0 && duration <= 60)) throw new Error("duration must be > 0 and <= 60 s");
  const out = expandHome(spec.out);
  fs.mkdirSync(path.dirname(out), { recursive: true });

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "ventra-reel-"));
  const framesDir = path.join(work, "frames");
  fs.mkdirSync(framesDir);

  const { browser } = await launchBrowser();
  const total = Math.round(duration * fps);
  let size;
  try {
    const data = { theme: spec.theme, duration, label: spec.label ?? "", scenes: spec.scenes || [], captions: spec.captions || [] };
    const opened = await openTemplate(browser, "reel", data);
    console.log(`[reel] fonts: ${fontStatus(opened.fonts)}${opened.fonts.brokenImages.length ? ` | BROKEN IMAGES: ${opened.fonts.brokenImages.join(", ")}` : ""}`);
    if (!spec.label) console.log("[reel] WARNING: no label set. Use \"Concept demonstration\" unless this is real product footage.");
    const t0 = Date.now();
    for (let i = 0; i < total; i++) {
      await opened.page.evaluate((t) => window.__seek(t), i / fps);
      await opened.page.screenshot({ path: path.join(framesDir, `frame_${String(i).padStart(5, "0")}.png`), clip: { x: 0, y: 0, width: opened.size.w, height: opened.size.h } });
    }
    size = pngSize(path.join(framesDir, "frame_00000.png"));
    console.log(`[reel] captured ${total} frames at ${size.width}x${size.height} (CSS ${opened.size.w}x${opened.size.h} x ${SCALE}) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    await opened.context.close();
  } finally {
    await browser.close();
  }

  let used = null;
  const ff = encoder === "webcodecs" ? null : findFfmpeg();
  if (ff) {
    const r = encodeFfmpeg(ff, framesDir, fps, out);
    if (r.ok) used = `ffmpeg libx264 (${ff})`;
    else console.log(`[reel] ffmpeg failed: ${r.err}`);
  } else if (encoder !== "webcodecs") {
    console.log("[reel] MISSING: ffmpeg not found ($FFMPEG_PATH, PATH, /opt/homebrew/bin, /usr/local/bin, marketing/node_modules/ffmpeg-static). Using the WebCodecs fallback.");
  }
  if (!used) {
    const r = await encodeWebCodecs(framesDir, fps, size.width, size.height, out, work);
    if (!r.ok) {
      console.log(`[reel] FAILED: WebCodecs fallback: ${r.err}`);
      console.log(`[reel] frames kept at ${framesDir}`);
      return 1;
    }
    used = "Chromium WebCodecs H.264 + built-in MP4 muxer (fallback, no audio track)";
  }
  if (keepFrames) console.log(`[reel] frames kept at ${framesDir}`);
  else fs.rmSync(work, { recursive: true, force: true });

  const info = probeMp4(out);
  const v = info.tracks.find((t) => t.handler === "vide") || {};
  const w = v.codedWidth || v.width, h = v.codedHeight || v.height;
  const ok = v.codec === "avc1" && w === 1080 && h === 1920 && Math.abs(info.duration - duration) < 0.2;
  console.log(`[reel] encoder: ${used}`);
  console.log(`[reel] ${ok ? "OK  " : "FAIL"} ${out.replace(os.homedir(), "~")} | ${describe(info)}`);
  return ok ? 0 : 1;
}

async function main(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const k = argv[i].slice(2);
    args[k] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
  }
  const opts = { keepFrames: !!args["keep-frames"], encoder: args.encoder || "auto" };
  if (args.probe) { console.log(describe(probeMp4(expandHome(args.probe)))); return 0; }
  if (args.check) return renderReel(SAMPLE, opts);
  if (args.spec) {
    const spec = JSON.parse(fs.readFileSync(expandHome(args.spec), "utf8"));
    if (!spec.out) throw new Error("spec.out is required");
    return renderReel(spec, opts);
  }
  console.log("Usage: node marketing/reel.mjs --check | --spec <reel.json> [--keep-frames] [--encoder webcodecs] | --probe <file.mp4>");
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(e.message || e); process.exit(1); });
}
