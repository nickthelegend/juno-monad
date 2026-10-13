// Cuts the take to the voice, adds intro/outro, captions (from word timings) and the LIVE tag,
// mixes the narration at -16 LUFS, and writes docs/demo/juno-metropolis.mp4 + .srt.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const ff = (args) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { stdio: "inherit" });
const dur = (f) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString().trim());
const lines = JSON.parse(readFileSync("work/vo/lines.json", "utf8"));
const marks = JSON.parse(readFileSync("work/marks.json", "utf8"));
const W = JSON.parse(readFileSync("work/graphics-windows.json", "utf8"));
mkdirSync("work/seg", { recursive: true }); mkdirSync("work/cap", { recursive: true });
const LEAD = 0.35, TAIL = 0.9, MAXSPEED = 1.6, FPS = 30;

// 1. Timeline: intro, demo scenes, outro. Each entry: video file, length, voice line and its offset.
const timeline = [];
const introLen = dur("work/intro.mp4");
lines.filter((l) => l.kind === "intro").forEach((l, i) => timeline.push({ line: l, at: W[`s${i + 1}`][0] + 0.15 }));
let cursor = introLen;
const demo = lines.filter((l) => l.kind === "demo");
const order = demo.map((l) => l.scene);
const segs = [];
for (const [i, l] of demo.entries()) {
  const start = marks[l.scene];
  const end = marks[order[i + 1]] ?? marks.end ?? marks.failed;
  if (start === undefined || end === undefined) throw new Error(`no footage for ${l.scene}`);
  const L = end - start;
  const want = l.seconds + LEAD + TAIL;
  const speed = L > want ? Math.min(L / want, l.scene === "d8" ? 2.5 : MAXSPEED) : 1;
  const D = Math.max(L / speed, want);
  const out = `work/seg/${l.scene}.mp4`;
  ff(["-ss", String(start), "-i", "work/capture/take.webm", "-t", String(L), "-an",
      "-vf", `crop=1280:720:0:0,scale=1920:1080:flags=lanczos,setpts=PTS/${speed.toFixed(4)},fps=${FPS},tpad=stop_mode=clone:stop_duration=${Math.max(0, D - L / speed).toFixed(3)}`,
      "-t", D.toFixed(3), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", out]);
  segs.push(out);
  timeline.push({ line: l, at: cursor + LEAD, live: [cursor, cursor + D] });
  console.log(`${l.scene}: footage ${L.toFixed(1)} s ×${speed.toFixed(2)} → ${D.toFixed(1)} s (voice ${l.seconds.toFixed(1)} s)`);
  cursor += D;
}
const outroAt = cursor;
const outroLine = lines.find((l) => l.kind === "outro");
timeline.push({ line: outroLine, at: outroAt + 0.3 });
const total = outroAt + dur("work/outro.mp4");
console.log(`total ${total.toFixed(1)} s`);
if (total > 180) console.log("WARNING: over 3:00");

// 2. Video: concat.
writeFileSync("work/concat.txt", ["work/intro.mp4", ...segs, "work/outro.mp4"].map((f) => `file '${path.resolve(f)}'`).join("\n"));
ff(["-f", "concat", "-safe", "0", "-i", "work/concat.txt", "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-r", "30", "work/video.mp4"]);

// 3. Audio: each line at its time, mixed, normalised.
const ains = timeline.flatMap((e) => ["-i", e.line.file]);
const delays = timeline.map((e, i) => `[${i}:a]adelay=${Math.round(e.at * 1000)}|${Math.round(e.at * 1000)}[a${i}]`).join(";");
ff([...ains, "-filter_complex", `${delays};${timeline.map((_, i) => `[a${i}]`).join("")}amix=inputs=${timeline.length}:normalize=0,apad,atrim=0:${total.toFixed(3)},loudnorm=I=-16:TP=-1.5:LRA=11[out]`, "-map", "[out]", "-ar", "48000", "work/voice.wav"]);

// 4. Captions: chunks of up to 7 words from the word timings → SRT and PNG overlays.
const caps = [];
for (const e of timeline) {
  let cur = [];
  const flush = () => { if (cur.length) caps.push({ start: e.at + cur[0].start, end: e.at + cur.at(-1).end + 0.25, text: cur.map((w) => w.word).join(" ") }); cur = []; };
  for (const w of e.line.words) {
    cur.push(w);
    if (cur.length >= 7 || (/[.?!:,]$/.test(w.word) && cur.length >= 3)) flush();
  }
  flush();
}
caps.sort((a, b) => a.start - b.start);
for (let i = 0; i < caps.length - 1; i++) caps[i].end = Math.min(caps[i].end, caps[i + 1].start - 0.02);
const ts = (s) => { const ms = Math.round(s * 1000); const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, sec = Math.floor(ms / 1000) % 60; return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`; };
mkdirSync("../docs/demo", { recursive: true });
writeFileSync("../docs/demo/juno-metropolis.srt", caps.map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.end)}\n${c.text}\n`).join("\n"));

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 200 } });
const style = `<link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@700;800&display=block" rel="stylesheet"><style>html,body{margin:0;background:transparent}#b{display:inline-block;max-width:1500px;padding:16px 34px;border-radius:22px;background:rgba(18,21,14,.86);color:#F3F7EE;font:700 42px/1.25 "Inter Tight",system-ui;letter-spacing:-.5px;text-align:center}#w{width:1920px;display:flex;justify-content:center}</style>`;
for (const [i, c] of caps.entries()) {
  await page.setContent(`${style}<div id="w"><div id="b">${c.text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</div></div>`);
  await page.evaluate(() => document.fonts.ready);
  await page.locator("#w").screenshot({ path: `work/cap/${i}.png`, omitBackground: true });
}
await page.setContent(`${style}<div style="display:inline-flex;align-items:center;gap:12px;padding:12px 22px;border-radius:999px;background:#12150E;color:#D6FF3D;font:800 26px 'Inter Tight',system-ui;letter-spacing:2px"><span style="width:14px;height:14px;border-radius:7px;background:#0E9F6E;display:inline-block"></span>LIVE · MONAD TESTNET</div>`);
await page.evaluate(() => document.fonts.ready);
await page.locator("div").first().screenshot({ path: "work/cap/live.png", omitBackground: true });
await browser.close();

// 5. Overlays: the LIVE tag across the demo, each caption in its window; then mux.
const liveFrom = introLen, liveTo = outroAt;
const inputs = ["-i", "work/video.mp4", "-i", "work/voice.wav", "-i", "work/cap/live.png", ...caps.flatMap((_, i) => ["-i", `work/cap/${i}.png`])];
let graph = `[0:v][2:v]overlay=x=40:y=36:enable='between(t,${liveFrom.toFixed(2)},${liveTo.toFixed(2)})'[v0]`;
caps.forEach((c, i) => { graph += `;[v${i}][${i + 3}:v]overlay=x=0:y=H-h-70:enable='between(t,${c.start.toFixed(3)},${c.end.toFixed(3)})'[v${i + 1}]`; });
writeFileSync("work/graph.txt", graph);
ff([...inputs, "-filter_complex_script", "work/graph.txt", "-map", `[v${caps.length}]`, "-map", "1:a", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-t", total.toFixed(3), "../docs/demo/juno-metropolis.mp4"]);
console.log(`docs/demo/juno-metropolis.mp4 ${dur("../docs/demo/juno-metropolis.mp4").toFixed(1)} s, ${caps.length} captions`);
