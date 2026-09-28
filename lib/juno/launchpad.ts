/**
 * Juno's launchpad adapter.
 *
 * Everything that touches `JunoLaunchpad` lives here. Components receive plain
 * numbers in UI units (see `lib/juno/types.ts`); this module owns the bigint
 * arithmetic, the decimals, and the contract calls.
 *
 * Quotes come from the contract's own `quoteBuy` / `quoteSell` views, not from
 * a re-implementation of the curve maths. A quote is then the chain's answer to
 * "what would this trade do right now", byte for byte what `buy` will do — and
 * with multicall batching, sampling thirty sizes for a depth chart is one
 * `eth_call`.
 */

import {
  encodeFunctionData,
  getAddress,
  isAddress,
  maxUint256,
  type Address,
  type Hex,
} from "viem";

import { junoLaunchpadAbi, junoTokenAbi } from "./abi";
import { publicClient } from "./client";
import { BASE_DECIMALS, buildPresetParams, presetFromIndex, type BuildPresetOptions, type CurveParams } from "./curves";
import { sqrtX96ToPrice, type RawSegment } from "./curve-math";
import { NATIVE, isMainnet, kuruGraduatorAddress, launchpadAddress, requireLaunchpad } from "./network";
import { ttlCache, withRetry } from "./rpc";
import type { CurvePresetId, CurveState, QuoteToken, TradeSide, Venue } from "./types";

/* ------------------------------------------------------------------ */
/* Quote tokens                                                        */
/* ------------------------------------------------------------------ */

/** Native MON. The launchpad takes it as `msg.value`; no wrapping, no approval. */
export const MON: QuoteToken = {
  address: NATIVE,
  symbol: "MON",
  decimals: 18,
  native: true,
};

/**
 * Circle USDC. Different address per network, and overridable, because a
 * testnet deployment may allow a different stable than the canonical one.
 */
const USDC_ADDRESS: Record<"testnet" | "mainnet", Address> = {
  testnet: "0x534b2f3A21130d7a60830c2Df862319e593943A3",
  mainnet: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
};

function usdcAddress(): Address {
  const override = process.env.NEXT_PUBLIC_JUNO_USDC?.trim();
  if (override && isAddress(override)) return getAddress(override);
  return USDC_ADDRESS[isMainnet() ? "mainnet" : "testnet"];
}

export const USDC: QuoteToken = {
  address: usdcAddress(),
  symbol: "USDC",
  decimals: 6,
  native: false,
};

/**
 * Equity-shaped launches quote in USDC so the curve is denominated in the same
 * unit as the underlying. MON is offered for posts and reels, where a
 * MON-denominated market is the convention and a first-time user needs nothing
 * but gas money to take part.
 */
export const QUOTE_TOKENS: QuoteToken[] = [MON, USDC];

export function quoteTokenFor(address: string): QuoteToken | null {
  if (!isAddress(address)) return null;
  const normalised = getAddress(address);
  return QUOTE_TOKENS.find((token) => token.address === normalised) ?? null;
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

/** `JunoLaunchpad.Pool`, as viem decodes it. */
export type OnchainPool = {
  creator: Address;
  launchedAt: number;
  preset: number;
  complete: boolean;
  graduated: boolean;
  quote: Address;
  startFeeBps: number;
  endFeeBps: number;
  feeDecaySeconds: number;
  protocolShareBps: number;
  feeDecayWad: bigint;
  sqrtPriceX96: bigint;
  sqrtStartPriceX96: bigint;
  venue: Address;
  graduator: Address;
  baseReserve: bigint;
  quoteReserve: bigint;
  migrationBase: bigint;
  migrationQuoteThreshold: bigint;
  leftover: bigint;
  creatorFees: bigint;
  creatorFeesClaimed: bigint;
};

export type PoolSnapshot = {
  /** The token — also the pool's key in the launchpad. */
  token: Address;
  launchpad: Address;
  pool: OnchainPool;
  /** The sixteen ranges, immutable after launch. */
  segments: RawSegment[];
  quote: QuoteToken;
  preset: CurvePresetId;
  /** Price of one token in quote-token units. */
  price: number;
  curve: CurveState;
  /** Where it graduates — chosen at launch, fixed for good. */
  venue: Venue;
  baseDecimals: number;
  quoteDecimals: number;
};

/** Which venue a pool chose at launch, from the graduator it was given. */
export function venueOf(pool: Pick<OnchainPool, "graduator">): Venue {
  const kuru = kuruGraduatorAddress();
  return kuru !== null && getAddress(pool.graduator) === kuru ? "kuru" : "uniswap-v2";
}

/**
 * A curve never changes after launch, so it is read once per process. Every
 * other field of a pool moves with each trade and is never cached for long.
 */
const segmentCache = new Map<string, RawSegment[]>();

async function readSegments(launchpad: Address, token: Address): Promise<RawSegment[]> {
  const key = `${launchpad}:${token}`;
  const hit = segmentCache.get(key);
  if (hit) return hit;
  const [, curve] = await withRetry(
    () =>
      publicClient().readContract({
        address: launchpad,
        abi: junoLaunchpadAbi,
        functionName: "getCurve",
        args: [token],
      }),
    { attempts: 4, baseDelayMs: 300, maxDelayMs: 2_500 },
  );
  const segments = curve.map((segment) => ({
    sqrtPriceX96: segment.sqrtPriceX96,
    liquidity: segment.liquidity,
  }));
  segmentCache.set(key, segments);
  return segments;
}

export async function readPool(token: Address, launchpad = requireLaunchpad()): Promise<OnchainPool | null> {
  const pool = (await withRetry(
    () =>
      publicClient().readContract({
        address: launchpad,
        abi: junoLaunchpadAbi,
        functionName: "getPool",
        args: [token],
      }),
    { attempts: 4, baseDelayMs: 300, maxDelayMs: 2_500 },
  )) as OnchainPool;
  // An unknown token reads back as an all-zero struct, not a revert.
  return pool.creator === NATIVE ? null : pool;
}

/**
 * A pool's quote token never changes, so the decimals needed to scale its
 * trades are read once. Seeded implicitly by `QUOTE_TOKENS`; anything else is
 * asked of the token itself.
 */
const quoteDecimalsCache = new Map<string, QuoteToken>();

export async function quoteTokenOfPool(token: Address, launchpad = requireLaunchpad()): Promise<QuoteToken | null> {
  const key = `${launchpad}:${token}`;
  const hit = quoteDecimalsCache.get(key);
  if (hit) return hit;
  const pool = await readPool(token, launchpad);
  if (!pool) return null;
  let quote = quoteTokenFor(pool.quote);
  if (!quote) {
    const decimals = await withRetry(() =>
      publicClient().readContract({ address: pool.quote, abi: junoTokenAbi, functionName: "decimals" }),
    );
    quote = { address: pool.quote, symbol: "?", decimals, native: false };
  }
  quoteDecimalsCache.set(key, quote);
  return quote;
}

/**
 * Snapshots are cached for a few seconds.
 *
 * A curve does not move between the moment a grid renders and the moment the
 * page beneath it does. Short enough that a trade's effect is visible on the
 * next interaction, long enough that one navigation is one read.
 */
const SNAPSHOT_TTL_MS = 5_000;
const snapshotCache = new Map<string, { at: number; value: PoolSnapshot | null }>();

export async function fetchPoolSnapshot(
  token: string,
  quoteUsdPrice = 1,
  launchpad?: string,
): Promise<PoolSnapshot | null> {
  if (!isAddress(token)) return null;
  const address = getAddress(token);
  const pad = launchpad && isAddress(launchpad) ? getAddress(launchpad) : requireLaunchpad();
  const cacheKey = `${address}:${quoteUsdPrice}`;
  const cached = snapshotCache.get(cacheKey);
  if (cached && Date.now() - cached.at < SNAPSHOT_TTL_MS) return cached.value;

  const value = await readPoolSnapshot(address, pad, quoteUsdPrice);
  snapshotCache.set(cacheKey, { at: Date.now(), value });
  return value;
}

/** Drop a pool's cached snapshot — call after a trade so the next read is live. */
export function invalidatePoolSnapshot(token: string): void {
  const prefix = `${isAddress(token) ? getAddress(token) : token}:`;
  for (const key of snapshotCache.keys()) {
    if (key.startsWith(prefix)) snapshotCache.delete(key);
  }
}

async function readPoolSnapshot(
  token: Address,
  launchpad: Address,
  quoteUsdPrice: number,
): Promise<PoolSnapshot | null> {
  const [pool, segments] = await Promise.all([readPool(token, launchpad), readSegments(launchpad, token)]);
  if (!pool) return null;

  const quote = quoteTokenFor(pool.quote) ?? {
    address: pool.quote,
    symbol: "?",
    decimals: 18,
    native: pool.quote === NATIVE,
  };

  /*
   * A graduated pool is at 100%, not at whatever its drained reserve implies.
   *
   * Graduation moves the quote reserve into the AMM, so reserve-over-threshold
   * reads 0 afterwards — and a pool that completed its curve would be reported
   * as 0% progress, sorting the pools that actually graduated behind pools that
   * have never traded.
   */
  const threshold = pool.migrationQuoteThreshold;
  const progress = pool.graduated || pool.complete
    ? 1
    : threshold > 0n
      ? Math.min(1, Number(pool.quoteReserve) / Number(threshold))
      : 0;

  const thresholdUi = weiToUi(threshold, quote.decimals);

  return {
    token,
    launchpad,
    pool,
    segments,
    quote,
    preset: presetFromIndex(pool.preset),
    price: sqrtX96ToPrice(pool.sqrtPriceX96, BASE_DECIMALS, quote.decimals),
    baseDecimals: BASE_DECIMALS,
    quoteDecimals: quote.decimals,
    curve: {
      progress,
      raisedUsd: thresholdUi * progress * quoteUsdPrice,
      thresholdUsd: thresholdUi * quoteUsdPrice,
      complete: pool.complete,
      graduated: pool.graduated,
    },
    venue: venueOf(pool),
  };
}

/* ------------------------------------------------------------------ */
/* Quotes                                                              */
/* ------------------------------------------------------------------ */

export type TradeQuote = {
  /** What the trader receives, in UI units of the output token. */
  amountOut: number;
  /** Worst case after slippage. */
  minimumAmountOut: number;
  /**
   * What the trader actually spends, in UI units of the input token. Below
   * `amountIn` only when a buy would complete the curve: the rest is refunded
   * in the same transaction.
   */
  amountUsed: number;
  /** Trading fee paid, in quote-token UI units. */
  fee: number;
  /**
   * Total shortfall against spot, as a ratio — e.g. 0.012 for 1.2%.
   *
   * This is what the trade costs you versus an infinitesimal one, and it
   * includes the trading fee. It is the right number to show a trader who is
   * deciding whether to press the button.
   */
  priceImpact: number;
  /**
   * The part of that shortfall the *curve* caused, with the fee taken out.
   *
   * These two behave completely differently with size: the fee is a fixed
   * percentage and does not grow, while the curve's movement does. On a pool
   * with a 1% fee, a "1.5% impact" budget leaves only 0.5% of actual movement —
   * so a size suggester that searched on `priceImpact` would be mostly
   * searching on a constant, and would give the same answer on a deep curve as
   * on a thin one.
   */
  curveImpact: number;
  /** Raw amounts, for building the transaction without re-quoting. */
  raw: { amountIn: bigint; amountOut: bigint; minimumAmountOut: bigint };
};

/** The venue asked for cannot take this launch. The message is for the creator. */
export class VenueUnavailableError extends Error {}

export class InsufficientLiquidityError extends Error {
  constructor() {
    super("Insufficient liquidity");
  }
}

/**
 * Quote a trade against the live curve.
 *
 * A sell larger than the curve can take back reverts in the contract with
 * `InsufficientLiquidity`; that is surfaced as an `InsufficientLiquidityError`
 * so callers can tell "the market cannot fill this" apart from "the RPC
 * refused".
 */
export async function quoteTrade(params: {
  snapshot: PoolSnapshot;
  side: TradeSide;
  /** Input amount in UI units — quote units for a buy, token units for a sell. */
  amountIn: number;
  slippageBps?: number;
}): Promise<TradeQuote> {
  const { snapshot, side, amountIn, slippageBps = 100 } = params;
  const { baseDecimals, quoteDecimals } = snapshot;
  const client = publicClient();

  let amountOutRaw: bigint;
  let usedRaw: bigint;
  let feeRaw: bigint;
  const inRaw = uiToWei(amountIn, side === "buy" ? quoteDecimals : baseDecimals);

  try {
    if (side === "buy") {
      const [baseOut, quotePaid, fee] = await client.readContract({
        address: snapshot.launchpad,
        abi: junoLaunchpadAbi,
        functionName: "quoteBuy",
        args: [snapshot.token, inRaw],
      });
      amountOutRaw = baseOut;
      usedRaw = quotePaid;
      feeRaw = fee;
    } else {
      const [quoteOut, fee] = await client.readContract({
        address: snapshot.launchpad,
        abi: junoLaunchpadAbi,
        functionName: "quoteSell",
        args: [snapshot.token, inRaw],
      });
      amountOutRaw = quoteOut;
      usedRaw = inRaw;
      feeRaw = fee;
    }
  } catch (error) {
    if (/InsufficientLiquidity/.test(String((error as Error)?.message ?? error))) {
      throw new InsufficientLiquidityError();
    }
    throw error;
  }

  const outDecimals = side === "buy" ? baseDecimals : quoteDecimals;
  const minimumRaw = (amountOutRaw * BigInt(10_000 - slippageBps)) / 10_000n;
  const amountOut = weiToUi(amountOutRaw, outDecimals);
  const used = weiToUi(usedRaw, side === "buy" ? quoteDecimals : baseDecimals);
  const fee = weiToUi(feeRaw, quoteDecimals);

  const spotOut = side === "sell" ? used * snapshot.price : used / snapshot.price;
  /*
   * What the curve alone did, with the fee removed. On a buy the fee comes off
   * the input, so the curve only ever saw `used - fee`; on a sell the fee comes
   * out of the quote the curve produced, so it is added back to the output.
   */
  const curveSpotOut = side === "sell" ? spotOut : Math.max(used - fee, 0) / snapshot.price;
  const curveOut = side === "sell" ? amountOut + fee : amountOut;

  return {
    amountOut,
    minimumAmountOut: weiToUi(minimumRaw, outDecimals),
    amountUsed: used,
    fee,
    priceImpact: spotOut > 0 ? Math.max(0, (spotOut - amountOut) / spotOut) : 0,
    curveImpact: curveSpotOut > 0 ? Math.max(0, (curveSpotOut - curveOut) / curveSpotOut) : 0,
    raw: { amountIn: inRaw, amountOut: amountOutRaw, minimumAmountOut: minimumRaw },
  };
}

/** An exact-out buy's quote: the tokens are fixed, the cost is what the curve names. */
export type ExactOutQuote = TradeQuote & {
  /** What the buy is expected to cost, fee included, in quote UI units. */
  amountIn: number;
  /** The most the transaction may spend: the cost plus the slippage allowance. */
  maximumAmountIn: number;
};

/**
 * Quote buying exactly `amountOut` tokens, against the live curve.
 *
 * The launchpad's own `quoteBuyExactOut` walks the ranges by base out, so the
 * figure is the one `buyExactOut` will charge in the same state. The
 * transaction is then capped at the cost plus the slippage allowance; if the
 * curve has moved further by the time it lands, it reverts instead of paying
 * more. Past the curve's remaining supply it is `InsufficientLiquidityError`:
 * an exact-out buy never fills part-way.
 */
export async function quoteExactOutBuy(params: {
  snapshot: PoolSnapshot;
  /** Tokens to receive, in UI units. */
  amountOut: number;
  slippageBps?: number;
}): Promise<ExactOutQuote> {
  const { snapshot, amountOut, slippageBps = 100 } = params;
  const outRaw = uiToWei(amountOut, snapshot.baseDecimals);
  let costRaw: bigint;
  let feeRaw: bigint;
  try {
    [costRaw, feeRaw] = await publicClient().readContract({
      address: snapshot.launchpad,
      abi: junoLaunchpadAbi,
      functionName: "quoteBuyExactOut",
      args: [snapshot.token, outRaw],
    });
  } catch (error) {
    if (/InsufficientLiquidity/.test(String((error as Error)?.message ?? error))) {
      throw new InsufficientLiquidityError();
    }
    throw error;
  }
  const maxRaw = (costRaw * BigInt(10_000 + slippageBps)) / 10_000n;
  const cost = weiToUi(costRaw, snapshot.quoteDecimals);
  const fee = weiToUi(feeRaw, snapshot.quoteDecimals);
  const got = weiToUi(outRaw, snapshot.baseDecimals);
  // Against spot: what `cost` would have bought at the current price.
  const spotOut = snapshot.price > 0 ? cost / snapshot.price : 0;
  const curveSpotOut = snapshot.price > 0 ? Math.max(cost - fee, 0) / snapshot.price : 0;
  return {
    amountOut: got,
    // Exact: the contract delivers precisely this or reverts.
    minimumAmountOut: got,
    amountUsed: cost,
    fee,
    priceImpact: spotOut > 0 ? Math.max(0, (spotOut - got) / spotOut) : 0,
    curveImpact: curveSpotOut > 0 ? Math.max(0, (curveSpotOut - got) / curveSpotOut) : 0,
    amountIn: cost,
    maximumAmountIn: weiToUi(maxRaw, snapshot.quoteDecimals),
    raw: { amountIn: maxRaw, amountOut: outRaw, minimumAmountOut: outRaw },
  };
}

/* ------------------------------------------------------------------ */
/* Writes — calldata only; signing happens on the device                */
/* ------------------------------------------------------------------ */

/** One contract call, ready to become a transaction. */
export type ContractCall = {
  to: Address;
  data: Hex;
  value: bigint;
  /** Shown while this step is in flight. */
  label: string;
  /**
   * Gas to add on top of the estimate and its margin, for work the estimate
   * cannot see at the moment it is taken. See `V2_SWAP_HEADROOM`.
   */
  extraGas?: bigint;
};

export type LaunchRequest = {
  creator: Address;
  quote: QuoteToken;
  name: string;
  symbol: string;
  /** Token metadata URI. Empty is accepted. */
  uri: string;
  preset: CurvePresetId;
  /** Valuations in quote-token units. */
  initialMarketCap: number;
  migrationMarketCap: number;
  /** Optional first buy in quote units, made atomically with the launch. */
  firstBuy?: number;
  /** Where the curve graduates. Defaults to the launchpad's own default (Uniswap v2). */
  venue?: Venue;
};

export type LaunchPlan = {
  call: ContractCall;
  /** Where the token will be deployed — predicted by the launchpad itself. */
  token: Address;
  params: CurveParams;
};

/**
 * Plan a launch: build the curve from a preset, ask the launchpad where the
 * token will land, and encode the one call that creates both.
 *
 * On Solana this was two transactions — a sixteen-segment curve would not fit
 * in one packet alongside the pool init. On Monad it is one call: the token,
 * its curve, its AMM pair and the optional first buy are created atomically,
 * so there is no state in which a config exists without its pool.
 */
export async function planLaunch(params: LaunchRequest): Promise<LaunchPlan> {
  const launchpad = requireLaunchpad();
  let graduator: Address = NATIVE;
  if (params.venue === "kuru") {
    const kuru = kuruGraduatorAddress();
    if (!kuru) throw new VenueUnavailableError("Kuru is not offered on this network");
    // Kuru markets here are priced in MON; the graduator refuses anything else.
    if (!params.quote.native) throw new VenueUnavailableError("A Kuru market is priced in MON. Launch in MON to choose Kuru.");
    graduator = kuru;
  }
  const curve = buildPresetParams({
    preset: params.preset,
    initialMarketCap: params.initialMarketCap,
    migrationMarketCap: params.migrationMarketCap,
    quoteDecimals: params.quote.decimals,
  } satisfies BuildPresetOptions);

  const token = await withRetry(() =>
    publicClient().readContract({
      address: launchpad,
      abi: junoLaunchpadAbi,
      functionName: "predictToken",
      args: [params.creator, params.name, params.symbol, params.uri],
    }),
  );

  const firstBuy = params.firstBuy && params.firstBuy > 0 ? uiToWei(params.firstBuy, params.quote.decimals) : 0n;
  const data = encodeFunctionData({
    abi: junoLaunchpadAbi,
    functionName: "launch",
    args: [
      {
        name: params.name,
        symbol: params.symbol,
        uri: params.uri,
        quote: params.quote.address,
        preset: curve.preset,
        sqrtStartPriceX96: curve.sqrtStartPriceX96,
        curve: curve.curve.map((segment) => ({
          sqrtPriceX96: segment.sqrtPriceX96,
          liquidity: segment.liquidity,
        })) as never,
        startFeeBps: curve.startFeeBps,
        endFeeBps: curve.endFeeBps,
        feeDecaySeconds: curve.feeDecaySeconds,
        feeDecayWad: curve.feeDecayWad,
        graduator,
      },
      firstBuy,
      0n,
    ],
  });

  return {
    call: {
      to: launchpad,
      data,
      value: params.quote.native ? firstBuy : 0n,
      // Posts, reels and trackers all launch here; say what the step does.
      label: "Opening its market",
    },
    token,
    params: curve,
  };
}

/** How long a signed trade stays valid. Past this the contract refuses it. */
export const TRADE_DEADLINE_SECONDS = 5 * 60;

export function tradeDeadline(nowSeconds = Math.floor(Date.now() / 1000)): bigint {
  return BigInt(nowSeconds + TRADE_DEADLINE_SECONDS);
}

export function buildSwapCall(params: {
  snapshot: PoolSnapshot;
  owner: Address;
  side: TradeSide;
  quote: TradeQuote;
  deadline: bigint;
}): ContractCall {
  const { snapshot, owner, side, quote, deadline } = params;
  if (side === "buy") {
    return {
      to: snapshot.launchpad,
      data: encodeFunctionData({
        abi: junoLaunchpadAbi,
        functionName: "buy",
        args: [snapshot.token, quote.raw.amountIn, quote.raw.minimumAmountOut, owner, deadline],
      }),
      value: snapshot.quote.native ? quote.raw.amountIn : 0n,
      label: "Buying",
    };
  }
  return {
    to: snapshot.launchpad,
    data: encodeFunctionData({
      abi: junoLaunchpadAbi,
      functionName: "sell",
      args: [snapshot.token, quote.raw.amountIn, quote.raw.minimumAmountOut, owner, deadline],
    }),
    value: 0n,
    label: "Selling",
  };
}

/**
 * `buyExactOut`: exactly the quoted tokens, capped at `maximumAmountIn`. With
 * native MON the cap is sent and the unused part comes back in the same call.
 */
export function buildExactOutBuyCall(params: {
  snapshot: PoolSnapshot;
  owner: Address;
  quote: ExactOutQuote;
  deadline: bigint;
}): ContractCall {
  const { snapshot, owner, quote, deadline } = params;
  return {
    to: snapshot.launchpad,
    data: encodeFunctionData({
      abi: junoLaunchpadAbi,
      functionName: "buyExactOut",
      args: [snapshot.token, quote.raw.amountOut, quote.raw.amountIn, owner, deadline],
    }),
    value: snapshot.quote.native ? quote.raw.amountIn : 0n,
    label: "Buying",
  };
}

/** How much of `quote` the launchpad may pull from `owner` right now. */
export async function quoteAllowance(owner: Address, quote: QuoteToken, launchpad = requireLaunchpad()): Promise<bigint> {
  if (quote.native) return maxUint256;
  return withRetry(() =>
    publicClient().readContract({
      address: quote.address,
      abi: junoTokenAbi,
      functionName: "allowance",
      args: [owner, launchpad],
    }),
  );
}

/**
 * Approve the launchpad to pull a stable quote token.
 *
 * Only ever needed for an ERC-20 quote, and only once: the approval is for the
 * maximum so the second buy is one signature. Selling never needs it — Juno
 * tokens let their own launchpad pull from the seller directly.
 */
export function buildApproveCall(quote: QuoteToken, launchpad = requireLaunchpad()): ContractCall {
  return {
    to: quote.address,
    data: encodeFunctionData({
      abi: junoTokenAbi,
      functionName: "approve",
      args: [launchpad, maxUint256],
    }),
    value: 0n,
    label: `Allowing Juno to spend ${quote.symbol}`,
  };
}

/* ------------------------------------------------------------------ */
/* Units                                                               */
/* ------------------------------------------------------------------ */

export function uiToWei(amount: number, decimals: number): bigint {
  if (!Number.isFinite(amount) || amount <= 0) return 0n;
  // Via a fixed-point string to avoid float error on large amounts.
  const [whole, frac = ""] = amount.toFixed(Math.min(decimals, 20)).split(".");
  return BigInt(`${whole}${frac.padEnd(decimals, "0").slice(0, decimals)}`);
}

export function weiToUi(amount: bigint, decimals: number): number {
  return Number(amount) / 10 ** decimals;
}

/* ------------------------------------------------------------------ */
/* Creator economics                                                   */
/* ------------------------------------------------------------------ */

export type FeeBalance = {
  /** Claimable now, in quote-token UI units. */
  quoteAmount: number;
  /** Already paid out to the creator, for a lifetime figure. */
  claimedQuote: number;
};

/**
 * What a creator can actually withdraw right now — the only figure worth
 * putting next to a claim button. A lifetime total would invite someone to
 * click expecting money that is already in their wallet, so it is reported
 * separately.
 */
export async function fetchCreatorFees(token: string): Promise<FeeBalance | null> {
  const snapshot = await fetchPoolSnapshot(token);
  if (!snapshot) return null;
  return {
    quoteAmount: weiToUi(snapshot.pool.creatorFees, snapshot.quoteDecimals),
    claimedQuote: weiToUi(snapshot.pool.creatorFeesClaimed, snapshot.quoteDecimals),
  };
}

export function buildClaimCreatorFeesCall(params: { token: Address; to: Address; launchpad?: Address }): ContractCall {
  return {
    to: params.launchpad ?? requireLaunchpad(),
    data: encodeFunctionData({
      abi: junoLaunchpadAbi,
      functionName: "claimCreatorFees",
      args: [params.token, params.to],
    }),
    value: 0n,
    label: "Claiming your fees",
  };
}

/* ------------------------------------------------------------------ */
/* Graduation                                                          */
/* ------------------------------------------------------------------ */

/**
 * Move a completed curve's reserves into its AMM pair.
 *
 * Only valid once the curve has actually filled — the contract rejects an
 * early graduation, which is why the UI gates the button on `curve.complete`.
 * Anyone may send it; the outcome does not depend on who does.
 */
export function buildGraduateCall(params: { token: Address; launchpad?: Address; venue?: Venue }): ContractCall {
  return {
    to: params.launchpad ?? requireLaunchpad(),
    data: encodeFunctionData({
      abi: junoLaunchpadAbi,
      functionName: "graduate",
      args: [params.token],
    }),
    value: 0n,
    label: params.venue === "kuru" ? "Opening its Kuru market" : "Graduating to the AMM",
  };
}

/** Whether a launchpad is configured at all. Routes answer 503 when it is not. */
export function launchpadConfigured(): boolean {
  return launchpadAddress() !== null;
}
