import { createPublicClient, getAddress, http, parseAbi, zeroAddress, type Address, type Hex, type PublicClient } from "viem";

import { publicClient } from "./client";
import { chain, isMainnet, localFork } from "./network";
import { tryRead, ttlCache } from "./rpc";

/**
 * Pyth price feeds, read from Pyth's contract on Monad.
 *
 * Two jobs. First, quoting a MON-denominated pool in dollars honestly — market
 * caps in MON terms are not comparable across pools. Second, the NAV band: an
 * equity-preset launch is supposed to track an underlying, and a bonding curve
 * has no idea what the underlying costs. Pyth is what closes that loop, which
 * is why `navBandBps` exists on the equity presets.
 *
 * ## Read on Monad, from the contract a Monad program would read
 *
 * Pyth is a pull oracle on EVM chains: a price is on-chain once someone posts
 * a signed update to the Pyth contract, and `getPriceUnsafe` returns whatever
 * was posted last with its publish time. Reading it costs one `eth_call` and no
 * key — and the number the UI shows is the number a Monad contract would see.
 *
 * ## Two contracts, and they are not equally fresh
 *
 * Monad has Pyth's original contract and an upgraded one. Measured on
 * 2026-09-23, Pyth's sponsored pushes keep MON/USD and the major crypto feeds
 * current on the upgraded contract; the original's testnet MON/USD was two
 * weeks old. So both are read and the newer `publishTime` wins — the same rule,
 * for the same reason, as reading the freshest shard of Pyth's Solana accounts.
 *
 * ## Equities are not pushed on Monad
 *
 * Nobody posts AAPL or NVDA to Monad on a schedule. The original contract
 * holds marks weeks or months old and the upgraded one has no equity feeds at
 * all. A fresh equity mark needs a signed update from Hermes, Pyth's price
 * service, which has required an API key since 2026-08-26. With
 * `PYTH_API_KEY` set, equity marks come from Hermes and `scripts/pyth-push.ts`
 * can post them on-chain; without it, the on-chain mark is shown with its real
 * age and labelled stale. An old price presented as live is the kind of thing
 * someone trades on.
 *
 * ## Market hours
 *
 * An equity feed stops updating when the exchange closes, so on a Sunday AAPL
 * is legitimately hours old. That is Friday's close, not a broken read, and the
 * two must not be conflated: `PythPrice` reports age and lets the caller
 * decide, and the UI labels a closed market as a last close.
 */

const PYTH_ABI = parseAbi([
  "function getPriceUnsafe(bytes32 id) view returns ((int64 price, uint64 conf, int32 expo, uint256 publishTime))",
  "function getUpdateFee(bytes[] updateData) view returns (uint256 feeAmount)",
  "function updatePriceFeeds(bytes[] updateData) payable",
]);

/** Pyth's upgraded contract on Monad — where the sponsored pushes land. */
const PYTH_UPGRADED: Record<"testnet" | "mainnet", Address> = {
  testnet: "0xFC6bd9F9f0c6481c6Af3A7Eb46b296A5B85ed379",
  mainnet: "0xB754BA51E3861Ac0Cb67f73CD046dE790A36508d",
};

/** Pyth's original contract, at the same address on both networks. */
const PYTH_ORIGINAL: Address = "0x2880aB155794e7179c9eE2e38200202908C17B43";

export function pythContracts(): Address[] {
  const override = process.env.PYTH_CONTRACT?.trim();
  if (override) return [getAddress(override)];
  return [PYTH_UPGRADED[isMainnet() ? "mainnet" : "testnet"], PYTH_ORIGINAL];
}

/** The contract `scripts/pyth-push.ts` posts updates to. */
export function pythWriteContract(): Address {
  return pythContracts()[0];
}

/**
 * Feed ids, verified against Hermes `/v2/price_feeds` — which needs no key, so
 * the catalogue is checkable even though the latest prices are not.
 *
 * Equities are the ones the curve presets care about. MON/USD is here because
 * a MON-quoted pool cannot be priced in dollars without it.
 */
export const PYTH_FEEDS = {
  "Crypto.MON/USD": "31491744e2dbf6df7fcf4ac0820d18a609b49076d45066d3568424e62f686cd1",
  "Crypto.USDC/USD": "eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a",
  /** For the receipt's "the same gas on Ethereum" line, not for any market. */
  "Crypto.ETH/USD": "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
  "Equity.US.AAPL/USD": "49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688",
  "Equity.US.NVDA/USD": "b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593",
  "Equity.US.TSLA/USD": "16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1",
  "Equity.US.MSFT/USD": "d0ca23c1cc005e004ccf1db5bf76aeb6a49218f43dac3d4b275e92de12ded4d1",
  "Equity.US.GOOGL/USD": "5a48c03e9b9cb337801073ed9d166817473697efff0d138874e0f6a33d6d5aa6",
  "Equity.US.AMZN/USD": "b5d0e0fa58a1f8b81498ae670ce93c872d14434b72c364885d4fa1b257cbb07a",
  "Equity.US.META/USD": "78a3e3b8e676a8f73c439f5d749737034b139bbbe899ba5775216fba596607fe",
  /*
   * SpaceX, on the ordinary equity rail — the one pre-IPO name Pyth publishes
   * as a listed-style equity feed. It trades on NYSE hours, so a weekend read
   * is Friday's close; the equity freshness window already covers that and
   * `marketState` labels it. OpenAI and Anthropic have no feed Juno can read
   * without Pyth Pro, so Tessera is the reference for those.
   */
  "Equity.US.SPCX/USD": "8a593d6edde7a3095213c88116d8840d01e93c2ddeb800bc891772eb8b93bb94",
} as const;

export type PythFeedName = keyof typeof PYTH_FEEDS;

export type PythPrice = {
  /** The 32-byte feed id, hex, no prefix. */
  feed: string;
  priceUsd: number;
  /** Pyth's own confidence interval, in dollars. */
  confidence: number;
  publishedAt: string;
  /** Seconds since the publisher last moved this feed. */
  ageSeconds: number;
  /** Where this reading came from: a Pyth contract on Monad, or Hermes. */
  source: Address | "hermes";
};

export function feedIdFor(name: string | null | undefined): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  if (trimmed in PYTH_FEEDS) return PYTH_FEEDS[trimmed as PythFeedName];
  const bare = trimmed.replace(/^0x/, "");
  return /^[0-9a-f]{64}$/i.test(bare) ? bare.toLowerCase() : null;
}

/** Human label for a feed id, when we happen to know one. */
export function feedNameFor(feedId: string): string | null {
  const normalised = feedId.replace(/^0x/, "").toLowerCase();
  for (const [name, id] of Object.entries(PYTH_FEEDS)) {
    if (id === normalised) return name;
  }
  return null;
}

/** True for a feed that only trades during exchange hours. */
export function isEquityFeed(feedId: string): boolean {
  return feedNameFor(feedId)?.startsWith("Equity.") ?? false;
}

function scaled(value: bigint, expo: number): number {
  return Number(value) * 10 ** expo;
}

/** One contract's reading of one feed, or null when it has none. */
/**
 * Where Pyth's prices are read from.
 *
 * On Monad, the chain the app runs on. On a local fork, the network the fork
 * was taken from: the fork holds a frozen copy of Pyth's contracts that
 * nothing pushes to, so its MON/USD is exactly as old as the fork — measured
 * at eleven hours on 2026-09-29, 1.3% off, and every dollar figure in the app
 * was converted at it without a word. No Juno contract reads Pyth (the price
 * is for display and the NAV band), so the live network's price is the real
 * one and the fork's is a snapshot.
 */
let livePyth: PublicClient | null = null;
function pythClient(): PublicClient {
  if (!localFork()) return publicClient();
  livePyth ??= createPublicClient({
    chain: chain(),
    transport: http(chain().rpcUrls.default.http[0], { timeout: 10_000, retryCount: 1 }),
  }) as PublicClient;
  return livePyth;
}

async function readContractPrice(contract: Address, id: string): Promise<PythPrice | null> {
  const result = await tryRead(() =>
    pythClient().readContract({
      address: contract,
      abi: PYTH_ABI,
      functionName: "getPriceUnsafe",
      args: [`0x${id}` as Hex],
    }),
  );
  // `PriceFeedNotFound` reverts; `tryRead` turns that into null.
  if (!result || result.publishTime === 0n || result.price <= 0n) return null;
  const publishedMs = Number(result.publishTime) * 1000;
  return {
    feed: id,
    priceUsd: scaled(result.price, result.expo),
    confidence: scaled(result.conf, result.expo),
    publishedAt: new Date(publishedMs).toISOString(),
    ageSeconds: Math.max(0, Math.round((Date.now() - publishedMs) / 1000)),
    source: contract,
  };
}

/* ------------------------------------------------------------------ */
/* Hermes, when there is a key                                         */
/* ------------------------------------------------------------------ */

function hermesUrl(): string {
  return process.env.PYTH_HERMES_URL?.trim() || "https://hermes.pyth.network";
}

function hermesKey(): string | null {
  return process.env.PYTH_API_KEY?.trim() || null;
}

type HermesLatest = {
  binary: { encoding: string; data: string[] };
  parsed: Array<{ id: string; price: { price: string; conf: string; expo: number; publish_time: number } }>;
};

/**
 * The latest signed update for some feeds, or null without a key.
 *
 * `binary` is what `updatePriceFeeds` takes; `parsed` is the same prices,
 * readable. Both come from one request.
 */
export async function hermesLatest(ids: string[]): Promise<HermesLatest | null> {
  const key = hermesKey();
  if (!key || ids.length === 0) return null;
  const query = ids.map((id) => `ids[]=${id}`).join("&");
  const response = await fetch(`${hermesUrl()}/v2/updates/price/latest?${query}&parsed=true&encoding=hex`, {
    headers: { authorization: `Bearer ${key}` },
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) return null;
  return (await response.json()) as HermesLatest;
}

async function readHermesPrice(id: string): Promise<PythPrice | null> {
  const latest = await hermesLatest([id]).catch(() => null);
  const entry = latest?.parsed.find((item) => item.id.replace(/^0x/, "") === id);
  if (!entry) return null;
  const publishedMs = entry.price.publish_time * 1000;
  return {
    feed: id,
    priceUsd: Number(entry.price.price) * 10 ** entry.price.expo,
    confidence: Number(entry.price.conf) * 10 ** entry.price.expo,
    publishedAt: new Date(publishedMs).toISOString(),
    ageSeconds: Math.max(0, Math.round((Date.now() - publishedMs) / 1000)),
    source: "hermes",
  };
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

/**
 * Prices are cached for twenty seconds.
 *
 * Every coin in a list shares one quote-token price, and a feed moves on the
 * order of seconds; there is no reason for a list of forty coins to cost forty
 * reads.
 */
const priceCache = ttlCache<PythPrice | null>(20_000);

/**
 * The freshest reading Juno can find for a feed, or null when none is
 * readable.
 *
 * Null is a real answer and the callers treat it as one: a market cap stays
 * denominated in its own quote token, and a NAV band is not drawn.
 */
export async function fetchPythPrice(feedId: string | null): Promise<PythPrice | null> {
  const id = feedIdFor(feedId);
  if (!id) return null;

  const cached = await priceCache.get(id, async () => {
    const readings = await Promise.all(pythContracts().map((contract) => readContractPrice(contract, id)));
    let best: PythPrice | null = null;
    for (const reading of readings) {
      if (reading && (!best || reading.ageSeconds < best.ageSeconds)) best = reading;
    }
    // An on-chain equity mark is usually old on Monad. Hermes, when there is
    // a key, is the fresher source — and it is Pyth's own signed data.
    if ((!best || !isFresh(best)) && hermesKey()) {
      const fromHermes = await readHermesPrice(id);
      if (fromHermes && (!best || fromHermes.ageSeconds < best.ageSeconds)) best = fromHermes;
    }
    return best;
  });

  return aged(cached);
}

/**
 * Recompute how old the mark is, now.
 *
 * `ageSeconds` is cached alongside the price, so a cached reading would report
 * the age it had when it was *fetched*. For a product whose claim is that live
 * market data does real work, a freshness label that freezes is the one number
 * that must not. `publishedAt` is the publisher's own timestamp and does not
 * change, so age is derived from it at read time.
 */
function aged(price: PythPrice | null): PythPrice | null {
  if (!price) return null;
  const published = Date.parse(price.publishedAt);
  if (!Number.isFinite(published)) return price;
  return {
    ...price,
    ageSeconds: Math.max(0, Math.round((Date.now() - published) / 1000)),
  };
}

/** Several feeds at once, keyed by feed id. Absent means unreadable. */
export async function fetchPythPrices(feedIds: Array<string | null>): Promise<Record<string, PythPrice>> {
  const ids = [...new Set(feedIds.map(feedIdFor).filter((id): id is string => Boolean(id)))];
  const out: Record<string, PythPrice> = {};
  const prices = await Promise.all(ids.map((id) => fetchPythPrice(id)));
  prices.forEach((price, index) => {
    if (price) out[ids[index]] = price;
  });
  return out;
}

const STABLES = new Set<string>([
  // Circle USDC, mainnet and testnet.
  "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
  "0x534b2f3A21130d7a60830c2Df862319e593943A3",
]);

/**
 * USD value of one unit of a pool's quote token, or null when unknowable.
 *
 * Stablecoins are 1 by definition — quoting USDC off its own feed would make a
 * pool's market cap wobble by a few basis points for no gain. MON needs the
 * feed, and null is the honest answer when it cannot be read: a pool
 * denominated in MON is better shown in MON than at an invented dollar rate.
 */
export async function quoteTokenUsdPrice(quote: string): Promise<number | null> {
  const address = quote.toLowerCase() === zeroAddress ? zeroAddress : getAddress(quote);
  if (STABLES.has(address)) return 1;
  const configured = process.env.NEXT_PUBLIC_JUNO_USDC?.trim();
  if (configured && configured.toLowerCase() === address.toLowerCase()) return 1;
  if (address !== zeroAddress) return null;
  const mon = await fetchPythPrice(PYTH_FEEDS["Crypto.MON/USD"]);
  return mon?.priceUsd ?? null;
}

/* ------------------------------------------------------------------ */
/* NAV band                                                           */
/* ------------------------------------------------------------------ */

/**
 * How stale a mark may be before it is called stale.
 *
 * Crypto trades continuously, so a couple of minutes is generous. Equities
 * stop overnight and at weekends, so the only useful threshold is one that
 * distinguishes "the exchange is closed" from "nobody has posted this in
 * weeks" — four days clears a long weekend and still catches a dead feed.
 */
const FRESH_CRYPTO_SECONDS = 120;
const FRESH_EQUITY_SECONDS = 4 * 24 * 60 * 60;

export function isFresh(price: PythPrice): boolean {
  const limit = isEquityFeed(price.feed) ? FRESH_EQUITY_SECONDS : FRESH_CRYPTO_SECONDS;
  return price.ageSeconds <= limit;
}

/**
 * Whether this mark is live or a last close.
 *
 * Derived from age rather than from a trading calendar: a calendar in the repo
 * would have to know every exchange holiday to be right, and the publisher
 * already tells us when it last spoke.
 */
export function marketState(price: PythPrice): "live" | "closed" | "stale" {
  if (!isFresh(price)) return "stale";
  if (!isEquityFeed(price.feed)) return "live";
  return price.ageSeconds <= FRESH_CRYPTO_SECONDS ? "live" : "closed";
}

/**
 * Where the curve sits against the underlying.
 *
 * `deviation` is signed: positive means the curve is trading above the
 * reference mark. `withinBand` compares it to the preset's own tolerance.
 */
export function navBand(params: {
  curvePriceUsd: number;
  navPriceUsd: number;
  bandBps: number;
}): { deviation: number; withinBand: boolean } {
  const { curvePriceUsd, navPriceUsd, bandBps } = params;
  if (navPriceUsd <= 0) return { deviation: 0, withinBand: true };
  const deviation = (curvePriceUsd - navPriceUsd) / navPriceUsd;
  return { deviation, withinBand: Math.abs(deviation) * 10_000 <= bandBps };
}

/**
 * The call that posts fresh signed prices to Pyth on Monad, for a keeper.
 * Null without a Hermes key — there is nothing signed to post.
 */
export async function pythUpdateCall(feedIds: string[]): Promise<{ to: Address; data: Hex[]; fee: bigint } | null> {
  const ids = feedIds.map(feedIdFor).filter((id): id is string => Boolean(id));
  const latest = await hermesLatest(ids);
  if (!latest) return null;
  const data = latest.binary.data.map((chunk) => (chunk.startsWith("0x") ? chunk : `0x${chunk}`) as Hex);
  const to = pythWriteContract();
  const fee = await publicClient().readContract({
    address: to,
    abi: PYTH_ABI,
    functionName: "getUpdateFee",
    args: [data],
  });
  return { to, data, fee };
}

export { PYTH_ABI };
