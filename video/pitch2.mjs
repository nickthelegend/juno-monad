// The pitch (75–90 s): kinetic type over Juno's palette, each phrase landing on the word that
// says it, one 3.6 s glimpse of the live receipt. Writes docs/demo/juno-pitch.mp4 + .srt.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const ff = (args) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { stdio: "inherit" });
const dur = (f) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString().trim());
const lines = JSON.parse(readFileSync("work/vo-pitch/lines.json", "utf8"));
const W = "work/pitch2"; rmSync(W, { recursive: true, force: true }); mkdirSync(`${W}/frames`, { recursive: true }); mkdirSync(`${W}/png`, { recursive: true });
const LEAD = 0.35, FPS = 30;
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(`file://${path.resolve("kinetic.html")}`);
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(800);
const trig = await page.evaluate(() => window.triggers());
const S = {}, timeline = [];
let t = 0, glimpse = null;
for (const sc of trig) {
  const l = lines.find((x) => x.scene === sc.id);
  const len = l.seconds + LEAD + (sc.id === "b8" ? 3.0 : 0.65);
  let from = 0;
  const times = sc.t.map((word) => {
    const i = l.words.findIndex((w, k) => k >= from && norm(w.word).startsWith(norm(word)));
    if (i < 0) return 0.2;
    from = i;
    return LEAD + l.words[i].start - 0.08;
  });
  S[sc.id] = { a: t, b: t + len, trig: times };
  timeline.push({ line: l, at: t + LEAD });
  if (sc.id === "b5") glimpse = t + times[1] + 0.6; // the receipt, as "Buy" lands
  t += len;
}
const total = t;
console.log(`total ${total.toFixed(1)} s`);
await page.evaluate((s) => { window.S = s; }, S);
const n = Math.ceil(total * FPS);
for (let f = 0; f < n; f++) {
  await page.evaluate((x) => window.render(x), f / FPS);
  await page.screenshot({ path: `${W}/frames/${String(f).padStart(5, "0")}.jpg`, type: "jpeg", quality: 92 });
}
ff(["-framerate", String(FPS), "-i", `${W}/frames/%05d.jpg`, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", `${W}/type.mp4`]);
rmSync(`${W}/frames`, { recursive: true, force: true });

// The one glimpse: the live receipt (Executed / Final, Kuru and Mera badges).
ff(["-ss", "50.4", "-i", "work/capture/take.webm", "-t", "3.6", "-an", "-vf", "crop=1280:720:0:0,scale=1920:1080:flags=lanczos,fps=30,fade=t=in:st=0:d=0.2,fade=t=out:st=3.4:d=0.2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", `${W}/glimpse.mp4`]);

const ains = timeline.flatMap((e) => ["-i", e.line.file]);
const delays = timeline.map((e, i) => `[${i}:a]adelay=${Math.round(e.at * 1000)}|${Math.round(e.at * 1000)}[a${i}]`).join(";");
ff([...ains, "-filter_complex", `${delays};${timeline.map((_, i) => `[a${i}]`).join("")}amix=inputs=${timeline.length}:normalize=0,apad,atrim=0:${total.toFixed(3)},loudnorm=I=-16:TP=-1.5:LRA=11[out]`, "-map", "[out]", "-ar", "48000", `${W}/voice.wav`]);

const caps = [];
for (const e of timeline) {
  let cur = [];
  const flush = () => { if (cur.length) caps.push({ start: e.at + cur[0].start, end: e.at + cur.at(-1).end + 0.25, text: cur.map((w) => w.word).join(" ") }); cur = []; };
  for (const w of e.line.words) { cur.push(w); if (cur.length >= 7 || (/[.?!:,]$/.test(w.word) && cur.length >= 3)) flush(); }
  flush();
}
for (let i = 0; i < caps.length - 1; i++) caps[i].end = Math.min(caps[i].end, caps[i + 1].start - 0.02);
const ts = (s) => { const ms = Math.round(s * 1000); return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`; };
writeFileSync("../docs/demo/juno-pitch.srt", caps.map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.end)}\n${c.text}\n`).join("\n"));
const CAP = `<link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@700&display=block" rel="stylesheet"><style>html,body{margin:0;background:transparent}#w{width:1920px;display:flex;justify-content:center}#b{display:inline-block;max-width:1500px;padding:14px 32px;border-radius:20px;background:#12150E;color:#F3F7EE;font:700 40px/1.25 "Inter Tight",sans-serif;text-align:center}</style>`;
for (const [i, c] of caps.entries()) {
  await page.setContent(`${CAP}<div id="w"><div id="b">${c.text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</div></div>`);
  await page.evaluate(() => document.fonts.ready);
  await page.locator("#w").screenshot({ path: `${W}/png/cap${i}.png`, omitBackground: true });
}
await page.setContent(`<link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@800&display=block" rel="stylesheet"><style>html,body{margin:0;background:transparent}</style><div id="t" style="display:inline-flex;align-items:center;gap:12px;padding:12px 22px;border-radius:999px;background:#12150E;color:#D6FF3D;font:800 26px 'Inter Tight',sans-serif;letter-spacing:2px"><span style="width:14px;height:14px;border-radius:7px;background:#0E9F6E;display:inline-block"></span>LIVE · MONAD TESTNET</div>`);
await page.evaluate(() => document.fonts.ready);
await page.locator("#t").screenshot({ path: `${W}/png/live.png`, omitBackground: true });
await browser.close();

const inputs = ["-i", `${W}/type.mp4`, "-i", `${W}/voice.wav`, "-itsoffset", glimpse.toFixed(3), "-i", `${W}/glimpse.mp4`, "-i", `${W}/png/live.png`, ...caps.flatMap((_, i) => ["-i", `${W}/png/cap${i}.png`])];
let g = `[0:v][2:v]overlay=enable='between(t,${glimpse.toFixed(3)},${(glimpse + 3.6).toFixed(3)})':eof_action=pass[g0];[g0][3:v]overlay=x=40:y=36:enable='between(t,${glimpse.toFixed(3)},${(glimpse + 3.6).toFixed(3)})'[v0]`;
caps.forEach((c, i) => { g += `;[v${i}][${i + 4}:v]overlay=x=0:y=H-h-56:enable='between(t,${c.start.toFixed(3)},${c.end.toFixed(3)})'[v${i + 1}]`; });
writeFileSync(`${W}/graph.txt`, g);
ff([...inputs, "-filter_complex_script", `${W}/graph.txt`, "-map", `[v${caps.length}]`, "-map", "1:a", "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-t", total.toFixed(3), "../docs/demo/juno-pitch.mp4"]);
console.log(`docs/demo/juno-pitch.mp4 ${dur("../docs/demo/juno-pitch.mp4").toFixed(1)} s, glimpse at ${glimpse.toFixed(1)} s`);
