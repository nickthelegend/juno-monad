import "server-only";

import {
  BaseError,
  decodeErrorResult,
  decodeFunctionData,
  encodeAbiParameters,
  erc20Abi,
  getAddress,
  keccak256,
  maxUint256,
  isAddress,
  parseAbi,
  parseEventLogs,
  parseTransaction,
  recoverTransactionAddress,
  toHex,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";

import { junoLaunchpadAbi, junoTokenAbi, kuruGraduatorAbi, kuruOrderBookAbi } from "./abi";
import { CallerError } from "./api";
import { publicClient } from "./client";
import { CURVE_PRESETS, type CurvePreset } from "./curves";
import {
  InsufficientLiquidityError,
  VenueUnavailableError,
  buildApproveCall,
  buildClaimCreatorFeesCall,
  buildExactOutBuyCall,
  buildGraduateCall,
  buildSwapCall,
  fetchPoolSnapshot,
  invalidatePoolSnapshot,
  planLaunch,
  quoteAllowance,
  quoteExactOutBuy,
  quoteTokenFor,
  quoteTrade,
  readPool,
  tradeDeadline,
  venueOf,
  uiToWei,
  weiToUi,
  type ContractCall,
  type PoolSnapshot,
  type TradeQuote,
} from "./launchpad";
import {
  KuruOrderRejected,
  KuruOrderTooSmall,
  buildKuruCancel,
  buildKuruLimitOrder,
  buildKuruOrder,
  buildKuruWithdraw,
  kuruMarketOf,
  kuruTokenOf,
  quoteKuruTrade,
} from "./kuru";
import { rememberKuruOrders } from "./kuru-orders";
import { chainId, launchpadAddress, requireLaunchpad, swapRouterAddress } from "./network";
import {
  PerpRejected,
  ausdFaucetCall,
  perpAccount,
  perpCloseCall,
  perpDepositCalls,
  perpExchange,
  perpMarkets,
  perpOpenCall,
  perpWithdrawCall,
} from "./perpl";
import { perplExchangeAbi } from "./perpl-abi";
import { quoteTokenUsdPrice } from "./pyth";
import { withRetry } from "./rpc";
import { invalidateSwapHistory, recordReceiptTrades } from "./swaps";
import type { CurvePresetId, TradeSide, Venue } from "./types";
import { buildV2SwapCalls, quoteV2Trade } from "./v2";

/**
 * Transactions built on the server, signed on the device.
 *
 * The mobile client carries no contract ABIs and no RPC logic. It asks for an
 * unsigned transaction, signs it with the key in its secure store, and hands
 * the signed bytes back to be broadcast. The private key never leaves the phone
 * and the result is an ordinary Monad transaction anyone can check on an
 * explorer — this is a thin-client split, not a custodial one.
 *
 * ## Steps
 *
 * Most actions are one call. A buy quoted in USDC is two the first time — an
 * approval, then the buy — and both are built together with consecutive
 * nonces, so the phone signs twice and the server submits them in order. The
 * buy's gas cannot be estimated until the approval exists, so it carries a
 * fixed ceiling instead; see `FALLBACK_GAS`.
 *
 * ## Gas on Monad
 *
 * Monad charges for the gas *limit*, not the gas used. A generous limit is
 * money thrown away, so every step is estimated against the chain and given a
 * modest margin rather than a round number.
 */

/**
 * Headroom over an estimate — enough for state to move a little before
 * inclusion. Monad's own guidance is about 7.5%, not the 30–50% wallets
 * habitually add, because the whole limit is charged.
 */
const GAS_MARGIN_BPS = 750n;

/**
 * Ceiling for a step that cannot be estimated because it depends on an earlier
 * step in the same batch. A buy walks at most sixteen ranges.
 */
const FALLBACK_GAS = 350_000n;

/**
 * Where a launch starts and where it graduates, **in US dollars**.
 *
 * The opening size is a launch parameter rather than a property of the curve
 * preset — the same shape can be opened at any size. The range above it is
 * the preset's (`defaultCapMultiple`): 25x for a post, 1.5x for a tracker that
 * must stay near-flat. The curve takes caps in quote-token units, so they are
 * converted at the quote token's live price when the launch is built.
 */
const DEFAULT_INITIAL_MARKET_CAP_USD = 1_000;

/** The default market caps restated in this quote token's units. */
async function defaultCapsIn(
  quote: string,
  preset: CurvePreset,
): Promise<{ initial: number; migration: number }> {
  const usd = await quoteTokenUsdPrice(quote).catch(() => null);
  if (usd === null || !(usd > 0)) {
    throw new CallerError(
      "The quote token's price could not be read, so the launch size cannot be set. Try again in a moment.",
    );
  }
  return {
    initial: DEFAULT_INITIAL_MARKET_CAP_USD / usd,
    // Each preset owns its range: 25x for a launch, 1.5x for a tracker.
    migration: (DEFAULT_INITIAL_MARKET_CAP_USD * preset.defaultCapMultiple) / usd,
  };
}

/**
 * An EIP-1559 transaction, every number hex-encoded so it survives JSON.
 * The phone passes these fields straight to viem's `signTransaction`.
 */
export type UnsignedTransaction = {
  label: string;
  request: {
    type: "eip1559";
    chainId: number;
    from: Address;
    to: Address;
    data: Hex;
    value: Hex;
    nonce: number;
    gas: Hex;
    maxFeePerGas: Hex;
    maxPriorityFeePerGas: Hex;
  };
};

/** When a built trade stops being valid. Past it, the contract refuses it. */
export type TxWindow = {
  /** Unix seconds. */
  deadline: number;
};

/**
 * Turn calls into transactions: one nonce each, gas estimated where it can be,
 * one fee quote for the batch.
 *
 * A failed estimate on the *first* step is the chain saying this would revert,
 * so it is explained and thrown. On a later step it is expected — that step
 * depends on the ones before it — and it gets the fixed ceiling.
 */
async function prepare(from: Address, calls: ContractCall[]): Promise<UnsignedTransaction[]> {
  const client = publicClient();
  const [nonce, fees] = await Promise.all([
    withRetry(() => client.getTransactionCount({ address: from, blockTag: "pending" })),
    withRetry(() => client.estimateFeesPerGas()),
  ]);

  const steps: UnsignedTransaction[] = [];
  // Allowances granted by earlier steps in this batch, as state the estimate
  // of a later step can assume (see `allowanceOverride`).
  const granted: StateOverride = [];
  for (const [index, call] of calls.entries()) {
    let gas: bigint;
    try {
      const estimate = await withRetry(() =>
        client.estimateGas({
          account: from,
          to: call.to,
          data: call.data,
          value: call.value,
          ...(granted.length > 0 ? { stateOverride: granted } : {}),
        }),
      );
      gas = estimate + (estimate * GAS_MARGIN_BPS) / 10_000n + (call.extraGas ?? 0n);
    } catch (error) {
      if (index === 0) throw new CallerError(explainFailure(error), 422);
      gas = FALLBACK_GAS + (call.extraGas ?? 0n);
    }
    const override = await allowanceOverride(from, call).catch(() => null);
    if (override) granted.push(override);
    steps.push({
      label: call.label,
      request: {
        type: "eip1559",
        chainId: chainId(),
        from,
        to: call.to,
        data: call.data,
        value: toHex(call.value),
        nonce: nonce + index,
        gas: toHex(gas),
        maxFeePerGas: toHex(fees.maxFeePerGas),
        maxPriorityFeePerGas: toHex(fees.maxPriorityFeePerGas),
      },
    });
  }
  return steps;
}

type StateOverride = NonNullable<Parameters<ReturnType<typeof publicClient>["estimateGas"]>[0]["stateOverride"]>;

/**
 * If `call` is an ERC-20 approval, the state it will leave: the allowance
 * set, for estimating the steps after it.
 *
 * A step that depends on an approval in the same batch cannot be estimated
 * against the chain as it is — the approval has not landed — so it used to get
 * a fixed ceiling. That was fine for a curve buy and not for a Kuru market
 * sell, which walks the market's vault in many small fills: on the fork a
 * first-ever sell needed 679k gas and ran out at the 350k ceiling. Monad's RPC
 * honours state overrides in `eth_estimateGas`, so the later step is
 * estimated as if the approval had already landed.
 */
async function allowanceOverride(owner: Address, call: ContractCall): Promise<StateOverride[number] | null> {
  let spender: Address;
  let amount: bigint;
  try {
    const decoded = decodeFunctionData({ abi: erc20Abi, data: call.data });
    if (decoded.functionName !== "approve") return null;
    [spender, amount] = decoded.args as [Address, bigint];
  } catch {
    return null;
  }
  const index = await allowanceMappingSlot(call.to);
  if (index === null) return null;
  return {
    address: call.to,
    stateDiff: [{ slot: allowanceSlot(owner, spender, index), value: toHex(amount, { size: 32 }) }],
  };
}

/** `allowance[owner][spender]` in a mapping declared at storage slot `index`. */
function allowanceSlot(owner: Address, spender: Address, index: number): Hex {
  const inner = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [owner, BigInt(index)]));
  return keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [spender, inner]));
}

const mappingSlots = new Map<Address, number | null>();

/**
 * Where a token keeps its allowances — found, not assumed. OpenZeppelin's
 * ERC-20 (every Juno token) and Circle's USDC lay storage out differently, so
 * each candidate slot is tried with an `eth_call` of `allowance` under an
 * override of that slot, and the one that changes the answer is it.
 */
async function allowanceMappingSlot(token: Address): Promise<number | null> {
  if (mappingSlots.has(token)) return mappingSlots.get(token)!;
  // Lowercase: viem refuses a mixed-case address whose checksum is wrong.
  const probeOwner: Address = "0x000000000000000000000000000000000000beef";
  const probeSpender: Address = "0x000000000000000000000000000000000000cafe";
  const client = publicClient();
  for (let index = 0; index < 16; index++) {
    const value = await client
      .readContract({
        address: token,
        abi: erc20Abi,
        functionName: "allowance",
        args: [probeOwner, probeSpender],
        stateOverride: [
          {
            address: token,
            stateDiff: [{ slot: allowanceSlot(probeOwner, probeSpender, index), value: toHex(maxUint256, { size: 32 }) }],
          },
        ],
      })
      .catch(() => 0n);
    if (value === maxUint256) {
      mappingSlots.set(token, index);
      return index;
    }
  }
  mappingSlots.set(token, null);
  return null;
}

function requireWallet(value: string, field: string): Address {
  if (!isAddress(value)) throw new CallerError(`${field} is not a Monad address`);
  return getAddress(value);
}

/* ------------------------------------------------------------------ */
/* Swap                                                                */
/* ------------------------------------------------------------------ */

export type SwapBuildRequest = {
  /** The coin being traded. */
  token: string;
  side: TradeSide;
  /** Input amount in UI units — quote units on a buy, token units on a sell. */
  amountIn: number;
  /**
   * On a buy against the curve, exactly how many tokens to receive instead:
   * the curve names the price and the transaction caps what it may spend.
   * `amountIn` is ignored when this is set.
   */
  amountOut?: number;
  /**
   * On a sell, a share of what the wallet holds (0 < f ≤ 1) instead of an
   * amount: read from the chain here, so 100% is the whole balance to the wei.
   * The app's 25/50/75/100% chips send this; a number the phone rounded left
   * dust behind — "sell everything" kept 0.435 of a token. `amountIn` is
   * ignored when this is set.
   */
  sellFraction?: number;
  /** The wallet that will sign and pay. */
  owner: string;
  slippageBps?: number;
  /** Set by `buildSwap` from `sellFraction`: the exact input in wei. */
  amountInRaw?: bigint;
};

export type SwapBuildResult = {
  /** In order. Usually one; an approval first when a USDC buy needs one. */
  steps: UnsignedTransaction[];
  window: TxWindow;
  /** On an exact-out buy, also `amountIn` (the cost) and `maximumAmountIn` (the cap). */
  quote: Omit<TradeQuote, "raw"> & { amountIn?: number; maximumAmountIn?: number };
  /** What the quote is denominated in, for honest labelling on the client. */
  quoteSymbol: string;
  /** Null when no USD feed is available for the quote token. */
  quoteUsdRate: number | null;
  /**
   * Where the order goes: the curve, or after graduation the coin's Kuru
   * market or its Uniswap v2 pair.
   */
  venue: "curve" | "kuru" | "uniswap-v2";
  /** The Kuru market, when `venue` is "kuru". */
  market?: Address;
  /** The v2 pair, when `venue` is "uniswap-v2". */
  pair?: Address;
};

export async function buildSwap(input: SwapBuildRequest): Promise<SwapBuildResult> {
  const request = input.sellFraction === undefined ? input : await resolveSellFraction(input);
  const exactOut = request.amountOut !== undefined;
  const size = exactOut ? request.amountOut! : request.amountIn;
  if (!Number.isFinite(size) || size <= 0) {
    throw new CallerError("Amount must be greater than zero");
  }
  if (exactOut && request.side !== "buy") {
    throw new CallerError('"amountOut" is for buys; a sell already names its token amount');
  }

  const owner = requireWallet(request.owner, "owner");
  const snapshot = await fetchPoolSnapshot(request.token);
  if (!snapshot) throw new CallerError("This coin has no pool on this network");

  if (exactOut && (snapshot.curve.graduated || snapshot.curve.complete)) {
    throw new CallerError("Buying an exact number of tokens is for coins still on their curve");
  }
  // A coin that graduated into Kuru keeps trading here, on its Kuru market.
  if (snapshot.curve.graduated && snapshot.venue === "kuru") {
    return buildKuruSwap(request, owner, snapshot.token, snapshot.quote.symbol, snapshot.quote.address);
  }
  // One that graduated into Uniswap v2 trades against its pair, through the router.
  if (snapshot.curve.graduated) {
    if (!swapRouterAddress()) {
      throw new CallerError("This coin has graduated — it trades on its AMM pair now");
    }
    return buildV2Swap(request, owner, snapshot);
  }
  // The contract rejects a trade against a finished curve. Saying so here is a
  // far better error than the one the chain would return after signing.
  if (snapshot.curve.complete) {
    throw new CallerError("This curve is full. It graduates to its AMM pair next.");
  }
  if (exactOut) return buildExactOutSwap(request, owner, snapshot);

  const quote = await quoteTrade({
    snapshot,
    side: request.side,
    amountIn: request.amountIn,
    amountInRaw: request.amountInRaw,
    slippageBps: request.slippageBps ?? 100,
  }).catch((error: unknown) => {
    if (error instanceof InsufficientLiquidityError) {
      throw new CallerError(
        request.side === "sell"
          ? "There is not enough in this pool to buy that back. Try a smaller amount."
          : "This curve cannot fill that size. Try a smaller amount.",
      );
    }
    throw error;
  });
  if (quote.raw.amountOut === 0n) throw new CallerError("That amount is too small to trade");

  const deadline = tradeDeadline();
  const calls: ContractCall[] = [];
  if (request.side === "buy" && !snapshot.quote.native) {
    const allowance = await quoteAllowance(owner, snapshot.quote, snapshot.launchpad);
    if (allowance < quote.raw.amountIn) calls.push(buildApproveCall(snapshot.quote, snapshot.launchpad));
  }
  calls.push(buildSwapCall({ snapshot, owner, side: request.side, quote, deadline }));

  const steps = await prepare(owner, calls);
  const quoteUsdRate = await quoteTokenUsdPrice(snapshot.quote.address).catch(() => null);
  const { raw: _raw, ...publicQuote } = quote;

  return {
    steps,
    window: { deadline: Number(deadline) },
    quote: publicQuote,
    quoteSymbol: snapshot.quote.symbol,
    quoteUsdRate,
    venue: "curve",
  };
}

/** Exactly `amountOut` tokens from the curve, the spend capped by slippage. */
async function buildExactOutSwap(
  request: SwapBuildRequest,
  owner: Address,
  snapshot: PoolSnapshot,
): Promise<SwapBuildResult> {
  const quote = await quoteExactOutBuy({
    snapshot,
    amountOut: request.amountOut!,
    slippageBps: request.slippageBps ?? 100,
  }).catch((error: unknown) => {
    if (error instanceof InsufficientLiquidityError) {
      throw new CallerError("The curve does not hold that many tokens. Ask for fewer.");
    }
    throw error;
  });
  if (quote.raw.amountIn === 0n) throw new CallerError("That amount is too small to trade");

  const deadline = tradeDeadline();
  const calls: ContractCall[] = [];
  if (!snapshot.quote.native) {
    const allowance = await quoteAllowance(owner, snapshot.quote, snapshot.launchpad);
    if (allowance < quote.raw.amountIn) calls.push(buildApproveCall(snapshot.quote, snapshot.launchpad));
  }
  calls.push(buildExactOutBuyCall({ snapshot, owner, quote, deadline }));

  const steps = await prepare(owner, calls);
  const quoteUsdRate = await quoteTokenUsdPrice(snapshot.quote.address).catch(() => null);
  const { raw: _raw, ...publicQuote } = quote;
  return {
    steps,
    window: { deadline: Number(deadline) },
    quote: publicQuote,
    quoteSymbol: snapshot.quote.symbol,
    quoteUsdRate,
    venue: "curve",
  };
}

/** A share of the holding, as the exact number of wei it names. */
async function resolveSellFraction(request: SwapBuildRequest): Promise<SwapBuildRequest> {
  const fraction = request.sellFraction!;
  if (request.side !== "sell") throw new CallerError('"sellFraction" is for sells');
  if (!(fraction > 0 && fraction <= 1)) throw new CallerError('"sellFraction" must be above 0 and at most 1');
  const owner = requireWallet(request.owner, "owner");
  const token = requireWallet(request.token, "token");
  const held = await withRetry(() =>
    publicClient().readContract({ address: token, abi: junoTokenAbi, functionName: "balanceOf", args: [owner] }),
  );
  // Parts per million, so 0.25 is exact and 1 is the whole balance.
  const raw = fraction === 1 ? held : (held * BigInt(Math.round(fraction * 1_000_000))) / 1_000_000n;
  if (raw === 0n) throw new CallerError("You hold none of this coin");
  return { ...request, amountIn: weiToUi(raw, 18), amountInRaw: raw };
}

/** A graduated coin, against its Uniswap v2 pair. */
async function buildV2Swap(
  request: SwapBuildRequest,
  owner: Address,
  snapshot: PoolSnapshot,
): Promise<SwapBuildResult> {
  const quote = await quoteV2Trade({
    snapshot,
    side: request.side,
    amountIn: request.amountIn,
    amountInRaw: request.amountInRaw,
    slippageBps: request.slippageBps ?? 100,
  }).catch((error: unknown) => {
    if (error instanceof InsufficientLiquidityError) {
      throw new CallerError("This coin's pair cannot fill that size. Try a smaller amount.");
    }
    throw error;
  });
  if (quote.raw.amountOut === 0n) throw new CallerError("That amount is too small to trade");

  const deadline = tradeDeadline();
  const steps = await prepare(
    owner,
    await buildV2SwapCalls({ snapshot, owner, side: request.side, quote, deadline }),
  );
  const quoteUsdRate = await quoteTokenUsdPrice(snapshot.quote.address).catch(() => null);
  const { raw: _raw, ...publicQuote } = quote;
  return {
    steps,
    window: { deadline: Number(deadline) },
    quote: publicQuote,
    quoteSymbol: snapshot.quote.symbol,
    quoteUsdRate,
    venue: "uniswap-v2",
    pair: snapshot.pool.venue,
  };
}

/** How long a Kuru order is worth signing. Kuru's market orders carry no deadline of their own. */
const KURU_QUOTE_WINDOW_SECONDS = 60;

async function buildKuruSwap(
  request: SwapBuildRequest,
  owner: Address,
  token: Address,
  quoteSymbol: string,
  quoteAddress: string,
): Promise<SwapBuildResult> {
  const market = await kuruMarketOf(token);
  if (!market) throw new CallerError("This coin's Kuru market could not be found");

  const quote = await quoteKuruTrade({
    market,
    side: request.side,
    amountIn: request.amountIn,
    amountInRaw: request.amountInRaw,
    slippageBps: request.slippageBps ?? 100,
  }).catch((error: unknown) => {
    if (error instanceof KuruOrderTooSmall) throw new CallerError("That amount is too small to trade");
    if (error instanceof InsufficientLiquidityError) {
      throw new CallerError("Kuru's book cannot fill that size right now. Try a smaller amount.");
    }
    throw error;
  });

  const steps = await prepare(owner, await buildKuruOrder({ market, token, owner, side: request.side, quote }));
  const quoteUsdRate = await quoteTokenUsdPrice(quoteAddress).catch(() => null);
  const { raw: _raw, book: _book, ...publicQuote } = quote;
  return {
    steps,
    window: { deadline: Math.floor(Date.now() / 1000) + KURU_QUOTE_WINDOW_SECONDS },
    quote: publicQuote,
    quoteSymbol,
    quoteUsdRate,
    venue: "kuru",
    market,
  };
}

/* ------------------------------------------------------------------ */
/* Launch                                                              */
/* ------------------------------------------------------------------ */

export type LaunchBuildRequest = {
  creator: string;
  name: string;
  symbol: string;
  uri: string;
  preset: CurvePresetId;
  /** Quote token address; the zero address is native MON. */
  quote: string;
  initialMarketCap?: number;
  migrationMarketCap?: number;
  /** Optional creator's first buy, in quote units, made in the same transaction. */
  firstBuy?: number;
  /** Where the curve graduates. Uniswap v2 unless the creator chooses Kuru. */
  venue?: Venue;
};

export type LaunchBuildResult = {
  steps: UnsignedTransaction[];
  /** Where the token will be — the launchpad predicted it. */
  token: Address;
  launchpad: Address;
  /** What the curve will raise before graduating, in quote units. */
  migrationQuoteThreshold: number;
};

export async function buildLaunch(request: LaunchBuildRequest): Promise<LaunchBuildResult> {
  const preset = CURVE_PRESETS[request.preset];
  if (!preset) {
    throw new CallerError(
      `Unknown preset "${request.preset}". One of: ${Object.keys(CURVE_PRESETS).join(", ")}`,
    );
  }

  const quote = quoteTokenFor(request.quote);
  if (!quote) throw new CallerError("Unsupported quote token");
  const creator = requireWallet(request.creator, "creator");

  // Explicit caps are taken as given, in quote units — the scripts rely on
  // that. Only the defaults are dollars, converted here.
  const caps =
    request.initialMarketCap === undefined || request.migrationMarketCap === undefined
      ? await defaultCapsIn(quote.address, preset)
      : null;

  let plan;
  try {
    plan = await planLaunch({
      creator,
      quote,
      name: request.name,
      symbol: request.symbol,
      uri: request.uri,
      preset: request.preset,
      initialMarketCap: request.initialMarketCap ?? caps!.initial,
      migrationMarketCap: request.migrationMarketCap ?? caps!.migration,
      firstBuy: request.firstBuy,
      venue: request.venue,
    });
  } catch (error) {
    if (error instanceof CallerError) throw error;
    if (error instanceof VenueUnavailableError) throw new CallerError(error.message);
    // The curve builder refuses an impossible valuation pair with a sentence.
    if (error instanceof Error && !(error instanceof BaseError)) throw new CallerError(error.message);
    throw error;
  }

  const calls: ContractCall[] = [];
  if (request.firstBuy && request.firstBuy > 0 && !quote.native) {
    const allowance = await quoteAllowance(creator, quote);
    if (allowance < uiToWei(request.firstBuy, quote.decimals)) calls.push(buildApproveCall(quote));
  }
  calls.push(plan.call);

  return {
    steps: await prepare(creator, calls),
    token: plan.token,
    launchpad: requireLaunchpad(),
    migrationQuoteThreshold: Number(plan.params.totals.threshold) / 10 ** quote.decimals,
  };
}

/* ------------------------------------------------------------------ */
/* Creator fees and graduation                                         */
/* ------------------------------------------------------------------ */

export async function buildClaim(request: { creator: string; token: string }): Promise<UnsignedTransaction[]> {
  const creator = requireWallet(request.creator, "creator");
  const snapshot = await fetchPoolSnapshot(request.token);
  if (!snapshot) throw new CallerError("This coin has no pool on this network");
  if (snapshot.pool.creator !== creator) throw new CallerError("Only the creator can claim this coin's fees", 403);
  if (snapshot.pool.creatorFees === 0n) throw new CallerError("Nothing to claim yet");
  return prepare(creator, [
    buildClaimCreatorFeesCall({ token: snapshot.token, to: creator, launchpad: snapshot.launchpad }),
  ]);
}

export async function buildGraduate(request: { from: string; token: string }): Promise<UnsignedTransaction[]> {
  const from = requireWallet(request.from, "from");
  const snapshot = await fetchPoolSnapshot(request.token);
  if (!snapshot) throw new CallerError("This coin has no pool on this network");
  if (snapshot.curve.graduated) throw new CallerError("This coin has already graduated");
  if (!snapshot.curve.complete) throw new CallerError("The curve has not filled yet");
  return prepare(from, [
    buildGraduateCall({ token: snapshot.token, launchpad: snapshot.launchpad, venue: snapshot.venue }),
  ]);
}

/* ------------------------------------------------------------------ */
/* Submit                                                              */
/* ------------------------------------------------------------------ */

export type SubmitResult = {
  hash: Hex;
  blockNumber: number;
  from: Address;
  /** Trades the transaction made, as recorded. */
  trades: number;
  /**
   * Set when the transaction launched a token. `pair` is the Uniswap v2 pair
   * it will graduate into; null for a Kuru launch, whose market only exists
   * after graduation.
   */
  launched?: { token: Address; pair: Address | null; creator: Address };
  /** Set when the transaction graduated a curve. */
  graduated?: { token: Address; venue: Address };
  /** Set when a buy filled the curve to its top. */
  completed?: Address[];
  /** Milliseconds from broadcast to a receipt in hand. */
  confirmedInMs?: number;
  /**
   * What a Perpl order did. An immediate-or-cancel order that found nothing
   * inside its price limit succeeds without a position, so "confirmed" alone
   * would mislead; this says whether it filled.
   */
  perp?: {
    /** `pricePNS` is the price the position opened at, in the market's price units. */
    opened?: { perpId: number; lots: string; pricePNS: string };
    closed?: { perpId: number };
    unfilledLots?: string;
    totalLots?: string;
  };
};

/** How long to wait for a receipt. Monad finalises in about a second. */
const RECEIPT_TIMEOUT_MS = 30_000;

/**
 * Broadcast a transaction the device signed, wait for its receipt, and record
 * what it did.
 *
 * The chain id is checked before anything is sent: a transaction signed for
 * the other network would otherwise fail with an error about a nonce or a
 * balance that has nothing to do with the real problem.
 */
export async function submitSigned(params: { signed: Hex }): Promise<SubmitResult> {
  const client = publicClient();

  let parsed;
  let from: Address;
  try {
    parsed = parseTransaction(params.signed);
    from = await recoverTransactionAddress({ serializedTransaction: params.signed as never });
  } catch {
    throw new CallerError("That is not a signed Monad transaction");
  }
  if (parsed.chainId !== undefined && parsed.chainId !== chainId()) {
    throw new CallerError(`This transaction was signed for chain ${parsed.chainId}, not ${chainId()}`);
  }

  /*
   * One call, not two. Monad implements `eth_sendRawTransactionSync`
   * (EIP-7966): the node broadcasts the transaction and answers with its
   * receipt once the block that includes it is proposed — a round trip where
   * `sendRawTransaction` + `waitForTransactionReceipt` is a send and a poll.
   * The time it took is measured here and shown on the phone, because "it
   * confirmed before you let go of the button" is the thing Monad is for.
   *
   * The hash is the keccak of the signed bytes, known before anything is
   * sent, so a timeout can still hand the person a transaction to look up.
   */
  const hash = keccak256(params.signed);
  const started = performance.now();
  let receipt: TransactionReceipt;
  try {
    // No `timeout` argument: EIP-7966 leaves its encoding loose and nodes
    // disagree (viem sends a JSON number; anvil wants a hex quantity), while
    // every implementation accepts the bare transaction. The transport's own
    // timeout bounds the wait instead.
    receipt = await client.sendRawTransactionSync({
      serializedTransaction: params.signed,
      throwOnReceiptRevert: false,
    });
  } catch (error) {
    if (!unsupportedMethod(error)) {
      if (/timed? ?out|timeout/i.test(String((error as Error)?.message ?? ""))) {
        throw new CallerError(
          `The network accepted this transaction but it has not confirmed yet. It is ${hash}.`,
          504,
        );
      }
      // A node refusing *this transaction* is not a fault in this server, and
      // reporting it as one hides the one thing the person can act on.
      throw new CallerError(explainFailure(error), 422);
    }
    // An endpoint without the sync method: broadcast, then wait.
    try {
      await client.sendRawTransaction({ serializedTransaction: params.signed });
    } catch (sendError) {
      throw new CallerError(explainFailure(sendError), 422);
    }
    try {
      receipt = await client.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS });
    } catch {
      throw new CallerError(
        `The network accepted this transaction but it has not confirmed yet. It is ${hash}.`,
        504,
      );
    }
  }
  const confirmedInMs = Math.round(performance.now() - started);

  if (receipt.status !== "success") {
    const reason = await revertReason(hash, receipt).catch(() => null);
    throw new CallerError(
      `${reason ?? "The transaction reverted."} It is on-chain as ${hash}.`,
      422,
    );
  }

  return { ...(await describeReceipt(receipt, from)), confirmedInMs };
}

/**
 * A transaction something else broadcast (Privy, sending for autopilot): wait
 * for its receipt and record what it did, as `submitSigned` does for a
 * transaction the device signed. `from` is the wallet it acted for; with gas
 * sponsorship the outer sender can be Privy's relayer.
 */
export async function settleSent(hash: Hex, from: Address, startedAt = performance.now()): Promise<SubmitResult> {
  let receipt: TransactionReceipt;
  try {
    receipt = await publicClient().waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS });
  } catch {
    throw new CallerError(`The network accepted this transaction but it has not confirmed yet. It is ${hash}.`, 504);
  }
  const confirmedInMs = Math.round(performance.now() - startedAt);
  if (receipt.status !== "success") {
    const reason = await revertReason(hash, receipt).catch(() => null);
    throw new CallerError(`${reason ?? "The transaction reverted."} It is on-chain as ${hash}.`, 422);
  }
  return { ...(await describeReceipt(receipt, from)), confirmedInMs };
}

/**
 * The endpoint does not implement the method, or not in the form it was
 * called — either way the transaction was never broadcast, so falling back to
 * a plain send cannot submit it twice. A refusal of the transaction itself
 * (bad nonce, no funds, a revert) is a different error and is not caught here.
 */
function unsupportedMethod(error: unknown): boolean {
  const text = error instanceof BaseError ? `${error.shortMessage}\n${error.details}` : String(error);
  const code = (error as { code?: number } | null)?.code ?? findCode(error);
  return (
    code === -32601 ||
    code === -32602 ||
    /method (not found|not supported|does not exist)|not implemented|invalid parameters were provided/i.test(text)
  );
}

function findCode(error: unknown): number | undefined {
  if (!(error instanceof BaseError)) return undefined;
  const found = error.walk((cause) => typeof (cause as { code?: unknown }).code === "number");
  return (found as { code?: number } | null)?.code;
}

async function describeReceipt(receipt: TransactionReceipt, from: Address): Promise<SubmitResult> {
  const launchpad = launchpadAddress();
  const result: SubmitResult = {
    hash: receipt.transactionHash,
    blockNumber: Number(receipt.blockNumber),
    from,
    trades: 0,
  };
  if (!launchpad) return result;

  const ours = receipt.logs.filter((log) => getAddress(log.address) === launchpad);
  const events = parseEventLogs({ abi: junoLaunchpadAbi, logs: ours });

  const touched = new Set<string>();
  const completed: Address[] = [];
  for (const event of events) {
    if (event.eventName === "Launched") {
      const pool = await readPool(getAddress(event.args.token), launchpad).catch(() => null);
      result.launched = {
        token: getAddress(event.args.token),
        pair:
          /^0x0+$/.test(event.args.venue) || (pool && venueOf(pool) === "kuru") ? null : getAddress(event.args.venue),
        creator: getAddress(event.args.creator),
      };
      touched.add(event.args.token);
    } else if (event.eventName === "Graduated") {
      result.graduated = { token: getAddress(event.args.token), venue: getAddress(event.args.venue) };
      touched.add(event.args.token);
    } else if (event.eventName === "CurveCompleted") {
      completed.push(getAddress(event.args.token));
    } else if (event.eventName === "Trade" || event.eventName === "CreatorFeesClaimed") {
      touched.add(event.args.token);
    }
  }
  if (completed.length) result.completed = completed;

  const trades = await recordReceiptTrades(receipt).catch(() => []);
  result.trades = trades.length;
  // A graduated coin's trades move its pair, not the launchpad: mark them too.
  for (const trade of trades) if (trade.venue === "uniswap-v2") touched.add(trade.token);

  // Perpl: whether an order filled, opened or closed a position.
  const exchange = perpExchange();
  const perpLogs = receipt.logs.filter((log) => getAddress(log.address) === exchange);
  if (perpLogs.length > 0) {
    const perp: NonNullable<SubmitResult["perp"]> = {};
    for (const event of parseEventLogs({ abi: perplExchangeAbi, logs: perpLogs })) {
      if (event.eventName === "PositionOpenedV2" || event.eventName === "PositionOpened") {
        const args = event.args as { perpId: bigint; lotLNS: bigint; pricePNS: bigint };
        perp.opened = { perpId: Number(args.perpId), lots: args.lotLNS.toString(), pricePNS: args.pricePNS.toString() };
      } else if (event.eventName === "PositionClosed") {
        perp.closed = { perpId: Number((event.args as { perpId: bigint }).perpId) };
      } else if (event.eventName === "ImmediateOrCancelExecuted") {
        const args = event.args as { unmatchedLotLNS: bigint; totalLotLNS: bigint };
        perp.unfilledLots = args.unmatchedLotLNS.toString();
        perp.totalLots = args.totalLotLNS.toString();
      }
    }
    result.perp = perp;
  }

  // Fills on a graduated coin's Kuru market. Envio indexes them for history;
  // here they only count, and mark the coin as moved.
  for (const log of receipt.logs) {
    const token = kuruTokenOf(getAddress(log.address));
    if (!token) continue;
    const [fill] = parseEventLogs({ abi: kuruOrderBookAbi, eventName: "Trade", logs: [log] });
    if (fill && getAddress(fill.args.takerAddress) === from) {
      result.trades += 1;
      touched.add(token);
    }
  }

  // Orders it rested on a Kuru book, so the orders list works without an indexer.
  await rememberKuruOrders(receipt, from).catch(() => 0);

  // The price, curve and history all just moved. Drop them so the next read
  // is live rather than a few seconds stale.
  for (const token of touched) {
    invalidatePoolSnapshot(token);
    invalidateSwapHistory(token);
  }
  return result;
}

/**
 * Why a mined transaction reverted, re-derived by replaying it as a call at
 * its own block. Receipts carry no reason; the replay does.
 */
async function revertReason(hash: Hex, receipt: TransactionReceipt): Promise<string | null> {
  const client = publicClient();
  const tx = await client.getTransaction({ hash });
  try {
    await client.call({
      account: tx.from,
      to: tx.to ?? undefined,
      data: tx.input,
      value: tx.value,
      blockNumber: receipt.blockNumber,
    });
    return null;
  } catch (error) {
    return explainFailure(error);
  }
}

/**
 * A transaction the network would not take, said in a sentence.
 *
 * The launchpad reverts with named errors, so most failures decode to exactly
 * what happened. What someone trying to buy $2 of a coin needs is which of the
 * handful of real causes it was. Anything unrecognised keeps its original text
 * rather than being flattened into a friendly non-answer — a wrong specific
 * reason is worse than an unfamiliar true one.
 */
export function explainFailure(error: unknown): string {
  const named = decodeLaunchpadError(error);
  switch (named) {
    case "Slippage":
      return "The price moved past your slippage while this was being signed. Try again for a fresh quote.";
    case "Expired":
      return "This quote expired before it was submitted. Try again for a fresh one.";
    case "CurveComplete":
      return "This curve has filled. It graduates to its AMM pair next.";
    case "CurveNotComplete":
      return "The curve has not filled yet, so it cannot graduate.";
    case "AlreadyGraduated":
      return "This coin has already graduated.";
    case "InsufficientLiquidity":
      return "There is not enough in this pool to buy that back. Try a smaller amount.";
    case "QuoteNotAllowed":
      return "The launchpad does not accept that quote token.";
    case "BadMetadata":
      return "The name, ticker or metadata link is too long or empty.";
    case "SupplyExceeded":
    case "BadCurve":
      return "That curve does not fit the fixed supply. Try a different valuation.";
    case "NotCreator":
      return "Only the creator can claim this coin's fees.";
    case "ZeroAmount":
      return "That amount is too small to trade.";
    case "PairLocked":
      return "Tokens cannot be sent to the AMM pair until the coin graduates.";
    case "GraduatorNotAllowed":
      return "That venue is not offered on this launchpad.";
    // Kuru, for a coin trading on its Kuru market.
    case "TransferFromFailed":
      return "Kuru could not take the tokens: this wallet does not hold enough of them.";
    case "SlippageExceeded":
      return "The book moved past your slippage while this was being signed. Try again for a fresh quote.";
    case "SizeError":
    case "Uint96Overflow":
      return "That size is outside what this Kuru market allows.";
    case "PriceError":
    case "TickSizeError":
      return "That price is not on this Kuru market's price grid.";
    case "PostOnlyError":
      return "That order would have filled at once, and it was set to only rest on the book.";
    case "InsufficientBalance":
      return "Kuru's MarginAccount does not hold enough for this order.";
    case "OrderAlreadyFilledOrCancelled":
      return "That order is already filled or cancelled.";
    case "NativeAssetInsufficient":
    case "NativeAssetMismatch":
      return "The MON sent did not match the order. Try again for a fresh quote.";
    case "ProtocolPaused":
      return "Kuru has paused trading on this market.";
    // Perpl.
    case "MarkPriceAgeExceedsMax":
      return "Perpl's price for this market is more than a minute old, so it is not opening positions right now. Closing still works.";
    case "TakerOrderSettlementFailed":
      return "Perpl could not settle that order — usually not enough collateral for the size and fee, or a stale price.";
    case "AccountDoesNotExist":
      return "This wallet has no Perpl account yet. Deposit AUSD to open one.";
    case "InsufficentAmountToOpenAccount":
      return "A new Perpl account needs at least 100 AUSD.";
    case "AmountExceedsAvailableBalance":
      return "That is more than the free balance on Perpl; collateral in open positions stays until they close.";
    case "CloseOrderExceedsPosition":
    case "CloseOrderPositionMismatch":
    case "PositionDoesNotExist":
      return "That position has already changed. Refresh and try again.";
    case "PriceOutOfRange":
      return "That price is outside what Perpl accepts for this market.";
    case "KuruPriceOutOfRange":
      return "Kuru cannot list a market at this curve's price. Launch at a larger opening valuation, or choose Uniswap v2.";
    case "ERC20InsufficientAllowance":
      return "Perpl was not allowed to take the AUSD. Try again; the approval comes first.";
    default:
      break;
  }

  const text = error instanceof BaseError ? error.shortMessage + "\n" + error.details : String((error as Error)?.message ?? error);
  // Monad's RPC says "insufficient balance" (not geth's "insufficient funds"),
  // which viem does not map to its own InsufficientFundsError.
  if (/insufficient (funds|balance)|exceeds (the )?balance|balance too low/i.test(text)) {
    return "Not enough MON in this wallet to cover the trade and its gas.";
  }
  if (/reserve balance/i.test(text)) {
    return "Monad keeps a small reserve of MON in every account for gas. Try a slightly smaller amount.";
  }
  if (/nonce too low|already known|replacement transaction/i.test(text)) {
    return "This transaction was already submitted, or a newer one replaced it. Refresh and try again.";
  }
  if (/nonce too high/i.test(text)) {
    return "An earlier transaction from this wallet has not landed yet. Wait a moment and try again.";
  }
  if (/invalid signature|invalid sender/i.test(text)) {
    return "The signature on this transaction did not verify. Try again.";
  }

  const first = error instanceof BaseError ? error.shortMessage : text.split("\n")[0];
  return first && first.trim().length > 0
    ? `The network refused this transaction: ${first.trim()}`
    : "The network refused this transaction.";
}

/**
 * Kuru's errors a Juno transaction can meet on a graduated coin's market —
 * the OrderBook's and MarginAccount's, and Solady's `TransferFromFailed`,
 * which Kuru uses to pull tokens.
 */
const KURU_ERRORS = parseAbi([
  "error TransferFromFailed()",
  "error SlippageExceeded()",
  "error SizeError()",
  "error Uint96Overflow()",
  "error PriceError()",
  "error TickSizeError()",
  "error PostOnlyError()",
  "error InsufficientBalance()",
  "error OrderAlreadyFilledOrCancelled()",
  "error NativeAssetInsufficient()",
  "error NativeAssetMismatch()",
  "error ProtocolPaused()",
  "error InsufficientLiquidity()",
]);

/** Every custom error a Juno transaction can revert with. */
const JUNO_ERRORS = [...junoLaunchpadAbi, ...junoTokenAbi, ...kuruGraduatorAbi, ...KURU_ERRORS, ...perplExchangeAbi].filter(
  (item) => item.type === "error",
);

/**
 * The custom error name buried in a viem error, if there is one.
 *
 * Two shapes reach here. A `readContract`/`simulate` failure has already been
 * decoded against an ABI and carries `data.errorName`. An `estimateGas` or
 * `sendRawTransaction` failure carries only the raw revert bytes, somewhere in
 * its cause chain, and is decoded here against the launchpad's and the token's
 * errors.
 */
function decodeLaunchpadError(error: unknown): string | null {
  if (!(error instanceof BaseError)) return null;
  let name: string | null = null;
  let raw: Hex | null = null;
  error.walk((cause) => {
    const data = (cause as { data?: unknown }).data;
    if (data && typeof data === "object" && typeof (data as { errorName?: unknown }).errorName === "string") {
      name = disambiguate(data as { errorName: string; args?: readonly unknown[] });
      return true;
    }
    if (typeof data === "string" && data.startsWith("0x") && data.length >= 10) {
      raw = data as Hex;
      return true;
    }
    return false;
  });
  if (name) return name;
  if (!raw) return null;
  try {
    return disambiguate(decodeErrorResult({ abi: JUNO_ERRORS, data: raw }));
  } catch {
    return null;
  }
}

/**
 * Two contracts Juno calls share an error name. Kuru's graduator reverts
 * `PriceOutOfRange(priceWad)` when Kuru cannot list a market at a curve's
 * price; Perpl reverts `PriceOutOfRange(price, min, max)` on an order. Their
 * argument counts tell them apart, and only one of them is about Perpl.
 */
function disambiguate(decoded: { errorName: string; args?: readonly unknown[] }): string {
  if (decoded.errorName === "PriceOutOfRange" && decoded.args?.length === 1) return "KuruPriceOutOfRange";
  return decoded.errorName;
}

/* ------------------------------------------------------------------ */
/* Kuru limit orders                                                   */
/* ------------------------------------------------------------------ */

/** The Kuru market of a coin that graduated there, or a sentence saying why not. */
async function requireKuruMarket(token: string): Promise<{ token: Address; market: Address }> {
  const snapshot = await fetchPoolSnapshot(token);
  if (!snapshot) throw new CallerError("This coin has no pool on this network");
  if (snapshot.venue !== "kuru") throw new CallerError("This coin does not graduate into Kuru");
  if (!snapshot.curve.graduated) throw new CallerError("Limit orders open once the coin graduates into its Kuru market");
  const market = await kuruMarketOf(snapshot.token);
  if (!market) throw new CallerError("This coin's Kuru market could not be found");
  return { token: snapshot.token, market };
}

export async function buildKuruLimit(request: {
  token: string;
  owner: string;
  side: TradeSide;
  price: number;
  amount: number;
}): Promise<{ steps: UnsignedTransaction[]; market: Address; price: number; amount: number; locks: { asset: "MON" | "token"; amount: number } }> {
  if (!(request.price > 0) || !(request.amount > 0)) throw new CallerError("Price and amount must be greater than zero");
  const owner = requireWallet(request.owner, "owner");
  const { token, market } = await requireKuruMarket(request.token);
  const order = await buildKuruLimitOrder({ market, token, owner, side: request.side, price: request.price, amount: request.amount }).catch(
    (error: unknown) => {
      if (error instanceof KuruOrderRejected) throw new CallerError(error.message);
      throw error;
    },
  );
  return { steps: await prepare(owner, order.calls), market, price: order.price, amount: order.amount, locks: order.locks };
}

export async function buildKuruCancelOrders(request: { token: string; owner: string; orderIds: string[] }): Promise<UnsignedTransaction[]> {
  const owner = requireWallet(request.owner, "owner");
  if (request.orderIds.length === 0 || request.orderIds.some((id) => !/^\d+$/.test(id))) {
    throw new CallerError("orderIds must be a list of order ids");
  }
  const { market } = await requireKuruMarket(request.token);
  return prepare(owner, [buildKuruCancel(market, request.orderIds.map((id) => BigInt(id)))]);
}

export async function buildKuruWithdrawAll(request: { token: string; owner: string }): Promise<UnsignedTransaction[]> {
  const owner = requireWallet(request.owner, "owner");
  const { token } = await requireKuruMarket(request.token);
  return prepare(owner, [await buildKuruWithdraw(token)]);
}

/* ------------------------------------------------------------------ */
/* Perps (Perpl)                                                       */
/* ------------------------------------------------------------------ */

function perpRejected(error: unknown): never {
  if (error instanceof PerpRejected) throw new CallerError(error.message);
  throw error;
}

/** Testnet AUSD from Agora's faucet, for Perpl collateral. Refusals are sentences, before signing. */
export async function buildAusdFaucet(request: { owner: string }): Promise<{ steps: UnsignedTransaction[]; amount: number }> {
  const owner = requireWallet(request.owner, "owner");
  const { call, amount } = await ausdFaucetCall(owner).catch(perpRejected);
  return { steps: await prepare(owner, [call]), amount };
}

/** Collateral into Perpl: opens the account on first use (at least the minimum). */
export async function buildPerpDeposit(request: { owner: string; amount: number }): Promise<UnsignedTransaction[]> {
  const owner = requireWallet(request.owner, "owner");
  if (!(request.amount > 0)) throw new CallerError("Amount must be greater than zero");
  const account = await perpAccount(owner);
  if (account.walletAusd < request.amount) {
    throw new CallerError(
      `This wallet holds ${account.walletAusd} AUSD. Perpl takes AUSD as collateral; on testnet it comes from Agora's faucet.`,
    );
  }
  if (account.accountId === null && request.amount < account.minimumOpen) {
    throw new CallerError(`A new Perpl account opens with at least ${account.minimumOpen} AUSD`);
  }
  const calls = await perpDepositCalls(owner, request.amount, account.accountId !== null).catch(perpRejected);
  return prepare(owner, calls);
}

export async function buildPerpWithdraw(request: { owner: string; amount: number }): Promise<UnsignedTransaction[]> {
  const owner = requireWallet(request.owner, "owner");
  const account = await perpAccount(owner);
  if (account.accountId === null) throw new CallerError("This wallet has no Perpl account");
  if (!(request.amount > 0) || request.amount > account.balance) {
    throw new CallerError(`You can withdraw up to ${account.balance} AUSD — collateral in open positions stays until they close`);
  }
  return prepare(owner, [perpWithdrawCall(request.amount)]);
}

export async function buildPerpOpen(request: {
  owner: string;
  perpId: number;
  side: "long" | "short";
  collateral: number;
  leverage: number;
  slippageBps?: number;
}): Promise<{ steps: UnsignedTransaction[]; size: number; mark: number; limitPrice: number }> {
  const owner = requireWallet(request.owner, "owner");
  const market = (await perpMarkets()).find((m) => m.id === request.perpId);
  if (!market) throw new CallerError("Perpl has no such market");
  if (!market.open) throw new CallerError(`Perpl's ${market.symbol} market is not taking new positions`);
  if (!(request.leverage >= 1) || request.leverage > market.maxLeverage) {
    throw new CallerError(`${market.symbol} takes 1x to ${market.maxLeverage}x`);
  }
  const account = await perpAccount(owner);
  if (account.accountId === null) throw new CallerError("Deposit AUSD to open your Perpl account first");
  if (!(request.collateral > 0) || request.collateral > account.balance) {
    throw new CallerError(`Your Perpl balance is ${account.balance} AUSD`);
  }
  const open = await perpOpenCall({
    perpId: request.perpId,
    side: request.side,
    collateral: request.collateral,
    leverage: request.leverage,
    slippageBps: request.slippageBps ?? 100,
    takerFee: market.takerFee,
  }).catch(perpRejected);
  return { steps: await prepare(owner, [open.call]), size: open.size, mark: open.mark, limitPrice: open.limitPrice };
}

export async function buildPerpClose(request: { owner: string; perpId: number; slippageBps?: number }): Promise<UnsignedTransaction[]> {
  const owner = requireWallet(request.owner, "owner");
  const account = await perpAccount(owner);
  const position = account.positions.find((p) => p.perpId === request.perpId);
  if (!position) throw new CallerError("No open position in that market");
  return prepare(owner, [
    await perpCloseCall({ perpId: request.perpId, position, slippageBps: request.slippageBps ?? 150 }),
  ]);
}
