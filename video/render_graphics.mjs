// Renders graphics.html frame by frame (30 fps) into work/intro.mp4 and work/outro.mp4,
// with each scene's window taken from the voice lines' lengths.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const lines = JSON.parse(readFileSync("work/vo/lines.json", "utf8"));
const GAP = 0.35;
const intro = lines.filter((l) => l.kind === "intro");
const W = {};
let t = 0;
intro.forEach((l, i) => { W[`s${i + 1}`] = [t, t + l.seconds + GAP]; t += l.seconds + GAP; });
const outro = lines.find((l) => l.kind === "outro");
W.s5 = [0, outro.seconds + 1.2];
const FPS = 30;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(`file://${path.resolve("graphics.html")}`);
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(800);
for (const [name, mode, total] of [["intro", "intro", t], ["outro", "outro", W.s5[1]]]) {
  const dir = `work/frames-${name}`;
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  await page.evaluate(([w, m]) => { window.W = w; window.mode = m; }, [W, mode]);
  const n = Math.ceil(total * FPS);
  for (let f = 0; f < n; f++) {
    await page.evaluate((s) => window.render(s), f / FPS);
    await page.screenshot({ path: `${dir}/${String(f).padStart(5, "0")}.png` });
  }
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", `${dir}/%05d.png`, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", `work/${name}.mp4`]);
  rmSync(dir, { recursive: true, force: true });
  console.log(`work/${name}.mp4 ${total.toFixed(2)} s`);
}
await browser.close();
import("node:fs").then((fs) => fs.writeFileSync("work/graphics-windows.json", JSON.stringify(W, null, 2)));
