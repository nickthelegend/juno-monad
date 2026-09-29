/**
 * The web app's visitor flows (docs/TEST-PLAN.md: the A, D, E, F and G cases a
 * signed-out visitor can run), against the running app in a real Chromium:
 * each page's text, every console error, and every failed or non-2xx
 * request. Prints one JSON report. Nothing is signed.
 *
 *   node scripts/demo/e2e-ui.mjs
 *
 * JUNO_APP_URL is the app (default the local Expo web build on :8181). The
 * coins are the ones the film uses (JUNO_FILM_COIN, JUNO_FILM_TRACKER,
 * JUNO_FILM_GRADUATED_V2, JUNO_FILM_GRADUATED_KURU) and JUNO_FILM_TRADER is a
 * wallet that has traded; a visit whose variable is not set is reported as
 * skipped rather than run against an address from somewhere else.
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium, devices } from "playwright";

const APP = (process.env.JUNO_APP_URL ?? "http://localhost:8181").replace(/\/$/, "");
const COIN = process.env.JUNO_FILM_COIN;
const TRACKER = process.env.JUNO_FILM_TRACKER;
const GRAD_V2 = process.env.JUNO_FILM_GRADUATED_V2;
const GRAD_KURU = process.env.JUNO_FILM_GRADUATED_KURU;
const TRADER = process.env.JUNO_FILM_TRADER;

const CHROMIUM = join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const browser = await chromium.launch({
  executablePath: process.env.JUNO_CHROMIUM ?? (existsSync(CHROMIUM) ? CHROMIUM : undefined),
});
const context = await browser.newContext({ ...devices["iPhone 15 Pro"], viewport: { width: 393, height: 852 } });

/** Privy's embedded-wallet frame is refused on an origin until it is allowed in the Privy dashboard; counted, not hidden. */
const privyFrame = (text) => /auth\.privy\.io|frame-ancestors|csp-report\.browser-intake-datadoghq/.test(text);

const report = {};
async function visit(id, path, act, needs) {
  if (path === null) {
    report[id] = { skipped: `set ${needs}` };
    return;
  }
  const page = await context.newPage();
  const errors = [];
  const failed = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 200)));
  page.on("pageerror", (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`));
  page.on("requestfailed", (r) => failed.push(`${r.failure()?.errorText} ${r.url().slice(0, 120)}`));
  page.on("response", (r) => r.status() >= 400 && failed.push(`${r.status()} ${r.request().method()} ${r.url().slice(0, 120)}`));
  await page.goto(`${APP}${path}`, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const result = { url: page.url().replace(APP, "") };
  try {
    if (act) Object.assign(result, await act(page));
  } catch (error) {
    result.actError = String(error).slice(0, 300);
  }
  result.text = result.text ?? (await page.locator("body").innerText()).replace(/\n+/g, " / ").slice(0, 700);
  result.consoleErrors = errors.filter((e) => !privyFrame(e));
  result.failedRequests = failed.filter((f) => !privyFrame(f));
  result.privyNoise = errors.concat(failed).filter(privyFrame);
  report[id] = result;
  await page.close();
}

const text = async (page) => (await page.locator("body").innerText()).replace(/\n+/g, " / ");
async function tap(page, name) {
  await page.getByText(name, { exact: true }).first().click({ timeout: 10000 });
  await page.waitForTimeout(1500);
}
/** Follow a link that opens a new tab, and report where it went. */
async function opens(page, name) {
  const [opened] = await Promise.all([
    context.waitForEvent("page", { timeout: 8000 }).catch(() => null),
    page.getByText(name, { exact: true }).last().click({ timeout: 10000 }),
  ]);
  if (!opened) return null;
  await opened.waitForLoadState("domcontentloaded").catch(() => {});
  const url = opened.url();
  await opened.close();
  return url;
}
const coin = (address) => (address ? `/coin/${address}` : null);

await visit("A1_landing", "/", async (page) => {
  const before = await text(page);
  await tap(page, "Get Started");
  await page.waitForTimeout(2000);
  return { landing: before.slice(0, 240), after: page.url().replace(APP, "") };
});
await visit("D1_feed", "/social");
await visit("D3_reels", "/reels", async (page) => {
  await page.waitForTimeout(6000);
  return {};
});
await visit("G1_preipo", "/trade");
await visit("G2_stocks", "/trade", async (page) => {
  await tap(page, "Stocks");
  return { text: (await text(page)).slice(0, 600) };
});
await visit("G2_memes", "/trade", async (page) => {
  await tap(page, "Memes");
  return { text: (await text(page)).slice(0, 600) };
});
await visit("G3_perps", "/trade", async (page) => {
  await tap(page, "Perps");
  await page.waitForTimeout(3000);
  return { text: (await text(page)).slice(0, 500) };
});
await visit("G5_traders", "/trade", async (page) => {
  await tap(page, "Traders");
  await page.waitForTimeout(2500);
  return { text: (await text(page)).slice(0, 400) };
});
await visit("E1_coin", coin(COIN), async (page) => {
  await page.waitForTimeout(2500);
  const main = await text(page);
  await tap(page, "Details");
  const details = await text(page);
  const at = details.lastIndexOf("Details");
  // A pressable that opens a tab, not an <a href>, so the link is followed rather than read.
  const explorer = await opens(page, "View the token on MonadVision");
  return { text: main.slice(0, 500), details: details.slice(at, at + 700), explorer };
}, "JUNO_FILM_COIN");
await visit("G1_tracker", coin(TRACKER), async (page) => {
  await page.waitForTimeout(3500);
  const main = await text(page);
  // The sheet opens for a visitor too; with no wallet there is no quote, but
  // the band warning is about the coin, not the trade, and is drawn anyway.
  await page.getByText("Buy", { exact: true }).last().click();
  await page.waitForTimeout(1500);
  const sheet = await text(page);
  const reference = main.indexOf(" reference");
  const warning = sheet.search(/outside its .+ band|price is stale/);
  return {
    text: main.slice(Math.max(reference - 40, 0), reference + 500),
    warning: warning < 0 ? null : sheet.slice(warning - 40, warning + 200),
  };
}, "JUNO_FILM_TRACKER");
await visit("E10_graduated_v2", coin(GRAD_V2), async (page) => {
  const main = await text(page);
  return { text: main.slice(0, 500), opens: await opens(page, "View the pair on MonadVision") };
}, "JUNO_FILM_GRADUATED_V2");
await visit("F1_kuru", coin(GRAD_KURU), async (page) => {
  await page.waitForTimeout(2500);
  const main = await text(page);
  const book = main.indexOf("Bid ");
  return {
    text: main.slice(0, 500),
    book: book < 0 ? null : main.slice(book, book + 120),
    opens: await opens(page, "View the Kuru market on MonadVision"),
  };
}, "JUNO_FILM_GRADUATED_KURU");
await visit("H4_trader", TRADER ? `/trader/${TRADER}` : null, async (page) => {
  await page.waitForTimeout(4000);
  return {};
}, "JUNO_FILM_TRADER");
await visit("C4_post_signed_out", "/post");
await visit("H1_profile_signed_out", "/profile");
await visit("A3_unknown_route", "/no-such-page");
await visit("A3_bad_coin", "/coin/0xnotanaddress");
await visit("A3_unknown_coin", "/coin/0x000000000000000000000000000000000000dead", async (page) => {
  await page.waitForTimeout(3000);
  return {};
});

await browser.close();
console.log(JSON.stringify(report, null, 1));
