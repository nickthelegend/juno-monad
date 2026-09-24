import {
  encodeFunctionData,
  maxUint256,
  zeroAddress,
  type Address,
} from "viem";

import { junoTokenAbi, kuruGraduatorAbi, kuruMarginAccountAbi, kuruOrderBookAbi, kuruRouterAbi } from "./abi";
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

/** The Router a graduator deploys through. Immutable, so read once. */
let routerOf: Promise<Address> | null = null;

/**
 * Where a Kuru-venue coin's market will be, before it graduates.
 *
 * Kuru markets are CREATE2 proxies, and everything that goes into the salt is
 * fixed at launch: the token, native MON, the fees, the spread, and the
 * precisions and sizes `KuruGraduator.marketParams` derives from the curve's
 * final price. So the address is known from the moment the coin exists —
 * the same thing the Uniswap venue offers with its counterfactual pair, and
 * the reason a squatter gains nothing: the graduator reuses whatever market
 * sits there, and the lock keeps the token out of it until graduation.
 *
 * `quoteAmount` is what graduation will deposit: the migration threshold
 * before the curve fills, the actual reserve after. Null when this deployment
 * has no Kuru graduator.
 */
export async function predictKuruMarket(
  token: Address,
  baseAmount: bigint,
  quoteAmount: bigint,
): Promise<Address | null> {
  const graduator = kuruGraduatorAddress();
  if (!graduator) return null;
  const client = publicClient();

  if (!routerOf) {
    const read = withRetry(() =>
      client.readContract({ address: graduator, abi: kuruGraduatorAbi, functionName: "router" }),
    );
    routerOf = read;
    read.catch(() => {
      if (routerOf === read) routerOf = null;
    });
  }

  const [router, params, taker, maker, spread] = await Promise.all([
    routerOf,
    withRetry(() =>
      client.readContract({
        address: graduator,
        abi: kuruGraduatorAbi,
        functionName: "marketParams",
        args: [baseAmount, quoteAmount],
      }),
    ),
    withRetry(() => client.readContract({ address: graduator, abi: kuruGraduatorAbi, functionName: "TAKER_FEE_BPS" })),
    withRetry(() => client.readContract({ address: graduator, abi: kuruGraduatorAbi, functionName: "MAKER_FEE_BPS" })),
    withRetry(() => client.readContract({ address: graduator, abi: kuruGraduatorAbi, functionName: "AMM_SPREAD" })),
  ]);

  return withRetry(() =>
    client.readContract({
      address: router,
      abi: kuruRouterAbi,
      functionName: "computeAddress",
      args: [
        token,
        zeroAddress,
        params.sizePrecision,
        params.pricePrecision,
        params.tickSize,
        params.minSize,
        params.maxSize,
        taker,
        maker,
        spread,
        zeroAddress,
        false,
      ],
    }),
  );
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

/* ------------------------------------------------------------------ */
/* Limit orders                                                        */
/* ------------------------------------------------------------------ */

/**
 * Kuru's MarginAccount on this network: where limit orders are paid from and
 * where their fills land. The graduator was built with it.
 */
async function marginAccountAddress(): Promise<Address> {
  const graduator = kuruGraduatorAddress();
  if (!graduator) throw new Error("Kuru is not configured on this server");
  return withRetry(() =>
    publicClient().readContract({ address: graduator, abi: kuruGraduatorAbi, functionName: "marginAccount" }),
  );
}

export type KuruBalances = {
  /** MON and tokens held for this wallet in Kuru's MarginAccount, UI units. */
  mon: number;
  tokens: number;
};

/** What a wallet holds in Kuru's MarginAccount: unfilled orders' change, and every fill. */
export async function kuruBalances(owner: Address, token: Address): Promise<KuruBalances> {
  const margin = await marginAccountAddress();
  const [mon, tokens] = await Promise.all(
    [zeroAddress, token].map((asset) =>
      withRetry(() =>
        publicClient().readContract({
          address: margin,
          abi: kuruMarginAccountAbi,
          functionName: "getBalance",
          args: [owner, asset],
        }),
      ),
    ),
  );
  return { mon: weiToUi(mon, 18), tokens: weiToUi(tokens, 18) };
}

export class KuruOrderRejected extends Error {}

/**
 * A limit order on a coin's Kuru book, paid from the MarginAccount.
 *
 * A buy locks MON, a sell locks tokens; whatever the MarginAccount already
 * holds for the wallet is used first, and only the shortfall is deposited —
 * with an approval first for tokens. The price is snapped to the market's
 * tick, down for a buy and up for a sell, so the order is never worse than
 * asked. It is not post-only: a price that crosses the book fills at once at
 * the book's better prices, and the rest rests.
 */
export async function buildKuruLimitOrder(params: {
  market: Address;
  token: Address;
  owner: Address;
  side: TradeSide;
  /** MON per token. */
  price: number;
  /** Tokens. */
  amount: number;
}): Promise<{ calls: ContractCall[]; price: number; amount: number; locks: { asset: "MON" | "token"; amount: number } }> {
  const { market, token, owner, side } = params;
  const { pricePrecision, sizePrecision, tickSize, minSize, maxSize } = await kuruMarketParams(market);

  const exact = params.price * Number(pricePrecision);
  const ticks = side === "buy" ? Math.floor(exact / tickSize) : Math.ceil(exact / tickSize);
  const priceInt = BigInt(ticks * tickSize);
  if (priceInt <= 0n || priceInt > 0xffffffffn) throw new KuruOrderRejected("That price is outside what this market can quote");

  const size = uiToWei(params.amount, decimalsOf(sizePrecision));
  if (size < minSize) {
    throw new KuruOrderRejected(`The smallest order here is ${weiToUi(minSize, decimalsOf(sizePrecision))} tokens`);
  }
  if (size > maxSize) {
    throw new KuruOrderRejected(`The largest single order here is ${weiToUi(maxSize, decimalsOf(sizePrecision))} tokens`);
  }

  // What the order locks, rounded up so the MarginAccount never comes up short.
  const lockWei =
    side === "buy"
      ? (size * priceInt * WAD + sizePrecision * pricePrecision - 1n) / (sizePrecision * pricePrecision)
      : (size * WAD) / sizePrecision;

  const margin = await marginAccountAddress();
  const asset = side === "buy" ? zeroAddress : token;
  const held = await withRetry(() =>
    publicClient().readContract({ address: margin, abi: kuruMarginAccountAbi, functionName: "getBalance", args: [owner, asset] }),
  );
  const shortfall = lockWei > held ? lockWei - held : 0n;

  // Only the shortfall comes from the wallet — check it is there, so the
  // person hears why now rather than from a reverted deposit.
  if (shortfall > 0n) {
    const inWallet =
      side === "buy"
        ? await withRetry(() => publicClient().getBalance({ address: owner }))
        : await withRetry(() =>
            publicClient().readContract({ address: token, abi: junoTokenAbi, functionName: "balanceOf", args: [owner] }),
          );
    if (inWallet < shortfall) {
      throw new KuruOrderRejected(
        side === "buy"
          ? `This order locks ${weiToUi(lockWei, 18)} MON and the wallet holds ${weiToUi(inWallet, 18)}.`
          : `This order locks ${weiToUi(lockWei, 18)} tokens and the wallet holds ${weiToUi(inWallet, 18)}.`,
      );
    }
  }

  const calls: ContractCall[] = [];
  if (shortfall > 0n && side === "sell") {
    const allowance = await withRetry(() =>
      publicClient().readContract({ address: token, abi: junoTokenAbi, functionName: "allowance", args: [owner, margin] }),
    );
    if (allowance < shortfall) {
      calls.push({
        to: token,
        data: encodeFunctionData({ abi: junoTokenAbi, functionName: "approve", args: [margin, maxUint256] }),
        value: 0n,
        label: "Allowing Kuru to hold the coin",
      });
    }
  }
  if (shortfall > 0n) {
    calls.push({
      to: margin,
      data: encodeFunctionData({ abi: kuruMarginAccountAbi, functionName: "deposit", args: [owner, asset, shortfall] }),
      value: side === "buy" ? shortfall : 0n,
      label: side === "buy" ? "Moving MON to Kuru" : "Moving the coin to Kuru",
    });
  }
  calls.push({
    to: market,
    data: encodeFunctionData({
      abi: kuruOrderBookAbi,
      functionName: side === "buy" ? "addBuyOrder" : "addSellOrder",
      args: [Number(priceInt), size, false],
    }),
    value: 0n,
    label: side === "buy" ? "Placing your bid" : "Placing your offer",
  });

  return {
    calls,
    price: Number(priceInt) / Number(pricePrecision),
    amount: weiToUi(size, decimalsOf(sizePrecision)),
    locks: { asset: side === "buy" ? "MON" : "token", amount: weiToUi(lockWei, 18) },
  };
}

/** Cancel resting orders; what they locked goes back to the MarginAccount. */
export function buildKuruCancel(market: Address, orderIds: bigint[]): ContractCall {
  return {
    to: market,
    data: encodeFunctionData({ abi: kuruOrderBookAbi, functionName: "batchCancelOrders", args: [orderIds.map(Number)] }),
    value: 0n,
    label: orderIds.length > 1 ? "Cancelling your orders" : "Cancelling your order",
  };
}

/** Move everything the MarginAccount holds for this coin — fills and change — back to the wallet. */
export async function buildKuruWithdraw(token: Address): Promise<ContractCall> {
  const margin = await marginAccountAddress();
  return {
    to: margin,
    data: encodeFunctionData({
      abi: kuruMarginAccountAbi,
      functionName: "batchWithdrawMaxTokens",
      args: [[zeroAddress, token]],
    }),
    value: 0n,
    label: "Withdrawing from Kuru",
  };
}

export type KuruOpenOrder = {
  orderId: string;
  isBuy: boolean;
  /** MON per token. */
  price: number;
  size: number;
  remaining: number;
};

/**
 * A wallet's resting orders on a market, checked against the book itself.
 *
 * `candidates` are order ids the indexer saw this wallet place; each is read
 * from `s_orders` so what is shown is what the book holds right now — an
 * order filled or cancelled a block ago is not listed.
 */
export async function kuruOpenOrders(market: Address, owner: Address, candidates: bigint[]): Promise<KuruOpenOrder[]> {
  if (candidates.length === 0) return [];
  const { pricePrecision, sizePrecision } = await kuruMarketParams(market);
  const results = await publicClient().multicall({
    contracts: candidates.map((id) => ({
      address: market,
      abi: kuruOrderBookAbi,
      functionName: "s_orders" as const,
      args: [Number(id)] as const,
    })),
    allowFailure: true,
  });
  const open: KuruOpenOrder[] = [];
  results.forEach((result, index) => {
    if (result.status !== "success") return;
    const [orderOwner, size, , , , price, , isBuy] = result.result as readonly [
      Address,
      bigint,
      number,
      number,
      number,
      number,
      number,
      boolean,
    ];
    if (size === 0n || orderOwner.toLowerCase() !== owner.toLowerCase()) return;
    open.push({
      orderId: candidates[index].toString(),
      isBuy,
      price: Number(price) / Number(pricePrecision),
      size: weiToUi(size, decimalsOf(sizePrecision)),
      remaining: weiToUi(size, decimalsOf(sizePrecision)),
    });
  });
  return open;
}
