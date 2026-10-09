// Wave 3 (9 Oct): readability and finding things. Checks and after shots.
//
//   APP=http://localhost:8183 API=http://localhost:3150 node tests/e2e/wave3.mjs
//
// Features: receipt (one glance, details collapsed), heartbeat (source as a
// chip), search, coin-card. Before shots are wave 2's after shots, copied.
import { writeFileSync } from "node:fs";
import path from "node:path";

import { API, APP, api, harness } from "./harness.mjs";

const SHOTS = path.resolve("docs/screens/wave3");
const h = harness({ shots: SHOTS, mode: "after" });
const { open, wait, settle, until, shot, check, fundedVisitor, keypad } = h;
const { coins } = await api("/api/juno/coins?limit=60");
const kuruCoin = coins.find((coin) => coin.venue === "kuru" && coin.kuru);

const pngSize = (bytes) => [(bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19], (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23]];

for (const viewport of ["mobile", "desktop"]) {
  const { context, page } = await open(viewport);

  await check(`Receipt at a glance · ${viewport}`, async () => {
    await fundedVisitor(page, 20);
    await page.goto(`${APP}/coin/${kuruCoin.address}`, { waitUntil: "domcontentloaded" });
    await settle(page, 1500);
    await page.getByRole("button", { name: /^Buy$/ }).first().click();
    await wait(page, 1500);
    await keypad(page, "0.1");
    const submitted = page.waitForResponse((r) => r.url().includes("/api/juno/tx/submit") && r.request().method() === "POST");
    await page.getByRole("button", { name: /^Buy/ }).last().click();
    const result = await (await submitted).json();
    if (!(await until(page, /Done/, 25_000))) return ["no receipt"];
    await page.getByTestId("speed-ethereum").first().waitFor({ timeout: 15_000 }).catch(() => undefined);
    await wait(page, 1500);
    await shot(page, "receipt", viewport);
    const problems = [];
    if (await page.getByTestId("speed-details").count()) problems.push("details open by default");
    const shownMs = Number((await page.getByTestId("speed-ms").first().innerText()).replace(/[^0-9]/g, ""));
    if (shownMs !== result.confirmedInMs) problems.push(`shows ${shownMs} ms, measured ${result.confirmedInMs}`);
    await page.getByTestId("speed-details-toggle").first().click();
    await wait(page, 500);
    const cost = await api(`/api/juno/tx/cost?hash=${result.hash}`);
    const fee = Number((await page.getByTestId("speed-fee").first().innerText()).match(/[\d.]+/)?.[0]);
    if (!(Math.abs(fee - cost.monad.feeMon) <= cost.monad.feeMon * 0.05)) problems.push(`fee ${fee} vs ${cost.monad.feeMon}`);
    if (!(await until(page, /Signed here/, 3_000))) problems.push("details lack the signing time");
    return problems;
  });

  await check(`Heartbeat source as a chip · ${viewport}`, async () => {
    await page.goto(`${APP}/`, { waitUntil: "domcontentloaded" });
    await settle(page, 4000);
    await page.getByTestId("heartbeat").first().scrollIntoViewIfNeeded().catch(() => undefined);
    await shot(page, "heartbeat", viewport);
    const text = await page.evaluate(() => document.body.innerText);
    const problems = [];
    if (/Read live from/.test(text)) problems.push("still the caveat sentence");
    if (!/trades here: local fork/.test(text)) problems.push("no source chip");
    return problems;
  });

  await check(`Search · ${viewport}`, async () => {
    await page.goto(`${APP}/social`, { waitUntil: "domcontentloaded" });
    await settle(page, 2000);
    await page.getByRole("button", { name: "Search" }).first().click();
    await wait(page, 1200);
    await page.getByRole("textbox", { name: "Search coins and creators" }).fill(`$${kuruCoin.symbol.slice(0, 5).toLowerCase()}`);
    await wait(page, 800);
    await shot(page, "search", viewport);
    const hits = await page.getByTestId("search-coin").allInnerTexts();
    if (!hits[0]?.includes(`$${kuruCoin.symbol}`)) return [`first hit ${JSON.stringify(hits[0])}`];
    await page.getByTestId("search-coin").first().click();
    await wait(page, 2000);
    return page.url().toLowerCase().includes(kuruCoin.address.toLowerCase()) ? [] : [`opened ${page.url()}`];
  });

  await context.close();
}

await check("Coin card", async () => {
  const problems = [];
  const response = await fetch(`${API}/api/juno/coins/${kuruCoin.address}/card`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const [w, hgt] = pngSize(bytes);
  if (response.headers.get("content-type") !== "image/png" || w !== 1200 || hgt !== 630) problems.push(`card ${response.status} ${w}x${hgt}`);
  writeFileSync(path.join(SHOTS, "coin-card-after.png"), bytes);
  const missing = await fetch(`${API}/api/juno/coins/0x${"12".repeat(20)}/card`);
  if (missing.status !== 404) problems.push(`unknown coin answered ${missing.status}`);
  return problems;
});

await h.finish();
