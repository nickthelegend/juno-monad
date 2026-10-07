// Every screen of the app at 375 × 812, in real Google Chrome (headless).
//
//   APP=http://localhost:8183 API=http://localhost:3150 node tests/e2e/walk.mjs [shots dir]
//
// For each screen and tab, checks that:
//   - it renders something (not a blank page);
//   - nothing overflows the 375px width (no horizontal scroll);
//   - no "NaN", "undefined" or "[object Object]" reaches the screen;
//   - no console error or warning, and no page error;
//   - no request fails or answers 4xx/5xx, except the ones a screen is about
//     (an unknown coin's 404).
// Runs against any deployment: coins are looked up by symbol from the demo
// data (scripts/juno-demo.ts), and the wallet steps make a fresh device key
// in this browser only.
import { mkdirSync } from "node:fs";
import path from "node:path";

import { chromium } from "playwright";

const APP = (process.env.APP ?? "http://localhost:8183").replace(/\/$/, "");
const API = (process.env.API ?? "http://localhost:3150").replace(/\/$/, "");
const SHOTS = process.argv[2] ?? null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const coins = (await (await fetch(`${API}/api/juno/coins?limit=40`)).json()).coins;
const bySymbol = (symbol) => coins.find((c) => c.symbol === symbol)?.address ?? null;
const COIN = {
  curve: bySymbol("FALLS"),
  v2: bySymbol("GRADV2"),
  kuru: bySymbol("GRADKURU"),
  tessera: bySymbol("OPENAIX"),
  pyth: bySymbol("AAPLXI"),
};
const creator = coins.find((c) => c.symbol === "FALLS")?.creator?.wallet ?? null;

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 375, height: 812 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();

let current = "setup";
const issues = [];
const allowed = new Set();
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") issues.push(`[${current}] console.${m.type()}: ${m.text().slice(0, 220)}`);
});
page.on("pageerror", (e) => issues.push(`[${current}] pageerror: ${e.message.slice(0, 220)}`));
page.on("response", (r) => {
  if (r.status() < 400) return;
  const line = `[${current}] HTTP ${r.status()} ${r.request().method()} ${r.url().split("?")[0]}`;
  if (![...allowed].some((a) => line.includes(a))) issues.push(line);
});
page.on("requestfailed", (r) => {
  const why = r.failure()?.errorText ?? "";
  // A media element or the router aborting a superseded request is not a failure.
  if (why === "net::ERR_ABORTED") return;
  issues.push(`[${current}] FAILED ${r.method()} ${r.url().split("?")[0]} ${why}`);
});

const results = [];
const text = () => page.evaluate(() => document.body.innerText);

async function settle(ms = 1500) {
  await page.waitForLoadState("domcontentloaded");
  // Wait for the API reads this screen started, then a beat for rendering.
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
  await page.waitForTimeout(ms);
}

async function check(name, must = []) {
  current = name;
  const before = issues.length;
  const body = await text();
  const problems = [];
  if (body.trim().length < 20) problems.push("blank screen");
  for (const bad of ["NaN", "undefined", "[object Object]"]) {
    if (new RegExp(`(^|[^A-Za-z])${bad.replace(/[[\]]/g, "\\$&")}([^A-Za-z]|$)`).test(body)) problems.push(`shows "${bad}"`);
  }
  for (const want of must) if (!(want instanceof RegExp ? want.test(body) : body.includes(want))) problems.push(`missing ${want}`);
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    const wide = [...document.querySelectorAll("body *")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return r.width > 0 && r.right > window.innerWidth + 1 && style.position !== "fixed" && style.visibility !== "hidden";
      })
      // Horizontal scrollers (chips, stories, carousels) are allowed to hold wider content.
      .filter((el) => {
        for (let p = el.parentElement; p; p = p.parentElement) {
          const s = getComputedStyle(p);
          if ((s.overflowX === "auto" || s.overflowX === "scroll" || s.overflowX === "hidden") && p.scrollWidth > p.clientWidth) return false;
        }
        return true;
      })
      .slice(0, 3)
      .map((el) => `${el.tagName.toLowerCase()} "${(el.innerText || "").slice(0, 30).replace(/\s+/g, " ")}" right=${Math.round(el.getBoundingClientRect().right)}`);
    return { scroll: doc.scrollWidth > window.innerWidth + 1 ? doc.scrollWidth : null, wide };
  });
  if (overflow.scroll) problems.push(`page scrolls sideways (${overflow.scroll}px)`);
  if (overflow.wide.length) problems.push(`wider than 375px: ${overflow.wide.join("; ")}`);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${String(results.length + 1).padStart(2, "0")}-${name.replace(/[^\w-]+/g, "_")}.png`) });
  const newIssues = issues.slice(before);
  const ok = problems.length === 0 && newIssues.length === 0;
  results.push({ name, ok, problems: [...problems, ...newIssues] });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` — ${[...problems, ...newIssues].join(" | ")}`}`);
}

async function visit(route, name, must, ms) {
  current = name;
  await page.goto(`${APP}${route}`, { waitUntil: "domcontentloaded" });
  await settle(ms);
  await check(name, must);
}

async function tap(label, options = {}) {
  // A tab may carry a count ("Comments 1"), so match the label at the start.
  const target = page.getByRole(options.role ?? "tab", { name: new RegExp(`^${label}(\\s+\\d+)?$`) }).first();
  await target.click();
  await settle(options.ms ?? 1200);
}

await visit("/", "Landing", ["Get Started"]);
await visit("/social", "Feed", [/\$/]);
await visit("/reels", "Reels", [], 3000);
await visit("/trade", "Trade · Pre-IPO", ["Pre-IPO"]);
for (const segment of ["Stocks", "Memes", "Kuru", "Perps", "Traders"]) {
  await tap(segment, { ms: 2500 });
  await check(`Trade · ${segment}`);
}
await tap("Perps", { ms: 2500 });
await tap("Risk", { ms: 3000 });
await check("Trade · Perps · Risk");
await visit("/post", "Create (no wallet yet)", []);
await visit("/profile", "Profile (no wallet)", ["Create wallet"]);

// A device wallet, made in this browser.
current = "Profile · create wallet";
await page.getByRole("button", { name: "Create wallet" }).first().click();
await settle(2500);
await check("Profile (wallet)", [/0x[0-9a-fA-F]{4}/, "Edit profile", "No posts yet"]);
for (const tab of ["Reels", "Coins", "Backed"]) {
  await tap(tab, { ms: tab === "Backed" ? 3500 : 1500 });
  await check(`Profile · ${tab}`);
}
await tap("Wallet", { ms: 2500 });
await check("Profile · Wallet", ["Get testnet MON"]);
for (const tab of ["Holdings", "Watching", "Plans", "Activity", "About"]) {
  await tap(tab, { ms: 1800 });
  await check(`Profile · Wallet · ${tab}`, tab === "Plans" ? ["Autopilot"] : []);
}
await visit("/post", "Create", ["Publishing opens a real bonding curve"]);

for (const [kind, address] of Object.entries(COIN)) {
  if (!address) {
    results.push({ name: `Coin · ${kind}`, ok: false, problems: ["demo coin missing — seed with scripts/juno-demo.ts --round all"] });
    console.log(`FAIL Coin · ${kind} — demo coin missing`);
    continue;
  }
  await visit(`/coin/${address}`, `Coin · ${kind}`, ["Market cap"], 2500);
  for (const tab of ["Holders", "Comments", "Details"]) {
    await tap(tab, { role: "button", ms: 1800 });
    await check(`Coin · ${kind} · ${tab}`);
    // Comments opens as a sheet over the coin; close it the way a person would.
    if (tab === "Comments") {
      await page.keyboard.press("Escape");
      await settle(800);
    }
  }
}
allowed.add("/api/juno/coins/0x000000000000000000000000000000000000dEaD");
await visit("/coin/0x000000000000000000000000000000000000dEaD", "Coin · unknown", ["No such coin"]);
if (creator) {
  await visit(`/trader/${creator}`, "Creator profile", [/0x[0-9a-fA-F]{4}|demo_/, "Follow", "Posts"], 2500);
  for (const tab of ["Reels", "Coins", "Backed"]) {
    await tap(tab, { ms: tab === "Backed" ? 3500 : 1500 });
    await check(`Creator profile · ${tab}`);
  }
}
allowed.add("/api/juno/portfolio/not-a-wallet");
await visit("/trader/not-a-wallet", "Trader · bad address", []);
await visit("/nope", "Not found", ["Nothing here"]);

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n=== ${results.length - failed.length} PASS, ${failed.length} FAIL of ${results.length} screens at 375px`);
process.exit(failed.length ? 1 : 0);
