// The October development wave: before and after screenshots, and the
// after-state checks for each feature, in real Google Chrome (headless).
//
//   APP=http://localhost:8183 API=http://localhost:3150 node tests/e2e/wave.mjs <before|after> [feature…]
//
// Features: receipt, first-trade, landing, inbox, analytics. Runs against a
// stack seeded by `npm run demo:local`. Screenshots go to
// docs/screens/wave/<feature>-<mode>-<desktop|mobile>.png. Every step also
// fails on a console error or warning, or a failed or 4xx/5xx request.
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { chromium } from "playwright";
import { privateKeyToAccount } from "viem/accounts";

const APP = (process.env.APP ?? "http://localhost:8183").replace(/\/$/, "");
const API = (process.env.API ?? "http://localhost:3150").replace(/\/$/, "");
const MODE = process.argv[2] === "after" ? "after" : "before";
const ALL = ["receipt", "first-trade", "landing", "inbox", "analytics", "heartbeat", "staking", "txpool", "passkey"];
const WANT = process.argv.slice(3).length ? process.argv.slice(3) : ALL;
const SHOTS = path.resolve("docs/screens/wave");
mkdirSync(SHOTS, { recursive: true });

const VIEWPORTS = {
  desktop: { width: 1440, height: 900, isMobile: false },
  mobile: { width: 390, height: 844, isMobile: true },
};

/* The demo creator with the most launches, and its fork-only key (never printed). */
const coins = (await (await fetch(`${API}/api/juno/coins?limit=60`)).json()).coins;
const counts = new Map();
for (const coin of coins) counts.set(coin.creator.wallet, (counts.get(coin.creator.wallet) ?? 0) + 1);
const creator = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
let creatorKey = null;
const keyDir = path.resolve(".juno/demo/fork");
if (existsSync(keyDir)) {
  for (const file of readdirSync(keyDir).filter((name) => name.endsWith(".key"))) {
    const key = readFileSync(path.join(keyDir, file), "utf8").trim();
    if (privateKeyToAccount(key).address.toLowerCase() === creator?.toLowerCase()) creatorKey = key;
  }
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [];
const issues = [];
let current = "setup";

async function open(viewport, key = null) {
  const v = VIEWPORTS[viewport];
  const context = await browser.newContext({
    viewport: { width: v.width, height: v.height },
    deviceScaleFactor: 2,
    isMobile: v.isMobile,
    hasTouch: v.isMobile,
  });
  if (key) await context.addInitScript((value) => window.localStorage.setItem("juno.monad.signer.v1", value), key);
  // The feed's first-run tips came later (wave 2); these checks are about other things.
  await context.addInitScript(() => window.localStorage.setItem("juno.coach.feed.v1", "done"));
  const page = await context.newPage();
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") issues.push(`[${current}] console.${m.type()}: ${m.text().slice(0, 200)}`);
  });
  page.on("pageerror", (e) => issues.push(`[${current}] pageerror: ${e.message.slice(0, 200)}`));
  page.on("response", (r) => {
    if (r.status() >= 400) issues.push(`[${current}] HTTP ${r.status()} ${r.request().method()} ${r.url().split("?")[0]}`);
  });
  page.on("requestfailed", (r) => {
    if (r.failure()?.errorText === "net::ERR_ABORTED") return;
    issues.push(`[${current}] FAILED ${r.method()} ${r.url().split("?")[0]} ${r.failure()?.errorText}`);
  });
  return { context, page };
}

const wait = (page, ms) => page.waitForTimeout(ms);
const text = (page) => page.evaluate(() => document.body.innerText);
async function settle(page, ms = 1500) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
  await page
    .waitForFunction(() => [...document.querySelectorAll("img")].every((img) => img.complete), null, { timeout: 15_000 })
    .catch(() => undefined);
  await wait(page, ms);
}
async function until(page, pattern, ms = 20_000) {
  for (let t = 0; t < ms; t += 250) {
    if (pattern.test(await text(page))) return true;
    await wait(page, 250);
  }
  return false;
}
async function shot(page, feature, viewport) {
  const file = path.join(SHOTS, `${feature}-${MODE}-${viewport}.png`);
  await page.screenshot({ path: file });
  console.log(`  ${file}`);
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

const FORK_RPC = process.env.FORK_RPC ?? "http://127.0.0.1:8555";

/**
 * A fresh device wallet holding what Juno's faucet would give (0.5 MON).
 *
 * The wallet is made in the app the way a visitor makes one. The MON is set
 * on the fork directly, so steps that are not about the faucet do not spend
 * its per-address rate limit; the first-trade step uses the real faucet.
 */
async function fundedVisitor(page, { faucet = false } = {}) {
  await page.goto(`${APP}/profile?tab=wallet`, { waitUntil: "domcontentloaded" });
  await settle(page, 1000);
  await page.getByRole("button", { name: "Create wallet" }).first().click();
  await settle(page, 1500);
  if (faucet) return;
  const key = await page.evaluate(() => window.localStorage.getItem("juno.monad.signer.v1"));
  const address = privateKeyToAccount(key).address;
  await fetch(FORK_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "anvil_setBalance", params: [address, "0x6F05B59D3B20000"] }),
  });
}

/** Open the buy sheet on the feed's first post. */
async function openBuy(page) {
  await page.goto(`${APP}/social`, { waitUntil: "domcontentloaded" });
  await settle(page, 1500);
  await page.getByRole("button", { name: /^Buy/ }).first().click();
  await wait(page, 2000);
}

/** Type an amount on the sheet's keypad. */
async function key(page, digits) {
  for (const k of digits) {
    await page.getByText(k, { exact: true }).last().click();
    await wait(page, 120);
  }
  await wait(page, 1800);
}

for (const viewport of ["mobile", "desktop"]) {
  if (WANT.includes("receipt")) {
    const { context, page } = await open(viewport);
    await check(`Speed receipt · ${viewport}`, async () => {
      await fundedVisitor(page);
      await openBuy(page);
      await key(page, "0.1");
      // Monad's reserve rule, said where it applies: 0.5 MON spending 0.1 dips below the reserve once.
      const reserveNote = MODE === "after" ? /once every 3 blocks/.test(await text(page)) : true;
      // What the server measured and returned for this transaction.
      const submitted = page.waitForResponse((r) => r.url().includes("/api/juno/tx/submit") && r.request().method() === "POST");
      await page.getByRole("button", { name: /^Buy/ }).last().click();
      const result = await (await submitted).json();
      const done = await until(page, /Done/, 20_000);
      if (MODE === "after") {
        await page.getByTestId("speed-fee").first().waitFor({ timeout: 15_000 }).catch(() => undefined);
      }
      await wait(page, 1500);
      await shot(page, "receipt", viewport);
      if (!done) return ["no receipt"];
      if (MODE === "before") return [];
      const problems = [];
      const shownMs = Number((await page.getByTestId("speed-ms").first().innerText()).replace(/[^0-9]/g, ""));
      if (shownMs !== result.confirmedInMs) problems.push(`shows ${shownMs} ms, the server measured ${result.confirmedInMs}`);
      const cost = await (await fetch(`${API}/api/juno/tx/cost?hash=${result.hash}`)).json();
      const feeText = await page.getByTestId("speed-fee").first().innerText();
      const shownFee = Number(feeText.match(/[\d.]+/)?.[0]);
      if (!(Math.abs(shownFee - cost.monad.feeMon) <= cost.monad.feeMon * 0.05)) problems.push(`fee ${feeText} vs ${cost.monad.feeMon} MON`);
      const ethereum = await page.getByTestId("speed-ethereum").count();
      if (Boolean(cost.ethereum) !== ethereum > 0) problems.push(`Ethereum line ${ethereum ? "shown" : "absent"} but the API ${cost.ethereum ? "has" : "has no"} a comparison`);
      if (!reserveNote) problems.push("no reserve-rule note before a buy that dips below 10 MON");
      if (!/Signed here/.test(await text(page))) problems.push("no timeline");
      // The second timer: on a fork, Monad testnet's own finality, labelled as the network's.
      if (!(await until(page, /finality right now/, 20_000))) problems.push("no labelled second timer");
      return problems;
    });
    await context.close();
  }

  if (WANT.includes("first-trade")) {
    const { context, page } = await open(viewport);
    await check(`First trade · ${viewport}`, async () => {
      if (MODE === "before") {
        await fundedVisitor(page);
        await openBuy(page);
        // The sheet's first quick amount, as a newcomer would tap it.
        await page.getByText("$2", { exact: true }).first().click();
        await wait(page, 2500);
        await shot(page, "first-trade", viewport);
        return [];
      }
      // A newcomer with nothing: no wallet, no MON. Everything happens in the one sheet.
      const problems = [];
      await page.goto(`${APP}/social`, { waitUntil: "domcontentloaded" });
      await settle(page, 1500);
      if (!(await until(page, /mcap/, 15_000))) problems.push("the feed's figure is not labelled");
      await page.getByRole("button", { name: /^Buy/ }).first().click();
      await wait(page, 1500);
      await page.getByRole("button", { name: "Create a wallet to trade" }).first().click();
      await wait(page, 2500);
      await page.getByRole("button", { name: "Get testnet MON" }).first().click();
      if (!(await until(page, /arrived from Juno's faucet/, 30_000))) return [...problems, "the faucet did not pay out in the sheet"];
      await wait(page, 2500);
      const labels = await page.getByTestId("quick-amount").allInnerTexts();
      const amounts = labels.map((label) => Number(label.match(/[\d.]+/)?.[0])).filter((n) => Number.isFinite(n));
      if (amounts.length < 3 || amounts.some((n) => n > 0.5)) problems.push(`quick amounts ${JSON.stringify(labels)} do not fit 0.5 MON`);
      await page.getByTestId("quick-amount").first().click();
      await wait(page, 2500);
      await shot(page, "first-trade", viewport);
      await page.getByRole("button", { name: /^Buy$/ }).last().click();
      if (!(await until(page, /Done/, 25_000))) problems.push("the first trade did not reach Done");
      return problems;
    });
    await context.close();
  }

  if (WANT.includes("landing")) {
    const { context, page } = await open(viewport);
    await check(`Landing · ${viewport}`, async () => {
      await page.goto(`${APP}/`, { waitUntil: "domcontentloaded" });
      await settle(page, 3000);
      await shot(page, "landing", viewport);
      if (MODE === "before") return [];
      const problems = [];
      const stats = await (await fetch(`${API}/api/juno/stats`)).json();
      const number = async (id) => Number((await page.getByTestId(id).first().innerText()).replace(/[^0-9]/g, ""));
      if ((await number("stat-coins")) !== stats.coins) problems.push(`markets ${await number("stat-coins")} vs API ${stats.coins}`);
      if ((await number("stat-trades")) !== stats.trades24h) problems.push(`trades ${await number("stat-trades")} vs API ${stats.trades24h}`);
      if (Boolean(stats.confirmation) !== (await page.getByTestId("stat-confirm").count()) > 0) problems.push("confirmation figure shown without a measurement, or missing with one");
      const first = await number("stat-block");
      await wait(page, 6_000);
      const later = await number("stat-block");
      if (!(later > first)) problems.push(`block did not tick (${first} → ${later})`);
      // The landing starts warming the feed's pictures; the server says how many it holds.
      let warm = false;
      for (let i = 0; i < 30 && !warm; i++) {
        const pictures = (await (await fetch(`${API}/api/juno/stats`)).json()).pictures;
        warm = pictures !== null && pictures.total > 0 && pictures.held === pictures.total;
        if (!warm) await wait(page, 2_000);
      }
      if (!warm) problems.push("feed pictures were not warmed within a minute of landing");
      return problems;
    });
    await context.close();
  }

  if (WANT.includes("inbox") && creatorKey) {
    const { context, page } = await open(viewport, creatorKey);
    await check(`Inbox · ${viewport}`, async () => {
      if (MODE === "before") {
        await page.goto(`${APP}/social`, { waitUntil: "domcontentloaded" });
        await settle(page, 2500);
        await shot(page, "inbox", viewport);
        return [];
      }
      const problems = [];
      // Someone else, in their own browser: follows the creator, buys one of
      // their coins and comments on it, all through the app.
      const visitor = await open(viewport);
      await fundedVisitor(visitor.page);
      const vp = visitor.page;
      const post = coins.find((coin) => coin.creator.wallet === creator && coin.format === "post" && !coin.curve.graduated && !coin.reference);
      await vp.goto(`${APP}/trader/${creator}`, { waitUntil: "domcontentloaded" });
      await settle(vp, 1500);
      await vp.getByRole("button", { name: "Follow", exact: true }).first().click();
      if (!(await until(vp, /Following/, 10_000))) problems.push("the visitor could not follow");
      await vp.goto(`${APP}/coin/${post.address}`, { waitUntil: "domcontentloaded" });
      await settle(vp, 2000);
      await vp.getByRole("button", { name: /^Buy$/ }).last().click();
      await wait(vp, 1500);
      await key(vp, "0.1");
      await vp.getByRole("button", { name: /^Buy$/ }).last().click();
      if (!(await until(vp, /Done/, 25_000))) problems.push("the visitor's buy did not land");
      await vp.getByRole("button", { name: "Done", exact: true }).first().click().catch(() => undefined);
      await wait(vp, 1000);
      const words = `Lovely light on this one ${String(Date.now()).slice(-5)}`;
      await vp.getByRole("button", { name: /^Comments/ }).first().click();
      await wait(vp, 1200);
      await vp.getByPlaceholder("Add a comment...").last().fill(words);
      await vp.getByRole("button", { name: "Post comment" }).last().click();
      await wait(vp, 2500);
      await visitor.context.close();

      // The creator: a badge on the bell, then each event in the inbox.
      await page.goto(`${APP}/social`, { waitUntil: "domcontentloaded" });
      await settle(page, 2500);
      const badge = page.getByTestId("bell-badge");
      if (!(await badge.count())) problems.push("no unread badge on the bell");
      else if (Number(await badge.first().innerText()) < 3) problems.push(`badge says ${await badge.first().innerText()}, want at least 3`);
      await page.getByRole("button", { name: /^Notifications/ }).first().click();
      await settle(page, 2000);
      const inbox = await text(page);
      for (const [what, pattern] of [
        ["follow", /started following you/],
        ["buy", new RegExp(`bought [\\d.,kMB]+ \\$${post.symbol}`)],
        ["comment", new RegExp(`commented on \\$${post.symbol}`)],
      ]) {
        if (!pattern.test(inbox)) problems.push(`the inbox has no ${what}`);
      }
      if (!inbox.includes(words)) problems.push("the comment's words are not shown");
      await shot(page, "inbox", viewport);
      // Opened is read: back on the feed, the badge is gone.
      await page.goto(`${APP}/social`, { waitUntil: "domcontentloaded" });
      await settle(page, 2500);
      if (await page.getByTestId("bell-badge").count()) problems.push("the badge is still there after the inbox was opened");
      return problems;
    });
    await context.close();
  }

  if (WANT.includes("analytics") && creatorKey) {
    const { context, page } = await open(viewport, creatorKey);
    await check(`Creator analytics · ${viewport}`, async () => {
      await page.goto(`${APP}/profile?tab=coins`, { waitUntil: "domcontentloaded" });
      await settle(page, 3000);
      await shot(page, "analytics", viewport);
      if (MODE === "before") return [];
      const problems = [];
      const profile = await (await fetch(`${API}/api/juno/profiles/${creator}`)).json();
      const earned = profile.coins.reduce((sum, coin) => sum + coin.creatorRewards + (coin.creatorRewardsClaimed ?? 0), 0);
      const shown = Number((await page.getByTestId("earnings-total").first().innerText()).replace(/[^0-9.]/g, ""));
      if (!(Math.abs(shown - earned) <= Math.max(0.01, earned * 0.01))) problems.push(`earned shows ${shown}, the chain reads ${earned}`);
      const bars = await page.getByTestId("earnings-row").count();
      if (bars !== profile.coins.length) problems.push(`${bars} bars for ${profile.coins.length} coins`);
      return problems;
    });
    await context.close();
  }

  if (WANT.includes("heartbeat")) {
    const { context, page } = await open(viewport);
    await check(`Monad heartbeat · ${viewport}`, async () => {
      await page.goto(`${APP}/`, { waitUntil: "domcontentloaded" });
      await settle(page, 2000);
      // Live from Monad testnet's WebSocket: wait for a block to finalize.
      const ready = await until(page, /final \d+ ms/, 30_000);
      await shot(page, "heartbeat", viewport);
      if (MODE === "before") return [];
      const problems = [];
      if (!ready) return ["no finalized block from Monad testnet within 30 s"];
      const beat = await (await fetch(`${API}/api/juno/heartbeat`)).json();
      if (!beat.connected || beat.network !== "monad-testnet") problems.push(`heartbeat ${JSON.stringify({ connected: beat.connected, network: beat.network })}`);
      if (!(beat.blockMs >= 200 && beat.blockMs <= 500)) problems.push(`block time ${beat.blockMs} ms is not Monad's ~300`);
      if (!(beat.finalizedMs > beat.votedMs)) problems.push(`finalized ${beat.finalizedMs} ms is not after voted ${beat.votedMs} ms`);
      if (!/Juno's own trades here run on a local fork/.test(await text(page))) problems.push("the strip does not say the app runs on a fork");
      return problems;
    });
    await context.close();
  }

  if (WANT.includes("staking")) {
    const { context, page } = await open(viewport);
    await check(`Staking card · ${viewport}`, async () => {
      await fundedVisitor(page);
      await page.goto(`${APP}/profile?tab=wallet`, { waitUntil: "domcontentloaded" });
      await settle(page, 2500);
      await page.getByTestId("staking-card").first().scrollIntoViewIfNeeded();
      await until(page, /Epoch \d/, 20_000);
      await wait(page, 800);
      await shot(page, "staking", viewport);
      if (MODE === "before") return [];
      const staking = await (await fetch(`${API}/api/juno/staking`)).json();
      const epoch = Number((await page.getByTestId("staking-epoch").first().innerText()).replace(/[^0-9]/g, ""));
      const problems = [];
      if (Math.abs(epoch - staking.epoch) > 1) problems.push(`epoch ${epoch} vs testnet ${staking.epoch}`);
      if (!/Proposing now: validator #\d+/.test(await text(page))) problems.push("no proposer");
      return problems;
    });
    await context.close();
  }

  if (WANT.includes("passkey")) {
    const { context, page } = await open(viewport);
    await check(`Passkey proved on Monad's P256 precompile · ${viewport}`, async () => {
      // Chrome's virtual authenticator with PRF, as the Mera e2e uses.
      const cdp = await context.newCDPSession(page);
      await cdp.send("WebAuthn.enable");
      await cdp.send("WebAuthn.addVirtualAuthenticator", {
        options: { protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true },
      });
      await page.goto(`${APP}/profile?tab=wallet`, { waitUntil: "domcontentloaded" });
      await settle(page, 2500);
      await page.getByRole("tab", { name: "Passkey", exact: true }).click();
      await wait(page, 1200);
      await page.getByRole("button", { name: "Create a passkey account" }).click();
      if (!(await until(page, /Signing session open/, 20_000))) return ["no passkey account"];
      await page.getByTestId("passkey-on-chain").first().scrollIntoViewIfNeeded();
      if (MODE === "before") {
        await shot(page, "passkey", viewport);
        return [];
      }
      await page.getByRole("button", { name: "Prove my passkey on Monad" }).click();
      const verified = await until(page, /Verified by Monad's P256 precompile/, 25_000);
      await wait(page, 800);
      await shot(page, "passkey", viewport);
      if (!verified) return [`not verified: ${(await text(page)).match(/Passkey on Monad[\s\S]{0,240}/)?.[0]}`];
      const key = await page.evaluate(() => JSON.parse(window.localStorage.getItem("juno.mera.v1") ?? "{}"));
      const profile = await (await fetch(`${API}/api/juno/profiles/${key.address}`)).json();
      const problems = [];
      if (!profile.passkey || profile.passkey.where !== "local fork") problems.push(`profile passkey ${JSON.stringify(profile.passkey)}`);
      // Anyone looking at the profile sees it.
      await page.goto(`${APP}/trader/${key.address}`, { waitUntil: "domcontentloaded" });
      await settle(page, 2000);
      if (!/Passkey verified/.test(await text(page))) problems.push("the profile has no passkey badge");
      return problems;
    });
    await context.close();
  }

  if (WANT.includes("txpool") && viewport === "mobile" && MODE === "after") {
    await check("Txpool status on the fork says it is unsupported, not a guess", async () => {
      const answer = await (await fetch(`${API}/api/juno/tx/status?hash=0x${"ab".repeat(32)}`)).json();
      return answer.supported === false && answer.where === "local fork" ? [] : [`answered ${JSON.stringify(answer)}`];
    });
  }
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n=== ${results.length - failed.length} PASS, ${failed.length} FAIL (${MODE}: ${WANT.join(", ")})`);
process.exit(failed.length ? 1 : 0);
