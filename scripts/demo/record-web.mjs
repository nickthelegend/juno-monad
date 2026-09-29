/**
 * Record the film's phone chapters from the web app at iPhone size.
 *
 *   node scripts/demo/record-web.mjs .juno/video/raw [c01,c05|02-buy|stills] [--rehearse]
 *
 * Each take is a real session against the Expo web build (JUNO_APP_URL,
 * default http://localhost:8181) and the API behind it (JUNO_API_URL, default
 * http://localhost:3100) on Monad testnet: nothing is staged. Writes
 * <out>/<name>.mp4 (the bare screen, 393x852 CSS px), trimmed to start once
 * the page has loaded; c10 is a 1440x900 desktop take of MonadVision. `stills`
 * writes the opening's stills to <out>/stills/ at 3x. Needs Playwright and its
 * chrome-headless-shell (system Chrome's headless mode records the wrong
 * viewport on mobile emulation); JUNO_CHROMIUM points at the binary.
 *
 * The coins come from the environment or a flag, never from this file: the
 * ones worth filming only exist once the testnet deployment does.
 *
 *   JUNO_FILM_COIN            --coin=0x…            a post on its curve, in the feed (c02, c05)
 *   JUNO_FILM_OWN_COIN        --own-coin=0x…        a coin the film wallet launched, with fees
 *                                                   to claim (c04; default: the one c03 launched)
 *   JUNO_FILM_GRADUATED_V2    --graduated-v2=0x…    a Uniswap v2 coin, full or graduated (c06)
 *   JUNO_FILM_GRADUATED_KURU  --graduated-kuru=0x…  a Kuru coin, full or graduated (c07)
 *   JUNO_FILM_TRACKER         --tracker=0x…         a Pre-IPO tracker outside its band (c08)
 *   JUNO_FILM_PHOTO           --photo=path          the photo c03 posts
 *   JUNO_FILM_LAUNCHPAD       --launchpad=0x…       c10's contract (default: the launchpad in
 *                                                   contracts/deployments/10143.json)
 *
 * A coin that is full but not yet graduated is graduated on camera: the
 * button is there for anyone. The takes that sign (c02–c07) and the tracker's
 * quote (c08) run as the film wallet: a testnet key read from
 * JUNO_FILM_PRIVATE_KEY or .juno/film/wallet.key (gitignored) and put where
 * the web app keeps its device key before the page loads. The key is never
 * printed; its address and MON balance are. A take whose inputs are missing
 * is skipped with the reason. The film says Monad testnet, so a server on a
 * local fork (whose receipts say so) is refused unless --rehearse.
 *
 * What the takes produced — the coin c03 launched, the explorer links the
 * receipts opened — is kept in <out>/takes.json.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, devices } from "playwright";
import { privateKeyToAccount } from "viem/accounts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const APP = (process.env.JUNO_APP_URL ?? "http://localhost:8181").replace(/\/$/, "");
const API = (process.env.JUNO_API_URL ?? "http://localhost:3100").replace(/\/$/, "");
const [OUT, list] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const only = list ? new Set(list.split(",")) : null;
const REHEARSE = process.argv.includes("--rehearse");
if (!OUT) {
  console.error("usage: node scripts/demo/record-web.mjs <out dir> [c01,c05|02-buy|stills] [--rehearse]");
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

/** `--name=value`, else JUNO_FILM_<NAME>. */
function opt(name) {
  const flag = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (flag) return flag.slice(name.length + 3);
  return process.env[`JUNO_FILM_${name.toUpperCase().replace(/-/g, "_")}`] || null;
}

/** An address from the environment, or null. A malformed one is an error, not a skipped take. */
function address(name) {
  const value = opt(name);
  if (value && !/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error(`${name} is not an address: ${value}`);
  return value;
}

const STATE = join(OUT, "takes.json");
const record = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {};

const COIN = address("coin");
const GRAD_V2 = address("graduated-v2");
const GRAD_KURU = address("graduated-kuru");
const TRACKER = address("tracker");
const OWN_COIN = address("own-coin") ?? record.launched ?? null;
const PHOTO = opt("photo") && existsSync(opt("photo")) ? resolve(opt("photo")) : null;
const DEPLOYMENT = join(ROOT, "contracts", "deployments", "10143.json");
const LAUNCHPAD =
  address("launchpad") ?? (existsSync(DEPLOYMENT) ? JSON.parse(readFileSync(DEPLOYMENT, "utf8")).launchpad : null);

// Sizes, in the unit the sheet is denominated in: MON for a buy, tokens for
// an exact-out buy. Small, because the film wallet pays for every take.
const BUY = opt("buy") ?? "0.5";
const EXACT = opt("exact") ?? "100000";
const TRACKER_BUY = opt("tracker-buy") ?? "1";
const FIRST_BUY = opt("first-buy") ?? "1"; // one of the post screen's chips: 0, 1, 5, 10
const NAME = opt("name") ?? "Harbour Lights";
const TICKER = opt("ticker") ?? "HARBOR";
const CAPTION = opt("caption") ?? "Last ferry of the night.";

/** The film wallet's key: from the environment or the gitignored key file. Never printed. */
function filmKey() {
  const file = process.env.JUNO_FILM_KEY_FILE ?? join(ROOT, ".juno", "film", "wallet.key");
  const raw = process.env.JUNO_FILM_PRIVATE_KEY?.trim() || (existsSync(file) ? readFileSync(file, "utf8").trim() : "");
  if (!raw) return null;
  const key = raw.startsWith("0x") ? raw : `0x${raw}`;
  // Say where a bad key came from, never what it was.
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error(`${process.env.JUNO_FILM_PRIVATE_KEY ? "JUNO_FILM_PRIVATE_KEY" : file} is not a 32-byte hex private key`);
  }
  return key;
}
const KEY = filmKey();

/** What each take needs; a take missing any of them is skipped, with how to supply it. */
const INPUTS = {
  wallet: { value: KEY, how: "a funded film wallet (.juno/film/wallet.key or JUNO_FILM_PRIVATE_KEY)" },
  coin: { value: COIN, how: "JUNO_FILM_COIN" },
  ownCoin: { value: OWN_COIN, how: "JUNO_FILM_OWN_COIN, or record c03 first" },
  graduatedV2: { value: GRAD_V2, how: "JUNO_FILM_GRADUATED_V2" },
  graduatedKuru: { value: GRAD_KURU, how: "JUNO_FILM_GRADUATED_KURU" },
  tracker: { value: TRACKER, how: "JUNO_FILM_TRACKER" },
  photo: { value: PHOTO, how: "JUNO_FILM_PHOTO (an existing image file)" },
  launchpad: { value: LAUNCHPAD, how: "JUNO_FILM_LAUNCHPAD, or contracts/deployments/10143.json from the testnet deploy" },
};
const NEEDS = {
  "02-buy": ["wallet"],
  "03-launch": ["wallet", "photo"],
  "04-claim": ["wallet", "ownCoin"],
  "05-exact": ["wallet", "coin"],
  "06-graduated-v2": ["wallet", "graduatedV2"],
  "07-kuru": ["wallet", "graduatedKuru"],
  "08-tracker": ["wallet", "tracker"],
  "10-explorer": ["launchpad"],
};
/** Recorded as a desktop browser window rather than a phone. */
const DESKTOP = new Set(["10-explorer"]);

/** Eased scroll of the page's main scroller (React Native web scrolls a div). */
async function scroll(page, dy, ms = 1400) {
  await page.evaluate(
    ([dy, ms]) =>
      new Promise((done) => {
        const el = [...document.querySelectorAll("div")]
          .filter((d) => d.scrollHeight > d.clientHeight + 20 && /auto|scroll/.test(getComputedStyle(d).overflowY))
          .sort((a, b) => b.clientHeight - a.clientHeight)[0];
        if (!el) return done();
        const from = el.scrollTop;
        const t0 = performance.now();
        const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
        const step = (now) => {
          const t = Math.min(1, (now - t0) / ms);
          el.scrollTop = from + dy * ease(t);
          if (t < 1) requestAnimationFrame(step);
          else done();
        };
        requestAnimationFrame(step);
      }),
    [dy, ms],
  );
}

/** Scroll until `locator` sits in the upper part of the screen. Leaves the page alone if it is not there. */
async function scrollTo(page, locator, ms = 1600) {
  if (!(await locator.count())) return;
  const box = await locator.first().boundingBox();
  if (box) await scroll(page, box.y - 300, ms);
}

/** A soft touch marker where the "finger" lands, then the real click. */
async function tap(page, locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("tap target not visible");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.evaluate(([x, y]) => {
    const dot = document.createElement("div");
    dot.style.cssText = `position:fixed;left:${x - 22}px;top:${y - 22}px;width:44px;height:44px;border-radius:22px;background:rgba(18,21,14,0.28);border:2px solid rgba(255,255,255,0.7);z-index:99999;pointer-events:none;transition:transform .45s ease-out,opacity .45s ease-out`;
    document.body.appendChild(dot);
    requestAnimationFrame(() => requestAnimationFrame(() => { dot.style.transform = "scale(1.6)"; dot.style.opacity = "0"; }));
    setTimeout(() => dot.remove(), 600);
  }, [x, y]);
  await page.waitForTimeout(180);
  await page.mouse.click(x, y);
}

async function keypad(page, digits) {
  for (const d of digits) {
    await tap(page, page.getByText(d, { exact: true }).last());
    await page.waitForTimeout(260);
  }
}

/** Tap a field and type into it at a pace a viewer can read. */
async function typeInto(page, locator, text) {
  await tap(page, locator);
  await page.waitForTimeout(250);
  await page.keyboard.type(text, { delay: 85 });
  await page.waitForTimeout(400);
}

/** Wait for text to appear — a quote, a receipt — and fail the take with what it was waiting for. */
async function waitFor(page, text, ms) {
  await page
    .getByText(text)
    .first()
    .waitFor({ state: "visible", timeout: ms })
    .catch(() => {
      throw new Error(`waited ${ms / 1000}s for ${text}`);
    });
}

/** The sheet's own Buy: the last one on the page, since the sheet is drawn over everything else. */
const confirmBuy = (page) => page.getByText("Buy", { exact: true }).last();

/** Buy on the sheet that is open, wait for the receipt ("… confirmed on Monad in 0.4s."), and hold on it. */
async function buyAndHold(page, amount) {
  await keypad(page, amount);
  await waitFor(page, /You'll receive/, 20000);
  await page.waitForTimeout(2200);
  await tap(page, confirmBuy(page));
  await waitFor(page, /confirmed on/, 90000);
  await page.waitForTimeout(4500);
}

/** Tap a link that opens a new tab (an explorer page), note where it went, and close the tab. */
async function follow(page, locator) {
  const [opened] = await Promise.all([
    page.context().waitForEvent("page", { timeout: 8000 }).catch(() => null),
    tap(page, locator),
  ]);
  if (!opened) return null;
  await opened.waitForLoadState("domcontentloaded").catch(() => {});
  const url = opened.url();
  await opened.close();
  console.log("  opened", url);
  return url;
}

/** Load a page and let it settle. The feed polls, so a page that never goes quiet falls back to `load`. */
async function open(page, url, settle = 2500) {
  await page.goto(url, { waitUntil: "networkidle", timeout: 30000 }).catch((error) => {
    if (!/Timeout/i.test(String(error))) throw error;
  });
  await page.waitForTimeout(settle);
}

/** Scroll the feed until a Buy is on screen — this coin's, when one is named — and return it. */
async function findInFeed(page, symbol) {
  const target = symbol ? page.getByLabel(`Buy $${symbol}`, { exact: true }) : page.getByLabel(/^Buy \$/);
  for (let i = 0; i < 10; i++) {
    const n = await target.count();
    for (let k = 0; k < n; k++) {
      const box = await target.nth(k).boundingBox();
      if (box && box.y > 120 && box.y + box.height < 852 - 110) return target.nth(k);
    }
    await scroll(page, 380, 1300);
    await page.waitForTimeout(700);
  }
  throw new Error(symbol ? `no Buy for $${symbol} in the first ten screens of the feed` : "no Buy button in the feed");
}

async function api(path) {
  const response = await fetch(`${API}/api/juno${path}`);
  if (!response.ok) throw new Error(`GET ${path}: ${response.status}`);
  return response.json();
}

const TAKES = {
  // c01: the landing's network badge, the feed, then a reel with its market
  "01-feed": async (page) => {
    await open(page, `${APP}/`);
    return async () => {
      await page.waitForTimeout(2600); // "Monad testnet · no real money"
      await tap(page, page.getByText("Get Started", { exact: true }));
      await page.waitForTimeout(3000);
      await scroll(page, 420, 2200);
      await page.waitForTimeout(1500);
      await scroll(page, 520, 2400);
      await page.waitForTimeout(1500);
      await tap(page, page.getByLabel("Reels", { exact: true }));
      await page.waitForTimeout(4500);
      await scroll(page, 852, 900);
      await page.waitForTimeout(4000);
    };
  },
  // c02: a buy from the feed, the receipt with its measured confirmation time, its MonadVision link
  "02-buy": async (page) => {
    await open(page, `${APP}/social`);
    const symbol = COIN ? (await api(`/coins/${COIN}`)).coin?.symbol : null;
    return async () => {
      await page.waitForTimeout(1200);
      const buy = await findInFeed(page, symbol);
      await page.waitForTimeout(700);
      await tap(page, buy);
      await page.waitForTimeout(1400);
      await buyAndHold(page, BUY);
      record.buyTx = await follow(page, page.getByText("View the transaction", { exact: true }));
      await page.waitForTimeout(1200);
      await tap(page, page.getByText("Done", { exact: true }).last());
      await page.waitForTimeout(1500);
    };
  },
  // c03: Create → photo, name, curve, first buy → one transaction → the launch log → the coin
  "03-launch": async (page) => {
    await open(page, `${APP}/social`);
    return async () => {
      await page.waitForTimeout(1200);
      await tap(page, page.getByLabel("Create — a photo or a reel", { exact: true }));
      await page.waitForTimeout(1300);
      await tap(page, page.getByText("Post a photo", { exact: true }).last());
      await page.waitForURL(/\/post/, { timeout: 10000 });
      await page.waitForTimeout(1500);
      // expo-image-picker opens a file input on the web; the chooser answers it.
      const [chooser] = await Promise.all([
        page.waitForEvent("filechooser", { timeout: 10000 }),
        tap(page, page.getByText("Add a photo", { exact: true })),
      ]);
      await chooser.setFiles(PHOTO);
      await page.waitForTimeout(1800);
      await typeInto(page, page.getByPlaceholder("Night Market"), NAME);
      await typeInto(page, page.getByPlaceholder("NIGHT"), TICKER);
      await typeInto(page, page.getByPlaceholder("Say what this is"), CAPTION);
      await scroll(page, 520, 1800); // the four curve shapes
      await page.waitForTimeout(1800);
      await scroll(page, 640, 1600); // where it graduates, the first buy
      await page.waitForTimeout(1000);
      if (FIRST_BUY !== "0") await tap(page, page.getByText(`${FIRST_BUY} MON`, { exact: true }));
      await page.waitForTimeout(900);
      await tap(page, page.getByText("Launch post", { exact: true }));
      // The log fills with each receipt, holds for a beat, then the coin page opens.
      await page.waitForURL(/\/coin\/0x[0-9a-fA-F]{40}/, { timeout: 180000 });
      record.launched = page.url().match(/0x[0-9a-fA-F]{40}/)[0];
      console.log("  launched", record.launched);
      await page.waitForTimeout(3500);
    };
  },
  // c04: the creator's fees on their own coin, claimed in one transaction
  "04-claim": async (page) => {
    await open(page, `${APP}/coin/${OWN_COIN}`);
    // Only the creator sees the card, and there must be something on it.
    await waitFor(page, /ready to claim|Nothing to claim yet/, 20000).catch(() => {
      throw new Error("no fees card: the film wallet did not launch this coin");
    });
    if (await page.getByText("Nothing to claim yet. Fees build up as people trade.").count()) {
      throw new Error("nothing to claim yet: trade this coin from another wallet first (docs/FILM.md)");
    }
    return async () => {
      await page.waitForTimeout(1500);
      const claim = page.getByText("Claim", { exact: true });
      await scrollTo(page, claim);
      await page.waitForTimeout(2400);
      await tap(page, claim);
      await waitFor(page, "Claimed — view the transaction", 90000);
      await page.waitForTimeout(3500);
      record.claimTx = await follow(page, page.getByText("Claimed — view the transaction", { exact: true }));
      await page.waitForTimeout(1000);
    };
  },
  // c05: the token chip switched to "get exactly", the capped cost, the fill
  "05-exact": async (page) => {
    await open(page, `${APP}/coin/${COIN}`);
    return async () => {
      await page.waitForTimeout(1500);
      await tap(page, page.getByText("Buy", { exact: true }).last());
      await page.waitForTimeout(1400);
      await tap(page, page.getByLabel(/Switch to buying an exact number/));
      await page.waitForTimeout(1000);
      await keypad(page, EXACT);
      await waitFor(page, /Costs .+ at most/, 20000);
      await page.waitForTimeout(2600);
      await tap(page, confirmBuy(page));
      await waitFor(page, /confirmed on/, 90000);
      await page.waitForTimeout(4000);
      await tap(page, page.getByText("Done", { exact: true }).last());
      await page.waitForTimeout(2000); // the fill lands in Activity
    };
  },
  // c06: graduation into Uniswap v2 (on camera, if the curve is full), then a buy on the pair
  "06-graduated-v2": async (page) => {
    await open(page, `${APP}/coin/${GRAD_V2}`);
    if (!config.v2Trading) throw new Error("the API cannot trade a graduated v2 coin: set JUNO_SWAP_ROUTER on it");
    const full = (await page.getByText("Graduate", { exact: true }).count()) > 0;
    return async () => {
      await page.waitForTimeout(1800);
      if (full) {
        await tap(page, page.getByText("Graduate", { exact: true }));
        await waitFor(page, /Trades on its Uniswap v2 pair now/, 90000);
        await page.waitForTimeout(2000);
      }
      await scroll(page, 380, 2000);
      await page.waitForTimeout(3000);
      await tap(page, page.getByText("Buy", { exact: true }).last());
      await page.waitForTimeout(1400);
      await buyAndHold(page, BUY);
      await tap(page, page.getByText("Done", { exact: true }).last());
      await page.waitForTimeout(1200);
    };
  },
  // c07: graduation into Kuru (on camera, if the curve is full), the book, then a buy on it
  "07-kuru": async (page) => {
    await open(page, `${APP}/coin/${GRAD_KURU}`);
    const full = (await page.getByText("Open on Kuru", { exact: true }).count()) > 0;
    return async () => {
      await page.waitForTimeout(1800);
      if (full) {
        await tap(page, page.getByText("Open on Kuru", { exact: true }));
        await waitFor(page, /Trades on its own Kuru market now/, 90000);
        await page.waitForTimeout(2000);
      }
      await scroll(page, 380, 2000); // bid, ask and spread; the orders card
      await page.waitForTimeout(3200);
      await tap(page, page.getByText("Buy", { exact: true }).last());
      await page.waitForTimeout(1400);
      await buyAndHold(page, BUY);
      await tap(page, page.getByText("Done", { exact: true }).last());
      await page.waitForTimeout(1200);
    };
  },
  // c08, first half: the Pre-IPO list, each company with its Tessera mark
  "08-preipo": async (page) => {
    await open(page, `${APP}/trade`, 3000);
    return async () => {
      await page.waitForTimeout(2800);
      await scroll(page, 460, 2600);
      await page.waitForTimeout(2800);
      await scroll(page, 560, 2600);
      await page.waitForTimeout(2500);
    };
  },
  // c08, second half: a tracker's reference card, then the sheet's band warning. Nothing is signed.
  "08-tracker": async (page) => {
    await open(page, `${APP}/coin/${TRACKER}`, 3500);
    return async () => {
      await page.waitForTimeout(1200);
      await scrollTo(page, page.getByText(/ reference$/));
      await page.waitForTimeout(3000);
      await tap(page, page.getByText("Buy", { exact: true }).last());
      await page.waitForTimeout(1400);
      await keypad(page, TRACKER_BUY);
      await page.waitForTimeout(3500);
      if (!(await page.getByText(/outside its .+ band|price is stale/).count())) {
        console.log("  08-tracker: no band warning on screen — this tracker is inside its band");
      }
      await page.waitForTimeout(2500);
      await tap(page, page.getByLabel("Close", { exact: true }).last());
      await page.waitForTimeout(1200);
    };
  },
  // c10: the launchpad's verified source on MonadVision, in a desktop window
  "10-explorer": async (page) => {
    const explorer = (config?.explorer ?? "https://testnet.monadvision.com").replace(/\/$/, "");
    await page.goto(`${explorer}/address/${LAUNCHPAD}`, { waitUntil: "load" });
    await page.waitForTimeout(4000);
    return async () => {
      await page.waitForTimeout(2500);
      // The verified source sits under the explorer's contract tab. Its label
      // is the explorer's to choose, so look for it rather than assume.
      const tab = page.getByText(/^Contract$/).first();
      if (await tab.count()) {
        await tap(page, tab);
        await page.waitForTimeout(3500);
      } else {
        console.log("  10-explorer: no Contract tab found; recorded the address page as it is");
      }
      for (let i = 0; i < 4; i++) {
        await page.mouse.wheel(0, 220);
        await page.waitForTimeout(700);
      }
      await page.waitForTimeout(2500);
    };
  },
};

/** The opening's stills, at 3x like a simulator screenshot: build_hf.py's hero screen and cards. */
const STILLS = {
  "hero-screen": "/social",
  "card-preipo": "/trade",
  "card-graduated": GRAD_V2 ? `/coin/${GRAD_V2}` : null,
};

const selected = (name) => !only || only.has(name) || only.has(name.slice(0, 2)) || only.has(`c${name.slice(0, 2)}`);

// Which chain the server is on, before anything is filmed.
const config = await fetch(`${API}/api/juno/config`)
  .then((r) => (r.ok ? r.json() : null))
  .catch(() => null);
if (!config) {
  console.error(`No answer from ${API}/api/juno/config. Start the API against the testnet deployment (docs/FILM.md).`);
  process.exit(1);
}
if (config.network !== "monad-testnet") {
  console.error(`The API is on ${config.network}; the film says Monad testnet.`);
  process.exit(1);
}
if (config.localFork && !REHEARSE) {
  console.error("The API is on a local fork: its receipts say so, and the film says Monad testnet.");
  console.error("Point it at testnet (docs/FILM.md), or pass --rehearse for a practice run.");
  process.exit(1);
}
if (KEY) {
  const wallet = privateKeyToAccount(KEY).address;
  const mon = await api(`/tx/balance?wallet=${wallet}&token=0x0000000000000000000000000000000000000000`).catch(() => null);
  console.log("film wallet", wallet, mon && mon.balance !== null ? `holds ${mon.balance} MON` : "(balance not read)");
}

const CHROMIUM = join(
  homedir(),
  "Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell",
);
const browser = await chromium.launch({
  executablePath: process.env.JUNO_CHROMIUM ?? (existsSync(CHROMIUM) ? CHROMIUM : undefined),
});
for (const [name, take] of Object.entries(TAKES)) {
  if (!selected(name)) continue;
  const missing = (NEEDS[name] ?? []).filter((need) => !INPUTS[need].value);
  if (missing.length) {
    console.log(name, "skipped: needs", missing.map((need) => INPUTS[need].how).join("; "));
    continue;
  }
  const dir = join(OUT, `.rec-${name}`);
  rmSync(dir, { recursive: true, force: true });
  const context = await browser.newContext(
    DESKTOP.has(name)
      ? { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, recordVideo: { dir, size: { width: 1440, height: 900 } } }
      : {
          ...devices["iPhone 15 Pro"],
          // The whole screen, like the simulator (the preset's viewport leaves out
          // Safari's bars); 1x, because the recorder captures CSS pixels.
          viewport: { width: 393, height: 852 },
          screen: { width: 393, height: 852 },
          deviceScaleFactor: 1,
          recordVideo: { dir, size: { width: 393, height: 852 } },
        },
  );
  // The film wallet, where the web app keeps its device key, before any page
  // script runs; and the device key as the chosen signer rather than Privy.
  if (KEY && !DESKTOP.has(name)) {
    await context.addInitScript((key) => {
      try {
        localStorage.setItem("juno.monad.signer.v1", key);
        localStorage.setItem("juno.wallet.choice.v1", "local");
      } catch {}
    }, KEY);
  }
  const page = await context.newPage();
  const started = Date.now();
  let trimFrom;
  try {
    const play = await take(page);
    trimFrom = (Date.now() - started) / 1000;
    await play();
  } catch (error) {
    console.log(name, "failed:", String(error?.message ?? error).split("\n")[0]);
    await context.close();
    rmSync(dir, { recursive: true, force: true });
    continue;
  }
  // This page's video: a tab an explorer link opened has one of its own.
  const webm = await page.video().path();
  await context.close();
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-ss", trimFrom.toFixed(2), "-i", webm, "-r", "30", "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p", join(OUT, `${name}.mp4`)]);
  rmSync(dir, { recursive: true, force: true });
  writeFileSync(STATE, JSON.stringify(record, null, 1));
  console.log(name, "from", trimFrom.toFixed(1) + "s");
}

if (!only || only.has("stills")) {
  mkdirSync(join(OUT, "stills"), { recursive: true });
  const context = await browser.newContext({
    ...devices["iPhone 15 Pro"],
    viewport: { width: 393, height: 852 },
    screen: { width: 393, height: 852 },
    deviceScaleFactor: 3,
  });
  const page = await context.newPage();
  for (const [name, path] of Object.entries(STILLS)) {
    if (!path) {
      console.log(name, "skipped: needs", INPUTS.graduatedV2.how);
      continue;
    }
    await open(page, `${APP}${path}`, 3500);
    await page.screenshot({ path: join(OUT, "stills", `${name}.png`) });
    console.log("still", name);
  }
  await context.close();
}
await browser.close();
