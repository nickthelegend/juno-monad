// Shared by the e2e wave scripts: real Google Chrome (headless), a check
// runner that fails on any console error or warning and any failed or 4xx/5xx
// request, screenshots, and a funded visitor on the local fork.
import { mkdirSync } from "node:fs";
import path from "node:path";

import { chromium } from "playwright";
import { privateKeyToAccount } from "viem/accounts";

export const APP = (process.env.APP ?? "http://localhost:8183").replace(/\/$/, "");
export const API = (process.env.API ?? "http://localhost:3150").replace(/\/$/, "");
export const FORK_RPC = process.env.FORK_RPC ?? "http://127.0.0.1:8555";

export const VIEWPORTS = {
  desktop: { width: 1440, height: 900, isMobile: false },
  mobile: { width: 390, height: 844, isMobile: true },
};

export function harness({ shots, mode }) {
  mkdirSync(shots, { recursive: true });
  const results = [];
  const issues = [];
  let current = "setup";
  let browser = null;

  /**
   * A fresh browser context. The feed's first-run tips are marked as seen
   * unless `coach` is set: they are a first visit's, and every other check is
   * about something else.
   */
  async function open(viewport, { key = null, storage = {}, coach = false } = {}) {
    browser ??= await chromium.launch({ channel: "chrome", headless: true });
    const v = VIEWPORTS[viewport];
    const context = await browser.newContext({
      viewport: { width: v.width, height: v.height },
      deviceScaleFactor: 2,
      isMobile: v.isMobile,
      hasTouch: v.isMobile,
    });
    const seeded = { ...(coach ? {} : { "juno.coach.feed.v1": "done" }), ...storage, ...(key ? { "juno.monad.signer.v1": key } : {}) };
    if (Object.keys(seeded).length) {
      await context.addInitScript((entries) => {
        for (const [name, value] of Object.entries(entries)) window.localStorage.setItem(name, value);
      }, seeded);
    }
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

  async function shot(page, feature, viewport, { fullPage = false } = {}) {
    const file = path.join(shots, `${feature}-${mode}-${viewport}.png`);
    await page.screenshot({ path: file, fullPage });
    console.log(`  ${file}`);
    return file;
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
    return ok;
  }

  /**
   * A fresh device wallet holding `mon` MON, made in the app the way a
   * visitor makes one. The MON is set on the fork directly, so it spends none
   * of the faucet's per-address limit.
   */
  async function fundedVisitor(page, mon = 0.5) {
    await page.goto(`${APP}/profile?tab=wallet`, { waitUntil: "domcontentloaded" });
    await settle(page, 1000);
    await page.getByRole("button", { name: "Create wallet" }).first().click();
    await settle(page, 1500);
    const key = await page.evaluate(() => window.localStorage.getItem("juno.monad.signer.v1"));
    const address = privateKeyToAccount(key).address;
    await setBalance(address, mon);
    return { key, address };
  }

  /** Type an amount on the trade sheet's keypad. */
  async function keypad(page, digits) {
    for (const k of digits) {
      await page.getByText(k, { exact: true }).last().click();
      await wait(page, 120);
    }
    await wait(page, 1800);
  }

  async function finish() {
    await browser?.close();
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    if (failed.length) process.exitCode = 1;
  }

  return { open, wait, text, settle, until, shot, check, fundedVisitor, keypad, finish, results };
}

export async function setBalance(address, mon) {
  const wei = BigInt(Math.round(mon * 1e6)) * 10n ** 12n;
  await rpc("anvil_setBalance", [address, `0x${wei.toString(16)}`]);
}

export async function rpc(method, params = []) {
  const response = await fetch(FORK_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

export async function api(pathname, init) {
  const response = await fetch(`${API}${pathname}`, init);
  if (!response.ok) throw new Error(`${pathname} answered ${response.status}`);
  return response.json();
}
