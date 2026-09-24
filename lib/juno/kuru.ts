import {
  encodeFunctionData,
  maxUint256,
  zeroAddress,
  type Address,
} from "viem";

import { junoTokenAbi, kuruGraduatorAbi, kuruOrderBookAbi } from "./abi";
import { publicClient } from "./client";
import {
  InsufficientLiquidityError,
  uiToWei,
  weiToUi,
  type ContractCall,
  type TradeQuote,
} from "./launchpad";
import { kuruGraduatorAddress } from "./network";
import { withRetry } from "./rpc";
import type { TradeSide } from "./types";

/**
 * The Kuru venue.
 *
 * A creator can choose, at launch, where their curve graduates: a Uniswap v2
 * pair (the default) or a Kuru order-book market. With Kuru, the filled curve
 * opens a new spot market for the token against MON, seeds its AMM vault with
 * the curve's reserves at exactly the price the curve finished on, and locks
 * the vault shares for good (`contracts/src/graduators/KuruGraduator.sol`).
 *
 * After that the coin trades on Kuru, and this module is how the app trades
 * it: market orders placed straight on the coin's OrderBook, quoted for free
 * with Kuru's own simulation path — an `eth_call` from the zero address
 * matches the order against the book and the vault without moving anything,
 * so the quote is exactly what the order would fill at right now.
 *
 * Testnet only: on mainnet Kuru's Router lets only Kuru's own Safe create
 * markets, so no Kuru graduator is deployed there.
 */

/** Whether new launches may choose Kuru on this deployment. */
export function kuruAvailable(): boolean {
  return kuruGraduatorAddress() !== null;
}

/* ------------------------------------------------------------------ */
/* Markets                                                             */
/* ------------------------------------------------------------------ */

/** A graduated coin's market. Only set once, so cached for the process. */
const marketCache = new Map<string, Address>();
/** And back: which coin a market trades, for reading fills out of a receipt. */
const tokenByMarket = new Map<string, Address>();

/** The coin a known Kuru market trades, if this process has looked it up. */
export function kuruTokenOf(market: Address): Address | null {
  return tokenByMarket.get(market) ?? null;
}

/** The Kuru market a coin graduated into, or null before graduation. */
export async function kuruMarketOf(token: Address): Promise<Address | null> {
  const graduator = kuruGraduatorAddress();
  if (!graduator) return null;
  const hit = marketCache.get(token);
  if (hit) return hit;
  const market = await withRetry(() =>
    publicClient().readContract({
      address: graduator,
      abi: kuruGraduatorAbi,
      functionName: "marketOf",
      args: [token],
    }),
  );
  if (market === zeroAddress) return null;
  marketCache.set(token, market);
  tokenByMarket.set(market, token);
  return market;
}

export type KuruMarketParams = {
  pricePrecision: bigint;
  sizePrecision: bigint;
  tickSize: number;
  minSize: bigint;
  maxSize: bigint;
  takerFeeBps: number;
  makerFeeBps: number;
};

const paramsCache = new Map<string, KuruMarketParams>();

/** A market's fixed parameters — set when it was created, never changed. */
export async function kuruMarketParams(market: Address): Promise<KuruMarketParams> {
  const hit = paramsCache.get(market);
  if (hit) return hit;
  const [pricePrecision, sizePrecision, , , , , tickSize, minSize, maxSize, takerFeeBps, makerFeeBps] =
    await withRetry(() =>
      publicClient().readContract({ address: market, abi: kuruOrderBookAbi, functionName: "getMarketParams" }),
    );
  const params = {
    pricePrecision: BigInt(pricePrecision),
    sizePrecision: BigInt(sizePrecision),
    tickSize: Number(tickSize),
    minSize: BigInt(minSize),
    maxSize: BigInt(maxSize),
    takerFeeBps: Number(takerFeeBps),
    makerFeeBps: Number(makerFeeBps),
  };
  paramsCache.set(market, params);
  return params;
}

export type KuruBook = {
  market: Address;
  /** Best bid and ask, MON per token. Zero when that side is empty. */
  bestBid: number;
  bestAsk: number;
  /** Midpoint, or whichever side exists. Null for an empty book. */
  mid: number | null;
  /** (ask - bid) / mid, or null without both sides. */
  spread: number | null;
  params: KuruMarketParams;
};

/** The top of a market's book, live. Includes the AMM vault's quotes. */
export async function readKuruBook(market: Address): Promise<KuruBook> {
  const [params, [bidWad, askWad]] = await Promise.all([
    kuruMarketParams(market),
    withRetry(() =>
      publicClient().readContract({ address: market, abi: kuruOrderBookAbi, functionName: "bestBidAsk" }),
    ),
  ]);
  const bestBid = weiToUi(bidWad, 18);
  // An empty ask side reads back as the maximum uint.
  const bestAsk = askWad >= maxUint256 / 2n ? 0 : weiToUi(askWad, 18);
  const mid = bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : bestAsk || bestBid || null;
  return {
    market,
    bestBid,
    bestAsk,
    mid,
    spread: bestBid > 0 && bestAsk > 0 && mid ? (bestAsk - bestBid) / mid : null,
    params,
  };
}

/* ------------------------------------------------------------------ */
/* Quotes and orders                                                   */
/* ------------------------------------------------------------------ */

const WAD = 10n ** 18n;

const decimalsOf = (precision: bigint) => precision.toString().length - 1;

/**
 * Quote a market order on a coin's Kuru market.
 *
 * A buy spends MON: Kuru takes the amount in `pricePrecision` units, and the
 * MON sent must equal it exactly, so the input is rounded down to that
 * precision and `amountUsed` says what will actually be spent. A sell is sized
 * in `sizePrecision` units of the token, rounded down the same way.
 *
 * `raw.amountIn` is in wei of the input either way — the MON to send, or the
 * tokens to sell — and `buildKuruOrder` converts back without loss.
 */
export async function quoteKuruTrade(params: {
  market: Address;
  side: TradeSide;
  /** MON on a buy, tokens on a sell. */
  amountIn: number;
  slippageBps?: number;
}): Promise<TradeQuote & { book: KuruBook }> {
  const { market, side, amountIn, slippageBps = 100 } = params;
  const book = await readKuruBook(market);
  const { pricePrecision, sizePrecision, takerFeeBps } = book.params;

  const sizeArg =
    side === "buy"
      ? uiToWei(amountIn, decimalsOf(pricePrecision))
      : uiToWei(amountIn, decimalsOf(sizePrecision));
  if (sizeArg === 0n) throw new KuruOrderTooSmall();
  const inWei = (sizeArg * WAD) / (side === "buy" ? pricePrecision : sizePrecision);

  let outWei: bigint;
  try {
    const { result } = await publicClient().simulateContract({
      // Kuru's quoting path: from the zero address the book matches the order
      // and returns what it would fill, without taking or paying anything.
      account: zeroAddress,
      address: market,
      abi: kuruOrderBookAbi,
      functionName: side === "buy" ? "placeAndExecuteMarketBuy" : "placeAndExecuteMarketSell",
      args: [sizeArg, 0n, false, false],
    });
    outWei = result;
  } catch {
    // Below the market's minimum size, or more than the book and vault hold.
    throw new InsufficientLiquidityError();
  }
  if (outWei === 0n) throw new InsufficientLiquidityError();

  const used = weiToUi(inWei, 18);
  const amountOut = weiToUi(outWei, 18);
  const feeRate = takerFeeBps / 10_000;
  // Kuru takes its taker fee from what the order receives.
  const grossOut = amountOut / (1 - feeRate);
  const fee = side === "buy" ? grossOut * feeRate * book.bestAsk : grossOut * feeRate;

  const spot = side === "buy" ? book.bestAsk : book.bestBid;
  const spotOut = spot > 0 ? (side === "buy" ? used / spot : used * spot) : 0;
  const minimumRaw = (outWei * BigInt(10_000 - slippageBps)) / 10_000n;

  return {
    amountOut,
    minimumAmountOut: weiToUi(minimumRaw, 18),
    amountUsed: used,
    fee,
    priceImpact: spotOut > 0 ? Math.max(0, (spotOut - amountOut) / spotOut) : 0,
    curveImpact: spotOut > 0 ? Math.max(0, (spotOut - grossOut) / spotOut) : 0,
    raw: { amountIn: inWei, amountOut: outWei, minimumAmountOut: minimumRaw },
    book,
  };
}

export class KuruOrderTooSmall extends Error {
  constructor() {
    super("That amount is below the market's precision");
  }
}

/**
 * The calls for a market order: the order itself, and before a sell, a
 * one-time approval for the market to take the tokens (Kuru pulls them from
 * the wallet into its MarginAccount as it fills).
 */
export async function buildKuruOrder(params: {
  market: Address;
  token: Address;
  owner: Address;
  side: TradeSide;
  quote: TradeQuote;
}): Promise<ContractCall[]> {
  const { market, token, owner, side, quote } = params;
  const { pricePrecision, sizePrecision } = await kuruMarketParams(market);

  if (side === "buy") {
    const quoteSize = (quote.raw.amountIn * pricePrecision) / WAD;
    return [
      {
        to: market,
        data: encodeFunctionData({
          abi: kuruOrderBookAbi,
          functionName: "placeAndExecuteMarketBuy",
          // Immediate-or-cancel: fill what the book has now, never rest.
          args: [quoteSize, quote.raw.minimumAmountOut, false, false],
        }),
        value: quote.raw.amountIn,
        label: "Buying on Kuru",
      },
    ];
  }

  const calls: ContractCall[] = [];
  const allowance = await withRetry(() =>
    publicClient().readContract({ address: token, abi: junoTokenAbi, functionName: "allowance", args: [owner, market] }),
  );
  if (allowance < quote.raw.amountIn) {
    calls.push({
      to: token,
      data: encodeFunctionData({ abi: junoTokenAbi, functionName: "approve", args: [market, maxUint256] }),
      value: 0n,
      label: "Allowing Kuru to take the coin",
    });
  }
  const size = (quote.raw.amountIn * sizePrecision) / WAD;
  calls.push({
    to: market,
    data: encodeFunctionData({
      abi: kuruOrderBookAbi,
      functionName: "placeAndExecuteMarketSell",
      args: [size, quote.raw.minimumAmountOut, false, false],
    }),
    value: 0n,
    label: "Selling on Kuru",
  });
  return calls;
}
