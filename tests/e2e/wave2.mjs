// Wave 2 (8 Oct): before and after screenshots, and the after-state checks
// for each feature, in real Google Chrome (headless).
//
//   APP=http://localhost:8183 API=http://localhost:3150 node tests/e2e/wave2.mjs <before|after> [feature…]
//
// Features: kuru-fills, badges, rails, profile, card, coach. Runs against a
// stack seeded by `npm run demo:local`. Screenshots go to
// docs/screens/wave2/<feature>-<mode>-<desktop|mobile>.png. Every step fails
// on a console error or warning, or a failed or 4xx/5xx request.
import { copyFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { API, APP, api, harness, rpc, setBalance } from "./harness.mjs";

const MODE = process.argv[2] === "after" ? "after" : "before";
const ALL = ["kuru-fills", "badges", "rails", "profile", "card", "coach"];
const WANT = process.argv.slice(3).length ? process.argv.slice(3) : ALL;
const SHOTS = path.resolve("docs/screens/wave2");
const h = harness({ shots: SHOTS, mode: MODE });
const { open, wait, text, settle, until, shot, check, fundedVisitor, keypad } = h;

const { coins } = await api("/api/juno/coins?limit=60");
/** The demo's coin that graduated into a Kuru market. */
const kuruCoin = coins.find((coin) => coin.venue === "kuru" && coin.kuru);
/** A pre-IPO tracker: the coins Chainlink CRE attests NAV for. */
const tracker = coins.find((coin) => coin.symbol === "OPENAIX");
console.log(`Kuru coin: ${kuruCoin ? `$${kuruCoin.symbol}` : "none"} · tracker: ${tracker ? `$${tracker.symbol}` : "none"}`);

const copyAs = (from, feature, viewport) =>
  copyFileSync(from, path.join(SHOTS, `${feature}-${MODE}-${viewport}.png`));

/** An ERC-20 balance in whole tokens (18 decimals), read from the fork. */
async function balanceOf(token, owner) {
  const data = `0x70a08231${owner.slice(2).toLowerCase().padStart(64, "0")}`;
  return Number(BigInt(await rpc("eth_call", [{ to: token, data }, "latest"]))) / 1e18;
}

/** Buy `amount` MON of the Kuru coin from its page as a fresh visitor; the receipt is left open. */
async function buyOnKuru(page, amount = "0.1") {
  const visitor = await fundedVisitor(page, 20);
  visitor.tokensBefore = await balanceOf(kuruCoin.address, visitor.address);
  visitor.tradesBefore = (await api("/api/juno/stats")).trades24h;
  await page.goto(`${APP}/coin/${kuruCoin.address}`, { waitUntil: "domcontentloaded" });
  await settle(page, 1500);
  await page.getByRole("button", { name: /^Buy$/ }).first().click();
  await wait(page, 1500);
  await keypad(page, amount);
  const submitted = page.waitForResponse((r) => r.url().includes("/api/juno/tx/submit") && r.request().method() === "POST");
  await page.getByRole("button", { name: /^Buy/ }).last().click();
  const result = await (await submitted).json();
  const done = await until(page, /Done/, 25_000);
  await wait(page, 2500);
  visitor.tokensAfter = await balanceOf(kuruCoin.address, visitor.address);
  lastBuy = visitor;
  return { ...visitor, result, done };
}
let lastBuy = null;

/**
 * The receipt card: shown on request in the receipt, and the PNG the server
 * draws says the receipt's own figures (the ms the server measured), not
 * anything the page sent.
 */
async function cardChecks(page, result, viewport) {
  const problems = [];
  await page.getByRole("button", { name: "Share this receipt" }).first().click();
  const loaded = await page
    .waitForFunction(() => [...document.querySelectorAll('[data-testid="receipt-card"] img')].some((img) => img.complete && img.naturalWidth === 1200), null, { timeout: 20_000 })
    .then(() => true, () => false);
  if (!loaded) problems.push("the card image did not load at 1200 px");
  await page.getByTestId("receipt-card").first().scrollIntoViewIfNeeded();
  await wait(page, 800);
  await shot(page, "card", viewport);
  const response = await fetch(`${API}/api/juno/tx/card?hash=${result.hash}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (response.headers.get("content-type") !== "image/png" || bytes[1] !== 0x50) problems.push(`card answered ${response.status} ${response.headers.get("content-type")}`);
  const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
  const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
  if (width !== 1200 || height !== 630) problems.push(`card is ${width}x${height}`);
  writeFileSync(path.join(SHOTS, `card-image-${viewport}.png`), bytes);
  // The card states the server's own measurement of this transaction, and the trade.
  const figures = await api(`/api/juno/tx/card?hash=${result.hash}&format=json`);
  if (figures.executedMs !== result.confirmedInMs) problems.push(`card says ${figures.executedMs} ms, the server measured ${result.confirmedInMs}`);
  if (figures.trade?.venue !== "kuru" || figures.trade?.symbol !== kuruCoin.symbol) problems.push(`card trade ${JSON.stringify(figures.trade)}`);
  // A made-up hash is refused, not drawn.
  const missing = await fetch(`${API}/api/juno/tx/card?hash=0x${"12".repeat(32)}`);
  if (missing.status !== 404) problems.push(`an unknown hash answered ${missing.status}`);
  // "Copy link" puts the card's own URL on the clipboard.
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: APP }).catch(() => undefined);
  await page.getByRole("button", { name: "Copy link" }).first().click();
  if (!(await until(page, /Link copied/, 5_000))) problems.push("Copy link did not confirm");
  return problems;
}

/**
 * The CRE badge says what the chain holds: the attestation the API reports is
 * the one `JunoNavOracle.navOf` returns on the fork, delivered by the juno-nav
 * report, and the page shows it.
 */
async function creChecks(page) {
  const problems = [];
  const detail = await api(`/api/juno/coins/${tracker.address}`);
  const attested = detail.coin?.nav?.attested ?? detail.nav?.attested;
  if (!attested) return ["the API has no CRE attestation for the tracker"];
  if (!(await page.getByTestId("sponsor-chainlink").count())) problems.push("no Chainlink CRE badge on the tracker's page");
  // navOf(token): the struct's sixth word is observedAt.
  const data = `0x59ea2d8e${tracker.address.slice(2).toLowerCase().padStart(64, "0")}`;
  const raw = await rpc("eth_call", [{ to: attested.oracle, data }, "latest"]).catch((e) => String(e));
  const words = typeof raw === "string" && raw.startsWith("0x") ? raw.slice(2).match(/.{64}/g) ?? [] : [];
  const observedAt = words.length >= 6 ? Number(BigInt(`0x${words[5]}`)) : null;
  if (observedAt !== Date.parse(attested.observedAt) / 1000) problems.push(`on chain observedAt ${observedAt}, API ${attested.observedAt}`);
  return problems;
}

/**
 * The Kuru buy, recorded from its receipt: one trade (not one per price level)
 * in the coin's activity, on the page and in the API, with the tokens the
 * wallet actually received, and counted on the landing.
 */
async function kuruFillChecks(page, result) {
  const problems = [];
  const detail = await api(`/api/juno/coins/${kuruCoin.address}`);
  const rows = detail.activity.filter((row) => row.txHash === result.hash);
  if (rows.length !== 1) problems.push(`activity holds ${rows.length} rows for the Kuru buy, not 1`);
  const received = lastBuy.tokensAfter - lastBuy.tokensBefore;
  if (rows[0] && !(Math.abs(rows[0].amount - received) <= received * 1e-6)) {
    problems.push(`recorded ${rows[0].amount} tokens; the wallet received ${received}`);
  }
  if (result.trades !== 1) problems.push(`the submit said ${result.trades} trades`);
  const stats = await api("/api/juno/stats");
  if (stats.trades24h !== lastBuy.tradesBefore + 1) problems.push(`landing count ${lastBuy.tradesBefore} → ${stats.trades24h}, not +1`);
  // The page shows it as the newest trade.
  const top = await page.getByText(/^Buy$/).first().count();
  if (!top) problems.push("no Buy row in the coin's activity");
  return problems;
}

for (const viewport of ["mobile", "desktop"]) {
  if (WANT.some((f) => ["rails", "coach"].includes(f))) {
    const { context, page } = await open(viewport, { coach: WANT.includes("coach") });
    await check(`Feed, first visit · ${viewport}`, async () => {
      await page.goto(`${APP}/social`, { waitUntil: "domcontentloaded" });
      await settle(page, 2500);
      if (MODE === "before") {
        const file = await shot(page, "feed", viewport);
        if (WANT.includes("rails")) copyAs(file, "rails", viewport);
        if (WANT.includes("coach")) copyAs(file, "coach", viewport);
        return [];
      }
      const problems = [];
      if (WANT.includes("coach")) {
        // Three tips on a first visit; the first rings the first post's Buy.
        const card = page.getByTestId("coach-card");
        if (!(await card.first().isVisible().catch(() => false))) problems.push("no first-run tip on a first visit");
        if (!(await page.getByTestId("coach-target").count())) problems.push("the first tip rings no Buy");
        await shot(page, "coach", viewport);
        const amount = (await api("/api/juno/faucet")).amount;
        await page.getByRole("button", { name: "Next" }).first().click();
        await wait(page, 400);
        if (!(await until(page, new RegExp(`gets ${String(amount).replace(".", "\\.")} testnet MON`), 5_000))) problems.push(`the second tip does not state the faucet's ${amount} MON`);
        await page.getByRole("button", { name: "Next" }).first().click();
        await wait(page, 400);
        await page.getByRole("button", { name: "Start" }).first().click();
        await wait(page, 600);
        if (await card.count()) problems.push("the tips did not close");
        await page.reload({ waitUntil: "domcontentloaded" });
        await settle(page, 2500);
        if (await page.getByTestId("coach-card").count()) problems.push("the tips came back after they were done");
      }
      if (WANT.includes("rails")) {
        const rails = (await page.getByTestId("rail-left").count()) + (await page.getByTestId("rail-right").count());
        if (viewport === "desktop") {
          await shot(page, "rails", viewport);
          if (rails !== 2) problems.push(`${rails} rails at 1440 px, not 2`);
          // The rails' figures are the API's.
          const stats = await api("/api/juno/stats");
          const trades = Number((await page.getByTestId("rail-trades").first().innerText()).replace(/[^0-9]/g, ""));
          if (trades !== stats.trades24h) problems.push(`rail says ${trades} trades, API ${stats.trades24h}`);
          const rows = await page.getByTestId("rail-coin").count();
          if (rows < 2) problems.push(`only ${rows} coins in the right rail`);
          // A rail row opens the coin in the column.
          await page.getByTestId("rail-coin").first().click();
          await wait(page, 2500);
          if (!/\/coin\/0x/i.test(page.url())) problems.push(`a rail row opened ${page.url()}`);
        } else {
          await shot(page, "rails", viewport);
          if (rails !== 0) problems.push("rails on a phone-width window");
        }
      }
      return problems;
    });
    await context.close();
  }

  if (WANT.includes("profile")) {
    const { context, page } = await open(viewport);
    await check(`Profile without a wallet · ${viewport}`, async () => {
      const cdp = MODE === "after" ? await context.newCDPSession(page) : null;
      if (cdp) {
        // Chrome's virtual authenticator with PRF, as the Mera e2e uses.
        await cdp.send("WebAuthn.enable");
        await cdp.send("WebAuthn.addVirtualAuthenticator", {
          options: { protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true },
        });
      }
      await page.goto(`${APP}/profile`, { waitUntil: "domcontentloaded" });
      await settle(page, 2500);
      await shot(page, "profile", viewport);
      if (MODE === "before") return [];
      const problems = [];
      const faucet = await api("/api/juno/faucet");
      if (!(await until(page, new RegExp(`${String(faucet.amount).replace(".", "\\.")} MON to start`), 8_000))) problems.push("the preview does not state the faucet's amount");
      if (!(await page.getByTestId("preview-example").count())) problems.push("no real profile to open as the example");
      // One tap: the passkey prompt makes the account, and the profile is the wallet's.
      await page.getByRole("button", { name: "Create a passkey account" }).first().click();
      const made = await page
        .waitForFunction(() => Boolean(JSON.parse(window.localStorage.getItem("juno.mera.v1") ?? "{}").address), null, { timeout: 20_000 })
        .then(() => true, () => false);
      if (!made) return [...problems, "the passkey account was not made"];
      await wait(page, 2500);
      const account = await page.evaluate(() => JSON.parse(window.localStorage.getItem("juno.mera.v1") ?? "{}"));
      if (await page.getByTestId("wallet-preview").count()) problems.push("still the preview after the account was made");
      const choice = await page.evaluate(() => window.localStorage.getItem("juno.wallet.choice.v1"));
      if (choice !== "mera") problems.push(`signer is ${choice}, not the passkey`);
      await page.goto(`${APP}/profile?tab=wallet`, { waitUntil: "domcontentloaded" });
      await settle(page, 2000);
      if (!(await until(page, new RegExp(account.address.slice(2, 6), "i"), 8_000))) problems.push("the wallet tab does not show the passkey account's address");
      return problems;
    });
    await context.close();
  }

  if (kuruCoin && WANT.some((f) => ["kuru-fills", "badges", "card"].includes(f))) {
    const { context, page } = await open(viewport);
    await check(`A buy on Kuru · ${viewport}`, async () => {
      const { result, done } = await buyOnKuru(page);
      if (!done) return [`no receipt (${JSON.stringify(result).slice(0, 160)})`];
      const receipt = await shot(page, "kuru-receipt", viewport);
      const problems = [];
      if (MODE === "after" && WANT.includes("badges")) {
        if (!(await page.getByTestId("sponsor-kuru").first().isVisible())) problems.push("the Kuru receipt has no Kuru badge");
      }
      if (MODE === "after" && WANT.includes("card")) problems.push(...(await cardChecks(page, result, viewport)));
      if (WANT.includes("badges")) copyAs(receipt, "badges", viewport);
      if (WANT.includes("card")) copyAs(receipt, "card", viewport);
      if (WANT.includes("kuru-fills")) {
        await page.goto(`${APP}/coin/${kuruCoin.address}`, { waitUntil: "domcontentloaded" });
        await settle(page, 2500);
        await page.getByText("Activity", { exact: true }).first().scrollIntoViewIfNeeded();
        await wait(page, 800);
        await shot(page, "kuru-fills", viewport);
        if (MODE === "after") problems.push(...(await kuruFillChecks(page, result)));
        if (MODE === "after" && WANT.includes("badges")) {
          if (!(await page.getByTestId("sponsor-kuru").count())) problems.push("the Kuru coin's page has no Kuru badge");
          if (!(await page.getByTestId("activity-kuru").count())) problems.push("the Kuru fill is not tagged KURU in the activity");
        }
      }
      return problems;
    });
    await context.close();
  }

  if (tracker && WANT.includes("badges")) {
    const { context, page } = await open(viewport);
    await check(`A tracker's NAV · ${viewport}`, async () => {
      await page.goto(`${APP}/coin/${tracker.address}`, { waitUntil: "domcontentloaded" });
      await settle(page, 2500);
      await until(page, /NAV/, 10_000);
      const nav = page.getByText(/NAV/).first();
      if (await nav.count()) await nav.scrollIntoViewIfNeeded();
      await wait(page, 800);
      const problems = [];
      if (MODE === "after") {
        await page.getByTestId("sponsor-chainlink").first().waitFor({ timeout: 15_000 }).catch(() => undefined);
        await page.getByTestId("sponsor-chainlink").first().scrollIntoViewIfNeeded().catch(() => undefined);
        await wait(page, 600);
      }
      await shot(page, "badges-tracker", viewport);
      if (MODE === "after") problems.push(...(await creChecks(page)));
      await page.goto(`${APP}/trade`, { waitUntil: "domcontentloaded" });
      await settle(page, 1500);
      await page.getByText("Perps", { exact: true }).first().click();
      await settle(page, 3000);
      await shot(page, "badges-perps", viewport);
      if (MODE === "after") {
        for (const id of ["sponsor-perpl", "sponsor-agora"]) {
          if (!(await page.getByTestId(id).first().isVisible())) problems.push(`the perps panel has no ${id}`);
        }
      }
      return problems;
    });
    await context.close();
  }
}

if (WANT.includes("badges") && MODE === "after") {
  const { context, page } = await open("mobile");
  await check("A passkey signs: the Mera badge on the receipt · mobile", async () => {
    const cdp = await context.newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", {
      options: { protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true },
    });
    await page.goto(`${APP}/profile`, { waitUntil: "domcontentloaded" });
    await settle(page, 2500);
    await page.getByRole("button", { name: "Create a passkey account" }).first().click();
    await page.waitForFunction(() => Boolean(JSON.parse(window.localStorage.getItem("juno.mera.v1") ?? "{}").address), null, { timeout: 20_000 });
    const account = await page.evaluate(() => JSON.parse(window.localStorage.getItem("juno.mera.v1") ?? "{}"));
    await setBalance(account.address, 20);
    await page.goto(`${APP}/coin/${kuruCoin.address}`, { waitUntil: "domcontentloaded" });
    await settle(page, 1500);
    await page.getByRole("button", { name: /^Buy$/ }).first().click();
    await wait(page, 1500);
    await keypad(page, "0.1");
    await page.getByRole("button", { name: /^Buy/ }).last().click();
    if (!(await until(page, /Done/, 25_000))) return ["the passkey's buy did not reach Done"];
    await wait(page, 2500);
    await shot(page, "badges-mera", "mobile");
    const problems = [];
    for (const id of ["sponsor-mera", "sponsor-kuru"]) {
      if (!(await page.getByTestId(id).first().isVisible())) problems.push(`the passkey's Kuru receipt has no ${id}`);
    }
    return problems;
  });
  await context.close();
}

await h.finish();
console.log(`API ${API} · app ${APP}`);
void text;
