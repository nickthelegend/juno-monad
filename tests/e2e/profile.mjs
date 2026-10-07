// The creator profile, end to end, in real Google Chrome (headless).
//
//   APP=http://localhost:8183 API=http://localhost:3150 node tests/e2e/profile.mjs [before|after]
//
// Runs against a stack seeded by scripts/juno-demo.ts (`npm run demo:local`):
// the creator is the demo wallet with the most launches, and "own profile" is
// that wallet's key, read from .juno/demo/fork/ (a fork-only test key the demo
// made) and loaded into this browser's storage the way the app keeps it.
//
// `before` only takes screenshots. `after` (the default) also checks the
// profile: the header, stats, tabs, the post grid against the API, the own
// (Edit) and visitor (Follow) views, a signed bio and link saved and shown to
// a visitor, and the empty and error states. Every step also checks that no
// console error or warning, and no failed or 4xx/5xx request, happened.
//
// Screenshots go to docs/screens/profile/<mode>-<view>-<desktop|mobile>.png.
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { chromium } from "playwright";

const APP = (process.env.APP ?? "http://localhost:8183").replace(/\/$/, "");
const API = (process.env.API ?? "http://localhost:3150").replace(/\/$/, "");
const MODE = process.argv[2] === "before" ? "before" : "after";
const SHOTS = path.resolve("docs/screens/profile");
mkdirSync(SHOTS, { recursive: true });

const VIEWPORTS = {
  desktop: { width: 1440, height: 900, isMobile: false },
  mobile: { width: 390, height: 844, isMobile: true },
};

/* ---------------------------------------------------------------- data */

const coins = (await (await fetch(`${API}/api/juno/coins?limit=60`)).json()).coins;
const byCreator = new Map();
for (const coin of coins) {
  const list = byCreator.get(coin.creator.wallet) ?? [];
  list.push(coin);
  byCreator.set(coin.creator.wallet, list);
}
const [creator, created] = [...byCreator.entries()].sort((a, b) => b[1].length - a[1].length)[0] ?? [];
if (!creator) {
  console.log("FAIL no demo coins: seed with npm run demo:local");
  process.exit(1);
}
// The Posts grid is photos and reels together (a reel with its badge); trackers are only under Coins.
const posts = created.filter((coin) => !coin.reference && (coin.format === "post" || coin.format === "reel"));
const reels = created.filter((coin) => coin.format === "reel");
// The name the creator claimed (the coin rows carry only the short address).
const named = (await (await fetch(`${API}/api/juno/profiles/${creator}`)).json()).name;
const handle = named ?? `${creator.slice(0, 6)}…${creator.slice(-4)}`;

// The creator's key, made by the demo seeder for this fork. Never printed.
const keyDir = path.resolve(".juno/demo/fork");
let ownKey = null;
if (existsSync(keyDir)) {
  const { privateKeyToAccount } = await import("viem/accounts");
  for (const file of readdirSync(keyDir).filter((name) => name.endsWith(".key"))) {
    const key = readFileSync(path.join(keyDir, file), "utf8").trim();
    if (privateKeyToAccount(key).address.toLowerCase() === creator.toLowerCase()) ownKey = key;
  }
}
console.log(`creator ${handle} (${creator.slice(0, 6)}…): ${created.length} coins, ${posts.length} posts, ${reels.length} reels; own key ${ownKey ? "found" : "missing"}`);

/* ---------------------------------------------------------------- harness */

const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [];
let current = "setup";
const issues = [];
const allowed = new Set(["/api/juno/portfolio/not-a-wallet"]);

async function open(viewport, key) {
  const v = VIEWPORTS[viewport];
  const context = await browser.newContext({
    viewport: { width: v.width, height: v.height },
    deviceScaleFactor: 2,
    isMobile: v.isMobile,
    hasTouch: v.isMobile,
  });
  if (key) {
    await context.addInitScript((value) => {
      window.localStorage.setItem("juno.monad.signer.v1", value);
    }, key);
  }
  const page = await context.newPage();
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
    if (r.failure()?.errorText === "net::ERR_ABORTED") return;
    issues.push(`[${current}] FAILED ${r.method()} ${r.url().split("?")[0]} ${r.failure()?.errorText}`);
  });
  return { context, page };
}

async function settle(page, ms = 1500) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
  await page.waitForTimeout(ms);
}

const text = (page) => page.evaluate(() => document.body.innerText);

/** Wait (up to 15 s) for every picture on screen to finish loading: IPFS images arrive slowly. */
async function pictures(page) {
  await page
    .waitForFunction(() => [...document.querySelectorAll("img")].every((img) => img.complete), null, { timeout: 15_000 })
    .catch(() => undefined);
  await page.waitForTimeout(300);
}

async function check(name, fn) {
  current = name;
  const before = issues.length;
  let problems = [];
  try {
    problems = (await fn()) ?? [];
  } catch (error) {
    problems = [String(error?.message ?? error).split("\n")[0].slice(0, 240)];
  }
  const fresh = issues.slice(before);
  const ok = problems.length === 0 && fresh.length === 0;
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` — ${[...problems, ...fresh].join(" | ")}`}`);
}

async function shot(page, view, viewport) {
  await pictures(page);
  const file = path.join(SHOTS, `${MODE}-${view}-${viewport}.png`);
  await page.screenshot({ path: file });
  return file;
}

/* ---------------------------------------------------------------- screenshots */

for (const viewport of ["desktop", "mobile"]) {
  {
    const { context, page } = await open(viewport, null);
    await check(`Visitor profile · ${viewport}`, async () => {
      await page.goto(`${APP}/trader/${creator}`, { waitUntil: "domcontentloaded" });
      await settle(page, 2500);
      const file = await shot(page, "visitor", viewport);
      console.log(`  ${file}`);
      if (MODE === "before") return [];
      const body = await text(page);
      const problems = [];
      for (const want of [named ? `@${handle}` : handle, "Posts", "Followers", "Following", "Follow"]) {
        if (!body.includes(want)) problems.push(`missing "${want}"`);
      }
      if (/Edit profile/.test(body)) problems.push("a visitor is offered Edit profile");
      return problems;
    });
    await context.close();
  }
  if (ownKey) {
    const { context, page } = await open(viewport, ownKey);
    await check(`Own profile · ${viewport}`, async () => {
      await page.goto(`${APP}/profile`, { waitUntil: "domcontentloaded" });
      await settle(page, 2500);
      const file = await shot(page, "own", viewport);
      console.log(`  ${file}`);
      if (MODE === "before") return [];
      const body = await text(page);
      const problems = [];
      for (const want of [named ? `@${handle}` : handle, "Edit profile", "Share profile", "Posts", "Reels", "Coins", "Backed", "Wallet"]) {
        if (!body.includes(want)) problems.push(`missing "${want}"`);
      }
      if (/(^|\n)Follow(\n|$)/.test(body)) problems.push("your own profile offers Follow");
      return problems;
    });
    await context.close();
  }
}

if (MODE === "after") {
  /* ---------------------------------------------------------------- behaviour */
  const { context, page } = await open("mobile", ownKey);

  await check("Grid: one square tile per post (photos and reels), as many as the header counts, each with its price change", async () => {
    await page.goto(`${APP}/trader/${creator}`, { waitUntil: "domcontentloaded" });
    await settle(page, 2500);
    const tiles = page.getByTestId("profile-tile");
    const count = await tiles.count();
    const problems = [];
    if (count !== posts.length) problems.push(`${count} tiles for ${posts.length} posts`);
    const counted = (await text(page)).match(/(^|\n)(\d+)\nPosts\n/)?.[2];
    if (Number(counted) !== count) problems.push(`the header counts ${counted} posts, the grid has ${count}`);
    const badges = await tiles.evaluateAll((els) => els.filter((el) => el.querySelector('[data-testid="reel-badge"]')).length);
    if (badges !== reels.length) problems.push(`${badges} tiles carry a reel badge for ${reels.length} reels`);
    const boxes = await tiles.evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => [Math.round(r.width), Math.round(r.height), Math.round(r.left)]));
    if (boxes.some(([w, h]) => Math.abs(w - h) > 2)) problems.push(`not square: ${JSON.stringify(boxes.slice(0, 3))}`);
    if (new Set(boxes.slice(0, 3).map(([, , left]) => left)).size !== Math.min(3, boxes.length)) problems.push("not three columns");
    const overlays = await tiles.evaluateAll((els) => els.map((el) => el.innerText));
    if (overlays.some((t) => !/[+−-]?\d+(\.\d+)?%|—/.test(t))) problems.push(`a tile has no price change: ${JSON.stringify(overlays.slice(0, 3))}`);
    return problems;
  });

  await check("Tabs: Reels, Coins and Backed each show what they say", async () => {
    const problems = [];
    await page.getByRole("tab", { name: /^Reels/ }).first().click();
    await settle(page, 1200);
    await pictures(page);
    await page.screenshot({ path: path.join(SHOTS, "after-visitor-reels-mobile.png") });
    const reelTiles = await page.getByTestId("profile-tile").count();
    if (reelTiles !== reels.length) problems.push(`Reels: ${reelTiles} tiles for ${reels.length} reels`);
    await page.getByRole("tab", { name: /^Coins/ }).first().click();
    await settle(page, 1200);
    await pictures(page);
    await page.screenshot({ path: path.join(SHOTS, "after-visitor-coins-mobile.png") });
    const body = await text(page);
    for (const coin of created) if (!body.includes(`$${coin.symbol}`)) problems.push(`Coins: missing $${coin.symbol}`);
    await page.getByRole("tab", { name: /^Backed/ }).first().click();
    await settle(page, 4000);
    await pictures(page);
    await page.screenshot({ path: path.join(SHOTS, "after-visitor-backed-mobile.png") });
    const backed = await text(page);
    if (!/Profit taken|No fills/.test(backed)) problems.push("Backed: no record");
    if (!/from other creators|Backs no other|You hold no other/.test(backed)) problems.push("Backed: no holdings section");
    await page.getByRole("tab", { name: /^Posts/ }).first().click();
    await settle(page, 800);
    return problems;
  });

  await check("A tile opens its post's coin", async () => {
    await page.getByTestId("profile-tile").first().click();
    await settle(page, 2000);
    return /\/coin\/0x[0-9a-fA-F]{40}/.test(page.url()) ? [] : [`landed on ${page.url()}`];
  });

  const stamp = String(Date.now()).slice(-6);
  // The run's stamp is in the link, so a save from an earlier run cannot pass for this one.
  const bio = "Waterfalls and wildflowers. Every post here is a coin on Monad.";
  const link = `https://example.com/demo-${stamp}`;
  await check("Edit profile: a signed bio and link, saved and shown", async () => {
    await page.goto(`${APP}/profile`, { waitUntil: "domcontentloaded" });
    await settle(page, 2500);
    await page.getByRole("button", { name: "Edit profile" }).first().click();
    await settle(page, 800);
    await page.getByLabel("Bio").fill(bio);
    await page.getByLabel("Link").fill(link);
    await page.screenshot({ path: path.join(SHOTS, "after-own-edit-mobile.png") });
    await page.getByRole("button", { name: "Save" }).first().click();
    await settle(page, 2500);
    const problems = [];
    const body = await text(page);
    if (!body.includes(bio)) problems.push("bio not shown after saving");
    if (!body.includes(link.replace(/^https:\/\//, ""))) problems.push("link not shown after saving");
    const stored = await (await fetch(`${API}/api/juno/profiles/${creator}`)).json();
    if (stored.bio !== bio || stored.link !== link) problems.push(`server has ${JSON.stringify({ bio: stored.bio, link: stored.link })}`);
    return problems;
  });

  await check("Edit profile refuses a link that is not https", async () => {
    await page.getByRole("button", { name: "Edit profile" }).first().click();
    await settle(page, 800);
    await page.getByLabel("Link").fill("javascript:alert(1)");
    const save = page.getByRole("button", { name: "Save" }).first();
    const problems = [];
    if (!(await save.isDisabled())) problems.push("Save is enabled for a javascript: link");
    if (!/https/.test(await text(page))) problems.push("no hint about https");
    await page.getByRole("button", { name: "Cancel" }).first().click();
    await settle(page, 600);
    return problems;
  });
  await context.close();

  {
    const visitor = await open("mobile", null);
    await check("A visitor sees the bio and link", async () => {
      await visitor.page.goto(`${APP}/trader/${creator}`, { waitUntil: "domcontentloaded" });
      await settle(visitor.page, 2500);
      const body = await text(visitor.page);
      return body.includes(bio) && body.includes(link.replace(/^https:\/\//, "")) ? [] : ["bio or link missing for a visitor"];
    });
    await visitor.context.close();
  }

  {
    const fresh = await open("mobile", null);
    await check("Empty state: a new wallet's own profile", async () => {
      await fresh.page.goto(`${APP}/profile`, { waitUntil: "domcontentloaded" });
      await settle(fresh.page, 1500);
      await fresh.page.getByRole("button", { name: "Create wallet" }).first().click();
      await settle(fresh.page, 2500);
      const file = path.join(SHOTS, "after-own-empty-mobile.png");
      await fresh.page.screenshot({ path: file });
      console.log(`  ${file}`);
      const body = await text(fresh.page);
      const problems = [];
      if (!/No posts yet/.test(body)) problems.push('missing "No posts yet"');
      if (!/Edit profile/.test(body)) problems.push("missing Edit profile");
      return problems;
    });
    await check("Error state: an address that is not one", async () => {
      await fresh.page.goto(`${APP}/trader/not-a-wallet`, { waitUntil: "domcontentloaded" });
      await settle(fresh.page, 1500);
      return /No such wallet/.test(await text(fresh.page)) ? [] : ['missing "No such wallet"'];
    });
    await fresh.context.close();
  }
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n=== ${results.length - failed.length} PASS, ${failed.length} FAIL (${MODE})`);
process.exit(failed.length ? 1 : 0);
