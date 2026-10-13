// The Chainlink CRE bounty video (≤ 2:00): a real `cre workflow simulate` run, the broadcast
// report's tx and the oracle read back with cast, then the live NAV badge. Bella's voice.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const ff = (a) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...a], { stdio: "inherit" });
const dur = (f) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString().trim());
const L = Object.fromEntries(JSON.parse(readFileSync("work/vo-cre/lines.json", "utf8")).map((l) => [l.scene, l]));
const W = "work/crevid"; rmSync(W, { recursive: true, force: true }); mkdirSync(`${W}/f`, { recursive: true }); mkdirSync(`${W}/png`, { recursive: true });
const FPS = 30, LEAD = 0.35;
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const clip = (s) => (s.length > 112 ? `${s.slice(0, 111)}…` : s);
let sim = readFileSync("work/cre/simulate.log", "utf8").split("\n");
sim = sim.slice(0, sim.findIndex((l) => l.includes("Update available")));
while (sim.length && !sim.at(-1).trim()) sim.pop();
const cast = [
  ["$ cast call 0x2DF3…DC9f \"reportCount()(uint256)\"", "1"],
  ["$ cast call 0x2DF3…DC9f \"navOf(address)(…)\" 0xF344…e848   # $OPENAIX", "NAV 812.79 USD · implied 809.93 · premium −35 bps · band 200 bps · withinBand true · observedAt 1791894816"],
  ["$ cast receipt 0xc777646c…2b10 status blockNumber", "status 1 (success) · block 70,682,843"],
];

// Timeline.
const T0 = 3.0;
const s1 = { a: T0, len: LEAD + L.c1.seconds + 0.5 + L.c2.seconds + 0.6 };
const s2 = { a: s1.a + s1.len, len: LEAD + L.c3.seconds + 0.8 };
const s3 = { a: s2.a + s2.len, len: LEAD + L.c4.seconds + 1.0 };
const total = s3.a + s3.len;
const voice = [{ l: L.c1, at: s1.a + LEAD }, { l: L.c2, at: s1.a + LEAD + L.c1.seconds + 0.5 }, { l: L.c3, at: s2.a + LEAD }, { l: L.c4, at: s3.a + LEAD }];
console.log(`total ${total.toFixed(1)} s`);
if (total > 120) throw new Error("over 2:00");

const FONT = `<link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@700;800;900&family=JetBrains+Mono:wght@500;700&display=block" rel="stylesheet">`;
const CSS = `<style>html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#DCE7D5;font-family:"Inter Tight",sans-serif;color:#12150E}
.win{position:absolute;left:90px;top:120px;width:1740px;height:820px;border-radius:26px;background:#12150E;box-shadow:0 24px 70px rgba(18,21,14,.28);overflow:hidden}
.bar{height:56px;background:#1C2118;display:flex;align-items:center;gap:12px;padding:0 24px}.bar i{width:16px;height:16px;border-radius:8px;display:block}
.bar b{margin-left:18px;color:#8B9683;font:700 22px "JetBrains Mono",monospace}
.term{padding:22px 34px;font:500 23px/1.5 "JetBrains Mono",monospace;color:#DDE5D6;white-space:pre}
.p{color:#D6FF3D}.u{color:#9BE7B8}.ok{color:#0E9F6E;font-weight:700}.dim{color:#8B9683}
.k{position:absolute;top:44px;left:96px;font-size:26px;font-weight:800;letter-spacing:3px;color:#5C6655}
</style>`;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const lineClass = (l) => (/\[USER LOG\]/.test(l) ? "u" : /^✓/.test(l.trim()) ? "ok" : /^\s*(Binary|Config|HTTP)/.test(l) || /╭|╰|│/.test(l) ? "dim" : "");
async function frame(html, file) { await page.setContent(`${FONT}${CSS}${html}`, { waitUntil: "load" }); await page.screenshot({ path: file, type: "jpeg", quality: 92 }); }
await page.setContent(`${FONT}${CSS}<div></div>`); await page.evaluate(() => document.fonts.ready);

// Frames are rendered only when the picture changes, then held (a concat list with durations).
const list = [];
let last = null, lastAt = 0, idx = 0;
async function at(t, html) {
  if (html === last) return;
  if (last !== null) list.push({ file: `${W}/f/${idx - 1}.jpg`, d: t - lastAt });
  await frame(html, `${W}/f/${idx}.jpg`); idx++; last = html; lastAt = t;
}
const card = `<div style="position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding-left:140px;gap:26px">
  <div style="font-size:30px;font-weight:800;letter-spacing:4px;color:#5C6655">CHAINLINK CRE BOUNTY · JUNO</div>
  <div style="font-size:120px;font-weight:900;letter-spacing:-5px;line-height:1">juno-nav</div>
  <div style="font-size:46px;font-weight:800;color:#5C6655">Tracker NAV, attested on Monad by a CRE workflow</div></div>`;
await at(0, card);
const cmd = "cre workflow simulate juno-nav --target staging-settings --non-interactive --trigger-index 0";
const simWin = (typed, n) => `<div class="k">CRE CLI · SIMULATION (DRY RUN, NO BROADCAST)</div><div class="win"><div class="bar"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i><b>~/juno-monad/cre</b></div><div class="term"><span class="p">$ </span>${esc(cmd.slice(0, typed))}${typed < cmd.length ? "▌" : ""}\n${sim.slice(Math.max(0, n - 26), n).map((l) => `<span class="${lineClass(l)}">${esc(clip(l))}</span>`).join("\n")}</div></div>`;
for (let t = s1.a; t < s1.a + s1.len; t += 1 / 15) {
  const u = t - s1.a;
  const typed = Math.min(cmd.length, Math.floor(u * 40));
  const n = u < 2.6 ? 0 : Math.min(sim.length, Math.floor(((u - 2.6) / (L.c1.seconds - 1.5)) * sim.length) + 1);
  await at(t, simWin(typed, n));
}
const castWin = (k) => `<div class="k">ON MONAD TESTNET · THE BROADCAST REPORT (13 OCT)</div><div class="win"><div class="bar"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i><b>JunoNavOracle 0x2DF370b26CaDBCf94Df3e6766B9f7D91Bf36DC9f</b></div><div class="term"><span class="dim">testnet.monadvision.com/tx/0xc777646ce8fee4d90e5da2fa2244b8ea84ddde8e40bb02b914f0e0ea0abb2b10</span>\n<span class="ok">report delivered through MockKeystoneForwarder → JunoNavOracle.onReport ✓</span>\n\n${cast.slice(0, k).map(([c, o]) => `<span class="p">${esc(c)}</span>\n<span class="u">${esc(o)}</span>`).join("\n\n")}</div></div>`;
for (let k = 0; k <= cast.length; k++) await at(s2.a + (k === 0 ? 0 : LEAD + (k - 0.6) * (L.c3.seconds / cast.length)), castWin(k));
await at(s3.a, "__clip__");
list.push({ file: `${W}/f/${idx - 1}.jpg`, d: total - lastAt });
writeFileSync(`${W}/list.txt`, list.filter((x) => !x.file.endsWith(`${idx - 1}.jpg`) || x.d > 0).map((x) => `file '${path.resolve(x.file)}'\nduration ${x.d.toFixed(4)}`).join("\n") + `\nfile '${path.resolve(list.at(-1).file)}'`);
// Stills up to s3 as video.
ff(["-f", "concat", "-safe", "0", "-i", `${W}/list.txt`, "-vf", `fps=${FPS},format=yuv420p`, "-t", s3.a.toFixed(3), "-c:v", "libx264", "-crf", "18", `${W}/stills.mp4`]);
// The live badge, from the testnet take.
ff(["-ss", "151", "-i", "work/capture/take.webm", "-t", "8", "-an", "-vf", `crop=1280:720:0:0,scale=1920:1080:flags=lanczos,fps=${FPS},tpad=stop_mode=clone:stop_duration=${Math.max(0, s3.len - 8).toFixed(3)}`, "-t", s3.len.toFixed(3), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", `${W}/badge.mp4`]);
writeFileSync(`${W}/concat.txt`, [`${W}/stills.mp4`, `${W}/badge.mp4`].map((f) => `file '${path.resolve(f)}'`).join("\n"));
ff(["-f", "concat", "-safe", "0", "-i", `${W}/concat.txt`, "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-r", "30", `${W}/video.mp4`]);

const ains = voice.flatMap((v) => ["-i", v.l.file]);
const dl = voice.map((v, i) => `[${i}:a]adelay=${Math.round(v.at * 1000)}|${Math.round(v.at * 1000)}[a${i}]`).join(";");
ff([...ains, "-filter_complex", `${dl};${voice.map((_, i) => `[a${i}]`).join("")}amix=inputs=${voice.length}:normalize=0,apad,atrim=0:${total.toFixed(3)},loudnorm=I=-16:TP=-1.5:LRA=11[out]`, "-map", "[out]", "-ar", "48000", `${W}/voice.wav`]);
const caps = [];
for (const v of voice) { let cur = []; const fl = () => { if (cur.length) caps.push({ s: v.at + cur[0].start, e: v.at + cur.at(-1).end + 0.25, t: cur.map((w) => w.word).join(" ") }); cur = []; }; for (const w of v.l.words) { cur.push(w); if (cur.length >= 7 || (/[.?!:,]$/.test(w.word) && cur.length >= 3)) fl(); } fl(); }
for (let i = 0; i < caps.length - 1; i++) caps[i].e = Math.min(caps[i].e, caps[i + 1].s - 0.02);
const ts = (s) => { const ms = Math.round(s * 1000); return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`; };
writeFileSync("../docs/demo/bounty-cre.srt", caps.map((c, i) => `${i + 1}\n${ts(c.s)} --> ${ts(c.e)}\n${c.t}\n`).join("\n"));
for (const [i, c] of caps.entries()) { await page.setContent(`${FONT}<style>html,body{margin:0;background:transparent}#w{width:1920px;display:flex;justify-content:center}#b{display:inline-block;max-width:1500px;padding:14px 32px;border-radius:20px;background:#D6FF3D;color:#12150E;font:800 40px/1.25 "Inter Tight",sans-serif;text-align:center}</style><div id="w"><div id="b">${esc(c.t)}</div></div>`); await page.evaluate(() => document.fonts.ready); await page.locator("#w").screenshot({ path: `${W}/png/c${i}.png`, omitBackground: true }); }
await page.setContent(`${FONT}<style>html,body{margin:0;background:transparent}</style><div id="t" style="display:inline-flex;align-items:center;gap:12px;padding:12px 22px;border-radius:999px;background:#12150E;color:#D6FF3D;font:800 26px 'Inter Tight',sans-serif;letter-spacing:2px"><span style="width:14px;height:14px;border-radius:7px;background:#0E9F6E;display:inline-block"></span>LIVE · MONAD TESTNET</div>`); await page.evaluate(() => document.fonts.ready); await page.locator("#t").screenshot({ path: `${W}/png/live.png`, omitBackground: true });
await browser.close();
const inputs = ["-i", `${W}/video.mp4`, "-i", `${W}/voice.wav`, "-i", `${W}/png/live.png`, ...caps.flatMap((_, i) => ["-i", `${W}/png/c${i}.png`])];
let g = `[0:v][2:v]overlay=x=40:y=36:enable='between(t,${s3.a.toFixed(2)},${total.toFixed(2)})'[v0]`;
caps.forEach((c, i) => { g += `;[v${i}][${i + 3}:v]overlay=x=0:y=H-h-40:enable='between(t,${c.s.toFixed(3)},${c.e.toFixed(3)})'[v${i + 1}]`; });
writeFileSync(`${W}/graph.txt`, g);
ff([...inputs, "-filter_complex_script", `${W}/graph.txt`, "-map", `[v${caps.length}]`, "-map", "1:a", "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-t", total.toFixed(3), "../docs/demo/bounty-cre.mp4"]);
console.log(`docs/demo/bounty-cre.mp4 ${dur("../docs/demo/bounty-cre.mp4").toFixed(1)} s`);
