// One continuous take of the live app on Monad testnet, driven like a person:
// an injected cursor glides to each target and ripples on click. Writes
// work/capture/*.webm and work/marks.json (scene → seconds into the take).
import { mkdirSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const APP = process.env.APP ?? "https://juno-monad-app.vercel.app";
mkdirSync("work/capture", { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 1.5,
  recordVideo: { dir: "work/capture", size: { width: 1920, height: 1080 } },
});
await context.addInitScript(() => {
  window.localStorage.setItem("juno.coach.feed.v1", "done");
  const make = () => {
    if (document.getElementById("__cur")) return;
    const c = document.createElement("div");
    c.id = "__cur";
    c.innerHTML = '<svg width="30" height="30" viewBox="0 0 24 24"><path d="M5 3l14 8-6.2 1.6L10 19z" fill="#12150E" stroke="#FFFFFF" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, { position: "fixed", left: "0", top: "0", zIndex: "2147483647", pointerEvents: "none", filter: "drop-shadow(0 2px 3px rgba(0,0,0,.35))", transform: `translate(${window.__cx ?? 640}px, ${window.__cy ?? 360}px)` });
    const r = document.createElement("div");
    r.id = "__ripple";
    Object.assign(r.style, { position: "fixed", width: "40px", height: "40px", borderRadius: "50%", border: "4px solid #D6FF3D", boxShadow: "0 0 0 2px #12150E", pointerEvents: "none", zIndex: "2147483646", opacity: "0" });
    document.documentElement.append(c, r);
    addEventListener("mousemove", (e) => { window.__cx = e.clientX - 5; window.__cy = e.clientY - 3; c.style.transform = `translate(${e.clientX - 5}px, ${e.clientY - 3}px)`; }, true);
    addEventListener("mousedown", (e) => {
      r.style.transition = "none"; r.style.left = `${e.clientX - 20}px`; r.style.top = `${e.clientY - 20}px`; r.style.opacity = "1"; r.style.transform = "scale(.4)";
      requestAnimationFrame(() => requestAnimationFrame(() => { r.style.transition = "transform .45s ease-out, opacity .45s ease-out"; r.style.transform = "scale(1.5)"; r.style.opacity = "0"; }));
    }, true);
  };
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", make); else make();
});
const cdp0 = { context };
const page = await context.newPage();
const t0 = Date.now();
const cdp = await context.newCDPSession(page);
await cdp.send("WebAuthn.enable");
await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true } });

const marks = {};
const mark = (id) => { marks[id] = (Date.now() - t0) / 1000; console.log(`${id} @ ${marks[id].toFixed(1)}s`); };
const wait = (ms) => page.waitForTimeout(ms);
let pos = { x: 640, y: 360 };
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
async function glide(x, y, ms = 700) {
  const from = { ...pos };
  const n = Math.max(12, Math.round(ms / 16));
  for (let i = 1; i <= n; i++) {
    const k = ease(i / n);
    await page.mouse.move(from.x + (x - from.x) * k, from.y + (y - from.y) * k);
    await wait(ms / n);
  }
  pos = { x, y };
}
async function point(locator, ms) {
  const loc = locator.first();
  await loc.waitFor({ state: "visible", timeout: 30_000 });
  await loc.scrollIntoViewIfNeeded().catch(() => undefined);
  const b = await loc.boundingBox();
  await glide(b.x + b.width / 2, b.y + b.height / 2, ms);
  return loc;
}
async function click(locator, ms = 700) {
  await point(locator, ms);
  await wait(180);
  await page.mouse.down(); await wait(70); await page.mouse.up();
}
async function type(locator, text) { await click(locator); await page.keyboard.press("ControlOrMeta+a"); await page.keyboard.type(text, { delay: 90 }); }
async function settle(ms = 1500) { await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined); await wait(ms); }
const text = () => page.evaluate(() => document.body.innerText);
async function until(re, ms = 30_000) { for (let t = 0; t < ms; t += 250) { if (re.test(await text())) return true; await wait(250); } return false; }

try {
  // d1: the landing and Monad's live blocks.
  await page.goto(`${APP}/`, { waitUntil: "domcontentloaded" });
  await settle(3000);
  mark("d1");
  await page.mouse.move(pos.x, pos.y);
  await point(page.getByTestId("heartbeat"), 900);
  await wait(6500);
  // d2: Get Started → the feed, with the rails.
  mark("d2");
  await click(page.getByText("Get Started", { exact: true }));
  await settle(2500);
  await glide(250, 300, 900); await wait(1500);
  await glide(1040, 260, 1100); await wait(2000);
  // d3: a passkey account in one prompt.
  mark("d3");
  await page.goto(`${APP}/profile`, { waitUntil: "domcontentloaded" });
  await settle(2000);
  await page.mouse.move(pos.x, pos.y);
  await click(page.getByRole("button", { name: "Create a passkey account" }));
  await page.waitForFunction(() => Boolean(JSON.parse(window.localStorage.getItem("juno.mera.v1") ?? "{}").address), null, { timeout: 30_000 });
  await settle(2500);
  // d4: Buy → faucet in the sheet → a size → Buy.
  mark("d4");
  await page.goto(`${APP}/social`, { waitUntil: "domcontentloaded" });
  await settle(2500);
  await page.mouse.move(pos.x, pos.y);
  await click(page.getByRole("button", { name: /^Buy/ }));
  await wait(1500);
  await click(page.getByRole("button", { name: "Get testnet MON" }));
  if (!(await until(/arrived from Juno's faucet/, 45_000))) throw new Error("faucet did not pay");
  await wait(2500);
  await click(page.getByTestId("quick-amount"));
  await wait(2200);
  await click(page.getByRole("button", { name: /^Buy$/ }).last());
  if (!(await until(/Done/, 40_000))) throw new Error("no receipt");
  // d5: the receipt, then its card.
  mark("d5");
  await page.getByTestId("speed-ethereum").first().waitFor({ timeout: 20_000 }).catch(() => undefined);
  await point(page.getByTestId("speed-ms"), 800); await wait(1800);
  await point(page.getByTestId("speed-final"), 700); await wait(1800);
  await point(page.getByTestId("speed-ethereum"), 700); await wait(1500);
  await click(page.getByRole("button", { name: "Share this receipt" }));
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="receipt-card"] img')].some((i) => i.complete && i.naturalWidth > 0), null, { timeout: 30_000 }).catch(() => undefined);
  await point(page.getByTestId("receipt-card"), 700); await wait(3000);
  // d6: the passkey, checked by Monad's P256 precompile.
  mark("d6");
  await page.goto(`${APP}/profile?tab=wallet`, { waitUntil: "domcontentloaded" });
  await settle(2500);
  await page.mouse.move(pos.x, pos.y);
  await click(page.getByRole("button", { name: "Prove my passkey on Monad" }));
  await until(/Verified by Monad's P256 precompile/, 30_000);
  await point(page.getByText(/Verified by Monad's P256 precompile/), 600); await wait(2500);
  // d7: a coin that graduated into its own Kuru market.
  mark("d7");
  await page.goto(`${APP}/social`, { waitUntil: "domcontentloaded" });
  await settle(2000);
  await page.mouse.move(pos.x, pos.y);
  await click(page.getByRole("button", { name: "Search" }));
  await wait(800);
  await type(page.getByRole("textbox", { name: "Search coins and creators" }), "gradk");
  await wait(900);
  await click(page.getByTestId("search-coin"));
  await settle(3000);
  await point(page.getByTestId("sponsor-kuru"), 800); await wait(2500);
  await page.getByText("Activity", { exact: true }).first().scrollIntoViewIfNeeded().catch(() => undefined);
  await point(page.getByTestId("activity-kuru"), 800).catch(() => undefined); await wait(2500);
  // d8: perps on Perpl with Agora AUSD: faucet, deposit, open a 2x long, close.
  mark("d8");
  await page.goto(`${APP}/trade?sort=perps`, { waitUntil: "domcontentloaded" });
  await settle(3000);
  await page.mouse.move(pos.x, pos.y);
  await point(page.getByTestId("sponsor-agora"), 700); await wait(1200);
  await click(page.getByRole("button", { name: /Get 10,000 test AUSD/ }));
  await until(/Open account|Deposit/, 45_000); await wait(2500);
  await click(page.getByRole("button", { name: /^(Open account|Deposit)$/ }));
  await wait(1200);
  await type(page.getByPlaceholder("100").last(), "100");
  await click(page.getByRole("button", { name: /^Deposit$/ }).last());
  await wait(9000);
  await click(page.getByText(/^BTC-PERP/));
  await wait(1500);
  await type(page.getByPlaceholder("25"), "20");
  await click(page.getByText("2x", { exact: true }));
  await click(page.getByRole("button", { name: /^Open 2x long$/ }));
  await until(/View the transaction|Done/, 45_000); await wait(2500);
  await click(page.getByRole("button", { name: /^Done$/ }).last());
  await wait(3000);
  await click(page.getByRole("button", { name: /^Close$/ }));
  await wait(8000);
  // d9: a pre-IPO tracker with its CRE-attested NAV.
  mark("d9");
  await page.goto(`${APP}/social`, { waitUntil: "domcontentloaded" });
  await settle(2000);
  await page.mouse.move(pos.x, pos.y);
  await click(page.getByRole("button", { name: "Search" }));
  await wait(800);
  await type(page.getByRole("textbox", { name: "Search coins and creators" }), "openai");
  await wait(900);
  await click(page.getByTestId("search-coin"));
  await settle(3000);
  await point(page.getByTestId("sponsor-chainlink"), 900); await wait(4500);
  mark("end");
} catch (error) {
  console.log("FAILED:", error.message.split("\n")[0]);
  mark("failed");
  await page.screenshot({ path: "work/capture/failed.png" });
}
writeFileSync("work/marks.json", JSON.stringify(marks, null, 2));
await context.close();
await browser.close();
const vid = readdirSync("work/capture").filter((f) => f.endsWith(".webm")).sort().at(-1);
if (vid) renameSync(`work/capture/${vid}`, "work/capture/take.webm");
console.log("take: work/capture/take.webm");
void cdp0;
