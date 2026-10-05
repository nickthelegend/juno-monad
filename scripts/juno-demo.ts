/**
 * Demo data for Juno on Monad, made the way the phone makes it.
 *
 * A feed nobody has posted to reads as a broken app, and a market nobody has
 * traded has no chart, no holders and nothing under "Bought by". This gives a
 * deployment the same starting content the Solana demo had: five reels and
 * two photo posts (free-licence Pexels footage, already on IPFS), three
 * pre-IPO trackers marked against Tessera and two stock trackers marked
 * against Pyth, launched by named `demo_` wallets and traded between them,
 * with comments. `--round lifecycle` also takes two small coins through a
 * whole life: filled, graduated (one into Uniswap v2, one into Kuru) and
 * traded after it.
 *
 * Every step goes through the API exactly as the app does — the server builds
 * the unsigned transaction, the demo wallet signs it here, the server submits
 * and records it — so a clean run is also an end-to-end test of the deployed
 * trade path.
 *
 *   npx tsx scripts/juno-demo.ts [--api http://localhost:3100] [--round content|trade|lifecycle|all]
 *
 * Keys are made on first run and kept in `.juno/demo/<network>/` (gitignored).
 * On a local fork the wallets are funded with `anvil_setBalance`; on testnet
 * they are funded from the script key (`JUNO_SCRIPT_PRIVATE_KEY` or
 * `.juno/deployer.key`), which needs about 12 MON for `--round all` (the
 * wallets' trading money plus the launches' gas). Never runs against mainnet.
 * Idempotent: what already happened is recorded in `progress.json` and skipped.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  createWalletClient,
  formatEther,
  http,
  parseEther,
  type Hex,
  type PrivateKeyAccount,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { apiBase, arg, run, scriptAccount } from "./lib/cli";

const API = (arg("api") ?? apiBase()).replace(/\/$/, "");
const ROUND = arg("round", "all")!;
const IPFS = "https://gateway.pinata.cloud/ipfs";

type Config = {
  network: string;
  chainId: number;
  rpcUrl: string;
  localFork?: boolean;
  v2Trading?: boolean;
  venues?: Array<{ id: string }>;
};
type Step = {
  label: string;
  request: {
    chainId: number;
    to: Hex;
    data: Hex;
    value: Hex;
    nonce: number;
    gas: Hex;
    maxFeePerGas: Hex;
    maxPriorityFeePerGas: Hex;
  };
};

async function call<T>(route: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API}/api/juno${route}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(`${route} ${response.status}: ${json.error ?? "no body"}`);
  return json;
}

/** Sign each built step here, submit it there, in order. */
async function signAndSubmit(account: PrivateKeyAccount, steps: Step[]) {
  const landed: Array<{ hash: Hex; launched?: { token: Hex }; confirmedInMs?: number }> = [];
  for (const step of steps) {
    const r = step.request;
    const signed = await account.signTransaction({
      type: "eip1559",
      chainId: r.chainId,
      to: r.to,
      data: r.data,
      value: BigInt(r.value),
      nonce: r.nonce,
      gas: BigInt(r.gas),
      maxFeePerGas: BigInt(r.maxFeePerGas),
      maxPriorityFeePerGas: BigInt(r.maxPriorityFeePerGas),
    });
    landed.push(await call("/tx/submit", { signed }));
  }
  return landed;
}

/* ------------------------------------------------------------------ */
/* Wallets and progress                                                */
/* ------------------------------------------------------------------ */

const NAMES = ["demo_ana", "demo_kai", "demo_rio", "demo_lena"] as const;
type Name = (typeof NAMES)[number];

function walletDir(config: Config): string {
  const dir = path.join(".juno", "demo", config.localFork ? "fork" : config.network);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function wallet(config: Config, name: Name): PrivateKeyAccount {
  const file = path.join(walletDir(config), `${name}.key`);
  if (!existsSync(file)) writeFileSync(file, generatePrivateKey(), { mode: 0o600 });
  return privateKeyToAccount(readFileSync(file, "utf8").trim() as Hex);
}

type Progress = { launched: Record<string, Hex>; done: string[] };

function loadProgress(config: Config): Progress {
  const file = path.join(walletDir(config), "progress.json");
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Progress) : { launched: {}, done: [] };
}

function saveProgress(config: Config, progress: Progress) {
  writeFileSync(path.join(walletDir(config), "progress.json"), JSON.stringify(progress, null, 2));
}

async function balance(rpc: string, address: Hex): Promise<bigint> {
  const response = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [address, "latest"] }),
  });
  return BigInt(((await response.json()) as { result: Hex }).result);
}

/** Top each demo wallet up to `target` MON. */
async function fund(config: Config, rpc: string, accounts: PrivateKeyAccount[], target: bigint) {
  for (const account of accounts) {
    const held = await balance(rpc, account.address);
    if (held >= target) continue;
    if (config.localFork) {
      await fetch(rpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "anvil_setBalance", params: [account.address, `0x${target.toString(16)}`] }),
      });
    } else {
      const funder = scriptAccount();
      const client = createWalletClient({
        account: funder,
        transport: http(rpc),
        chain: { id: config.chainId, name: "Monad", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } },
      });
      const hash = await client.sendTransaction({ to: account.address, value: target - held });
      console.log(`  funded ${account.address} with ${formatEther(target - held)} MON (${hash})`);
    }
  }
}

async function claimName(account: PrivateKeyAccount, name: string) {
  const issuedAt = new Date().toISOString();
  const message = `Juno name: ${name}\nWallet: ${account.address}\nIssued: ${issuedAt}`;
  const signature = await account.signMessage({ message });
  await call("/profiles", { wallet: account.address, name, issuedAt, signature });
}

/* ------------------------------------------------------------------ */
/* What gets launched                                                  */
/* ------------------------------------------------------------------ */

type Launch = {
  key: string;
  creator: Name;
  name: string;
  symbol: string;
  description: string;
  preset: "content" | "thin-name" | "ipo-book" | "tight-nav";
  format: "post" | "reel";
  media: { cid: string; poster?: string; mime: string; width: number; height: number };
  nav?: string;
  venue?: "uniswap-v2" | "kuru";
  /** Caps in MON, for the small lifecycle coins; otherwise the app's defaults. */
  caps?: { initial: number; migration: number };
};

/** The Solana demo's own content: Pexels clips and photos, already pinned. */
const CONTENT: Launch[] = [
  { key: "AVE", creator: "demo_ana", name: "Midnight Avenue", symbol: "AVE", description: "The city after hours.", preset: "content", format: "reel", media: { cid: "QmUKAhjqYe35dYpRm4bXEqXaHBdggvQddVv6smkpUt9Xp3", poster: "QmRmKVEcSHCV2tEDA2UZ6JzBAG5CKsUPHPMWdwHiTvEau4", mime: "video/mp4", width: 720, height: 1280 } },
  { key: "NEON", creator: "demo_kai", name: "City After Rain", symbol: "NEON", description: "Neon, wet streets, 2am.", preset: "content", format: "reel", media: { cid: "QmYX6QBEyzHWm5cB4zA97oT5GhBVvnvgDNn3tf9d6r7AmK", poster: "QmY4VuQhFWeReFPrfUAJX3LXASnQHjb7UBAteZ4m4GDcXc", mime: "video/mp4", width: 720, height: 1280 } },
  { key: "KICK", creator: "demo_rio", name: "Park Session", symbol: "KICK", description: "Kickflip practice before the rain.", preset: "content", format: "reel", media: { cid: "Qmb5k2eTcqvu9XJZfEN2wXsgj2Ddq9u5qNjBJ9jRB7pags", poster: "QmeZ89H8eJwqrdaRgH1FWrQebJEk9F6vk4SGPCrf4e2K7u", mime: "video/mp4", width: 720, height: 1280 } },
  { key: "SURF", creator: "demo_lena", name: "Board Check", symbol: "SURF", description: "Wax on, then paddle out.", preset: "content", format: "reel", media: { cid: "QmNT3Cq1za3zNCjYLmtxkyD5RYXknMftBXUiTQZESoa1Bt", poster: "QmaLJFi1Z3zVqAPZhc6rHy1nxGrKrdzM7yJaUi4tXcvbpi", mime: "video/mp4", width: 720, height: 1280 } },
  { key: "TIDE", creator: "demo_ana", name: "Last Light, Low Tide", symbol: "TIDE", description: "Dusk at the beach. One surfer still out.", preset: "content", format: "reel", media: { cid: "QmdXCVRYkZnBDJuPW4KyAQgdbcBJuezY5aW3wsosYtkxhe", poster: "QmUnwbLu1e8gqvqMjuytmcbKdjTAqn55az9ZUcmh1PdW8J", mime: "video/mp4", width: 720, height: 1280 } },
  { key: "BLOOM", creator: "demo_kai", name: "Wild Bloom", symbol: "BLOOM", description: "Spring, all at once.", preset: "content", format: "post", media: { cid: "QmZsvmG3ftAb3dHMMwhLcMzjiGgSGQSLWY4aFEbLHcDPQB", mime: "image/jpeg", width: 4032, height: 3024 } },
  { key: "FALLS", creator: "demo_rio", name: "The Falls", symbol: "FALLS", description: "First light.", preset: "content", format: "post", media: { cid: "QmdPaKD9DuWJ9b2DSPoSQFLaBvKGPcpMs4Lq5XUVTPPd4t", mime: "image/jpeg", width: 3000, height: 2002 } },
  { key: "OPENAIX", creator: "demo_lena", name: "OpenAI Pre-IPO Tracker", symbol: "OPENAIX", description: "A tight-NAV curve marked against Tessera's T-OpenAI mark. Pyth has no feed for a company that has not listed.", preset: "tight-nav", format: "post", nav: "tessera:T-OpenAI", media: { cid: "QmartGLguKtVsx1SLnEUs8HnaQbmJodhJKfcHfp941H7dJ", mime: "image/jpeg", width: 1024, height: 1024 } },
  { key: "KALSHIX", creator: "demo_kai", name: "Kalshi Pre-IPO Book", symbol: "KALSHIX", description: "Front-loaded liquidity against Tessera's T-Kalshi mark: a thin name should fill early size at the issue price.", preset: "thin-name", format: "post", nav: "tessera:T-Kalshi", media: { cid: "QmVFD9q6frrWy5j1jeoYDySyXt7wZsr3i93MVxy1x4eWDX", mime: "image/jpeg", width: 1024, height: 1024 } },
  { key: "SPACEXX", creator: "demo_rio", name: "SpaceX Pre-IPO Book", symbol: "SPACEXX", description: "Deep at both ends against Tessera's T-SpaceX mark — an issuance book for a company that has not floated.", preset: "ipo-book", format: "post", nav: "tessera:T-SpaceX", media: { cid: "QmdF6ZpLKDT2dgGtpY1X4ZWku4VFYSsf8mkDdXHQSBpxxC", mime: "image/jpeg", width: 1024, height: 1024 } },
  { key: "NVDAXI", creator: "demo_ana", name: "NVDA Tracker", symbol: "NVDAXI", description: "NVDA exposure on a thin-name curve, marked against Pyth's NVDA/USD.", preset: "thin-name", format: "post", nav: "Equity.US.NVDA/USD", media: { cid: "QmXQHVnTSSQvE4Tz9z86tEKUwVqYqGVh8Yw7Q77uTPNqNB", mime: "image/jpeg", width: 1024, height: 1024 } },
  { key: "AAPLXI", creator: "demo_lena", name: "AAPL Tracker", symbol: "AAPLXI", description: "AAPL exposure on an IPO-book curve, marked against Pyth's AAPL/USD.", preset: "ipo-book", format: "post", nav: "Equity.US.AAPL/USD", media: { cid: "QmanyL1GktiGv6kYfMzuvjL3Bt8JEfnYs3GCaURZdGdzbs", mime: "image/jpeg", width: 1024, height: 1024 } },
];

/** Two small coins for a whole life on a budget: filled, graduated, traded after. */
const LIFECYCLE: Launch[] = [
  { key: "GRADV2", creator: "demo_kai", name: "Graduation, Uniswap v2", symbol: "GRADV2", description: "A deliberately small curve, filled and graduated into its Uniswap v2 pair, then traded there.", preset: "content", format: "post", caps: { initial: 0.1, migration: 2.5 }, media: { cid: "QmdPaKD9DuWJ9b2DSPoSQFLaBvKGPcpMs4Lq5XUVTPPd4t", mime: "image/jpeg", width: 3000, height: 2002 } },
  { key: "GRADKURU", creator: "demo_rio", name: "Graduation, Kuru", symbol: "GRADKURU", description: "A small curve that graduates into its own Kuru order-book market.", preset: "content", format: "post", venue: "kuru", caps: { initial: 0.5, migration: 12.5 }, media: { cid: "QmZsvmG3ftAb3dHMMwhLcMzjiGgSGQSLWY4aFEbLHcDPQB", mime: "image/jpeg", width: 4032, height: 3024 } },
];

async function launch(config: Config, progress: Progress, item: Launch, account: PrivateKeyAccount) {
  if (progress.launched[item.key]) return progress.launched[item.key];
  const still = item.media.poster ?? item.media.cid;
  const metadata = await call<{ uri: string }>("/metadata", {
    name: item.name,
    symbol: item.symbol,
    description: item.description,
    curvePreset: item.preset,
    imageUrl: `${IPFS}/${still}`,
    mimeType: "image/jpeg",
  });
  const built = await call<{ steps: Step[]; token: Hex }>("/tx/launch", {
    creator: account.address,
    name: item.name,
    symbol: item.symbol,
    preset: item.preset,
    uri: metadata.uri,
    quoteToken: "0x0000000000000000000000000000000000000000",
    venue: item.venue,
    ...(item.caps ? { initialMarketCap: item.caps.initial, migrationMarketCap: item.caps.migration } : {}),
  });
  const landed = await signAndSubmit(account, built.steps);
  const last = landed[landed.length - 1];
  const token = last.launched?.token ?? built.token;
  await call("/pools", {
    token,
    name: item.name,
    symbol: item.symbol,
    format: item.format,
    curvePreset: item.preset,
    createTx: last.hash,
    description: item.description,
    mediaUrl: `ipfs://${item.media.cid}`,
    posterUrl: `ipfs://${still}`,
    mediaMime: item.media.mime,
    mediaWidth: item.media.width,
    mediaHeight: item.media.height,
    navFeedId: item.nav,
  });
  progress.launched[item.key] = token;
  saveProgress(config, progress);
  console.log(`  ${item.symbol.padEnd(9)} ${token}  by ${item.creator}  (${last.hash})`);
  return token;
}

/* ------------------------------------------------------------------ */
/* Trades                                                              */
/* ------------------------------------------------------------------ */

type Trade = { who: Name; coin: string; side: "buy" | "sell"; size: number; note?: string };

/** Sizes are in units: MON on a buy, a share of the wallet's holding on a sell. */
const TRADES: Trade[] = [
  { who: "demo_kai", coin: "AVE", side: "buy", size: 2, note: "The light on that street." },
  { who: "demo_rio", coin: "AVE", side: "buy", size: 1 },
  { who: "demo_lena", coin: "NEON", side: "buy", size: 3, note: "Early on this one." },
  { who: "demo_ana", coin: "KICK", side: "buy", size: 2, note: "That landing though." },
  { who: "demo_kai", coin: "SURF", side: "buy", size: 1.5 },
  { who: "demo_rio", coin: "TIDE", side: "buy", size: 2 },
  { who: "demo_lena", coin: "BLOOM", side: "buy", size: 1 },
  { who: "demo_ana", coin: "FALLS", side: "buy", size: 1.5 },
  { who: "demo_kai", coin: "OPENAIX", side: "buy", size: 2, note: "Tracking the mark closely." },
  { who: "demo_rio", coin: "KALSHIX", side: "buy", size: 2 },
  { who: "demo_ana", coin: "SPACEXX", side: "buy", size: 1 },
  { who: "demo_kai", coin: "NVDAXI", side: "buy", size: 1 },
  { who: "demo_rio", coin: "AAPLXI", side: "buy", size: 1 },
  { who: "demo_rio", coin: "AVE", side: "sell", size: 0.5, note: "Took half off." },
  { who: "demo_ana", coin: "NEON", side: "buy", size: 1 },
];

async function holding(token: Hex, owner: Hex): Promise<number> {
  const { balance: held } = await call<{ balance: number }>(`/tx/balance?wallet=${owner}&token=${token}`);
  return held;
}

async function trade(
  config: Config,
  progress: Progress,
  id: string,
  who: PrivateKeyAccount,
  token: Hex,
  side: "buy" | "sell",
  amount: number,
  note?: string,
) {
  if (progress.done.includes(id)) return;
  if (!(amount > 0)) return;
  const built = await call<{ steps: Step[]; quote: { amountOut: number }; venue?: string }>("/tx/swap", {
    token,
    owner: who.address,
    side,
    amountIn: amount,
    slippageBps: 300,
  });
  const landed = await signAndSubmit(who, built.steps);
  const hash = landed[landed.length - 1].hash;
  if (note) await call("/comments", { token, wallet: who.address, body: note, side, txHash: hash }).catch(() => undefined);
  progress.done.push(id);
  saveProgress(config, progress);
  console.log(`  ${id.padEnd(28)} ${side} ${amount.toFixed(4)} → ${built.quote.amountOut.toFixed(4)}${built.venue && built.venue !== "curve" ? ` on ${built.venue}` : ""}`);
}

/* ------------------------------------------------------------------ */

run(async () => {
  const config = await call<Config>("/config");
  if (config.network === "monad") throw new Error("Demo data is for testnet or a local fork, never mainnet.");
  const rpc = config.localFork ? (arg("rpc") ?? "http://127.0.0.1:8545") : config.rpcUrl;
  // A unit of trading: generous on a fork, small on testnet where MON is scarce.
  const unit = config.localFork ? 10 : 0.05;
  console.log(`Juno demo on ${config.localFork ? "a local fork of " : ""}${config.network} via ${API}, round ${ROUND}`);

  const accounts = Object.fromEntries(NAMES.map((name) => [name, wallet(config, name)])) as Record<Name, PrivateKeyAccount>;
  const progress = loadProgress(config);
  const lifecycle = ROUND === "lifecycle" || ROUND === "all";
  // demo_lena fills the two lifecycle curves (about 0.9 and 3.5 MON, sent
  // with 30% to spare and refunded); everyone else only trades small.
  if (config.localFork) {
    await fund(config, rpc, Object.values(accounts), parseEther("2000"));
  } else {
    await fund(config, rpc, NAMES.filter((name) => name !== "demo_lena").map((name) => accounts[name]), parseEther("1.5"));
    await fund(config, rpc, [accounts.demo_lena], parseEther(lifecycle ? "7" : "1.5"));
  }

  for (const name of NAMES) {
    if (progress.done.includes(`name:${name}`)) continue;
    await claimName(accounts[name], name).catch((error) => console.log(`  name ${name}: ${(error as Error).message}`));
    progress.done.push(`name:${name}`);
    saveProgress(config, progress);
  }

  if (ROUND === "content" || ROUND === "all" || ROUND === "trade") {
    console.log("Launches");
    for (const item of CONTENT) await launch(config, progress, item, accounts[item.creator]);
  }

  if (ROUND === "trade" || ROUND === "all") {
    console.log("Trades");
    for (const [index, step] of TRADES.entries()) {
      const token = progress.launched[step.coin];
      if (!token) continue;
      const who = accounts[step.who];
      const amount = step.side === "buy" ? step.size * unit : (await holding(token, who.address)) * step.size;
      await trade(config, progress, `${index}:${step.who}:${step.side}:${step.coin}`, who, token, step.side, amount, step.note);
    }
  }

  if (lifecycle) {
    console.log("Lifecycle");
    for (const item of LIFECYCLE) {
      if (item.venue === "kuru" && !config.venues?.some((venue) => venue.id === "kuru")) continue;
      const creator = accounts[item.creator];
      const token = await launch(config, progress, item, creator);
      const { coin } = await call<{
        coin: { curve: { complete: boolean; graduated: boolean; thresholdUsd: number }; quoteUsdRate: number | null };
      }>(`/coins/${token}`);
      const buyer = accounts.demo_lena;
      if (!coin.curve.complete && !coin.curve.graduated) {
        // A buy bigger than what is left fills it and refunds the rest.
        const rate = coin.quoteUsdRate ?? 0.025;
        const fill = (coin.curve.thresholdUsd / rate) * 1.3;
        await trade(config, progress, `fill:${item.key}`, buyer, token, "buy", fill);
      }
      if (!progress.done.includes(`graduate:${item.key}`)) {
        const built = await call<{ steps: Step[] }>("/tx/graduate", { from: buyer.address, token });
        const landed = await signAndSubmit(buyer, built.steps);
        progress.done.push(`graduate:${item.key}`);
        saveProgress(config, progress);
        console.log(`  graduate:${item.key.padEnd(20)} ${landed[landed.length - 1].hash}`);
      }
      // Trading carries on where it graduated to.
      await trade(config, progress, `after:${item.key}:buy`, accounts.demo_ana, token, "buy", unit * 0.5, "Bought after it graduated.");
      await trade(config, progress, `after:${item.key}:sell`, accounts.demo_ana, token, "sell", (await holding(token, accounts.demo_ana.address)) * 0.5);
    }
    // The creator's payday.
    const bloom = progress.launched.BLOOM;
    if (bloom && !progress.done.includes("claim:BLOOM")) {
      const built = await call<{ steps: Step[] }>("/tx/claim", { creator: accounts.demo_kai.address, token: bloom });
      const landed = await signAndSubmit(accounts.demo_kai, built.steps);
      progress.done.push("claim:BLOOM");
      saveProgress(config, progress);
      console.log(`  claim:BLOOM ${landed[landed.length - 1].hash}`);
    }
  }

  console.log("Done. Progress in", path.join(walletDir(config), "progress.json"));
});
