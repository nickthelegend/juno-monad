import { encodeFunctionData, getAddress, maxUint256, parseAbi, parseEventLogs, type Address, type TransactionReceipt } from "viem";

import { junoSwapRouterAbi, junoTokenAbi } from "./abi";
import { publicClient } from "./client";
import { InsufficientLiquidityError, uiToWei, weiToUi, type ContractCall, type PoolSnapshot, type TradeQuote } from "./launchpad";
import { NATIVE, swapRouterAddress } from "./network";
import { withRetry } from "./rpc";
import type { PoolSwap } from "./swaps";
import type { TradeSide } from "./types";

/**
 * Trading a coin after it graduates into its Uniswap v2 pair.
 *
 * Graduation moves the curve's reserves into the pair and locks the
 * liquidity, and from then on the pair is the coin's market. Trades go
 * through `JunoSwapRouter` (contracts/src/JunoSwapRouter.sol), which moves the
 * input into the pair and swaps in the same transaction; MON is wrapped and
 * unwrapped on the way. Quotes come from the router's own `quote`, which prices
 * against the pair's reserves with v2's 0.3% fee — the formula the pair
 * enforces.
 */

/** v2 keeps 0.3% of every input in the pool. */
export const V2_FEE = 0.003;

/**
 * Gas a pair's swap can need beyond what an estimate saw.
 *
 * A v2 pair updates its two cumulative-price slots only when time has passed
 * since its last update. An estimate taken in the same second as that update
 * — the swap straight after a graduation, or after another trade — skips both
 * writes, and the swap then lands a block later and pays for them: from zero
 * on a pair's first swap, two 22,100-gas stores. Seen on the fork: a buy
 * built right after a graduation ran out of gas inside `swap`. Monad charges
 * the whole limit, so this is the two stores and no more.
 */
export const V2_SWAP_HEADROOM = 45_000n;

export class NoRouterError extends Error {
  constructor() {
    super("This deployment has no swap router for graduated coins");
  }
}

export function requireRouter(): Address {
  const router = swapRouterAddress();
  if (!router) throw new NoRouterError();
  return router;
}

/** The side of the pair a trade enters and leaves by, as the router spells them. */
function legs(snapshot: PoolSnapshot, side: TradeSide): { tokenIn: Address; tokenOut: Address } {
  const quote = snapshot.quote.native ? NATIVE : snapshot.quote.address;
  return side === "buy" ? { tokenIn: quote, tokenOut: snapshot.token } : { tokenIn: snapshot.token, tokenOut: quote };
}

/**
 * Quote a trade against the pair, in the same shape as a curve quote.
 *
 * `curveImpact` here is the pair's own movement (the fee taken out), so the
 * trade sheet reads the same way before and after graduation.
 */
export async function quoteV2Trade(params: {
  snapshot: PoolSnapshot;
  side: TradeSide;
  /** Quote units on a buy, token units on a sell. */
  amountIn: number;
  /** The same input in wei, when it is known exactly; wins over `amountIn`. */
  amountInRaw?: bigint;
  slippageBps?: number;
}): Promise<TradeQuote> {
  const { snapshot, side, amountIn, slippageBps = 100 } = params;
  const router = requireRouter();
  const { tokenIn, tokenOut } = legs(snapshot, side);
  const inDecimals = side === "buy" ? snapshot.quoteDecimals : snapshot.baseDecimals;
  const outDecimals = side === "buy" ? snapshot.baseDecimals : snapshot.quoteDecimals;
  const inRaw = params.amountInRaw ?? uiToWei(amountIn, inDecimals);

  let outRaw: bigint;
  let reserveInRaw: bigint;
  let reserveOutRaw: bigint;
  try {
    [outRaw, reserveInRaw, reserveOutRaw] = await withRetry(() =>
      publicClient().readContract({
        address: router,
        abi: junoSwapRouterAbi,
        functionName: "quote",
        args: [tokenIn, tokenOut, inRaw],
      }),
    );
  } catch (error) {
    if (/InsufficientLiquidity|NoPair/.test(String((error as Error)?.message ?? error))) {
      throw new InsufficientLiquidityError();
    }
    throw error;
  }

  const minimumRaw = (outRaw * BigInt(10_000 - slippageBps)) / 10_000n;
  const amountOut = weiToUi(outRaw, outDecimals);
  const reserveIn = weiToUi(reserveInRaw, inDecimals);
  const reserveOut = weiToUi(reserveOutRaw, outDecimals);
  // What the input would get at the pair's current price, with and without its fee.
  const spotOut = reserveIn > 0 ? (amountIn * reserveOut) / reserveIn : 0;
  const netSpotOut = spotOut * (1 - V2_FEE);
  // The fee in quote units: off the input on a buy, out of the output on a sell.
  const fee = side === "buy" ? amountIn * V2_FEE : (amountOut * V2_FEE) / (1 - V2_FEE);

  return {
    amountOut,
    minimumAmountOut: weiToUi(minimumRaw, outDecimals),
    amountUsed: amountIn,
    fee,
    priceImpact: spotOut > 0 ? Math.max(0, (spotOut - amountOut) / spotOut) : 0,
    curveImpact: netSpotOut > 0 ? Math.max(0, (netSpotOut - amountOut) / netSpotOut) : 0,
    raw: { amountIn: inRaw, amountOut: outRaw, minimumAmountOut: minimumRaw },
  };
}

/** How much of `token` the router may pull from `owner`. */
async function routerAllowance(token: Address, owner: Address, router: Address): Promise<bigint> {
  return withRetry(() =>
    publicClient().readContract({ address: token, abi: junoTokenAbi, functionName: "allowance", args: [owner, router] }),
  );
}

/**
 * The calls a graduated trade needs, in order: an approval when the router
 * cannot yet pull the input (a sell, or a buy with USDC), then the swap.
 */
export async function buildV2SwapCalls(params: {
  snapshot: PoolSnapshot;
  owner: Address;
  side: TradeSide;
  quote: TradeQuote;
  deadline: bigint;
}): Promise<ContractCall[]> {
  const { snapshot, owner, side, quote, deadline } = params;
  const router = requireRouter();
  const calls: ContractCall[] = [];
  const nativeQuote = snapshot.quote.native;

  const pulled = side === "sell" ? snapshot.token : nativeQuote ? null : snapshot.quote.address;
  if (pulled && (await routerAllowance(pulled, owner, router)) < quote.raw.amountIn) {
    calls.push({
      to: pulled,
      data: encodeFunctionData({ abi: junoTokenAbi, functionName: "approve", args: [router, maxUint256] }),
      value: 0n,
      label: side === "sell" ? "Allowing the swap router to take the coin" : `Allowing the swap router to take ${snapshot.quote.symbol}`,
    });
  }

  const args = { raw: quote.raw, owner, deadline };
  if (side === "buy" && nativeQuote) {
    calls.push({
      to: router,
      data: encodeFunctionData({
        abi: junoSwapRouterAbi,
        functionName: "buyWithNative",
        args: [snapshot.token, args.raw.minimumAmountOut, owner, deadline],
      }),
      value: args.raw.amountIn,
      label: "Buying on Uniswap v2",
      extraGas: V2_SWAP_HEADROOM,
    });
  } else if (side === "sell" && nativeQuote) {
    calls.push({
      to: router,
      data: encodeFunctionData({
        abi: junoSwapRouterAbi,
        functionName: "sellForNative",
        args: [snapshot.token, args.raw.amountIn, args.raw.minimumAmountOut, owner, deadline],
      }),
      value: 0n,
      label: "Selling on Uniswap v2",
      extraGas: V2_SWAP_HEADROOM,
    });
  } else {
    const { tokenIn, tokenOut } = legs(snapshot, side);
    calls.push({
      to: router,
      data: encodeFunctionData({
        abi: junoSwapRouterAbi,
        functionName: "swapExactTokens",
        args: [tokenIn, tokenOut, args.raw.amountIn, args.raw.minimumAmountOut, owner, deadline],
      }),
      value: 0n,
      label: side === "buy" ? "Buying on Uniswap v2" : "Selling on Uniswap v2",
      extraGas: V2_SWAP_HEADROOM,
    });
  }
  return calls;
}

const syncAbi = parseAbi(["event Sync(uint112 reserve0, uint112 reserve1)"]);
const pairAbi = parseAbi(["function token0() view returns (address)"]);

/**
 * The router's fills in a receipt, as trade rows.
 *
 * `Swapped` names the trader and the amounts; the pair's `Sync`, emitted by
 * the same swap, gives the reserves right after it — the post-trade price a
 * chart plots, as a curve trade's row carries.
 */
export async function routerSwapsIn(
  receipt: TransactionReceipt,
  lookup: (token: Address) => Promise<{ decimals: number } | null>,
  timestamp: bigint,
): Promise<PoolSwap[]> {
  const router = swapRouterAddress();
  if (!router) return [];
  const events = parseEventLogs({
    abi: junoSwapRouterAbi,
    eventName: "Swapped",
    logs: receipt.logs.filter((log) => getAddress(log.address) === router),
  });
  const swaps: PoolSwap[] = [];
  for (const event of events) {
    const { pair, trader, tokenIn, tokenOut, amountIn, amountOut, to } = event.args;
    // The coin is whichever side is a Juno pool; the other is its quote.
    // MON in is always a buy, MON out always a sell; between two tokens
    // (a USDC-quoted coin) the lookup says which one is the coin.
    let buy: boolean;
    if (getAddress(tokenIn) === NATIVE) buy = true;
    else if (getAddress(tokenOut) === NATIVE) buy = false;
    else buy = (await lookup(getAddress(tokenOut))) !== null;
    const token = getAddress(buy ? tokenOut : tokenIn);
    const quote = await lookup(token);
    if (!quote) continue;

    const sync = parseEventLogs({
      abi: syncAbi,
      eventName: "Sync",
      logs: receipt.logs.filter((log) => getAddress(log.address) === getAddress(pair) && log.logIndex < event.logIndex),
    }).pop();
    let price = 0;
    if (sync) {
      const token0 = await withRetry(() =>
        publicClient().readContract({ address: pair, abi: pairAbi, functionName: "token0" }),
      );
      const coinIs0 = getAddress(token0) === token;
      const coinReserve = weiToUi(coinIs0 ? sync.args.reserve0 : sync.args.reserve1, 18);
      const quoteReserve = weiToUi(coinIs0 ? sync.args.reserve1 : sync.args.reserve0, quote.decimals);
      price = coinReserve > 0 ? quoteReserve / coinReserve : 0;
    }

    const baseAmount = weiToUi(buy ? amountOut : amountIn, 18);
    const quoteAmount = weiToUi(buy ? amountIn : amountOut, quote.decimals);
    swaps.push({
      id: `${event.transactionHash}:${event.logIndex}`,
      txHash: event.transactionHash,
      logIndex: event.logIndex,
      token,
      side: buy ? "buy" : "sell",
      baseAmount,
      quoteAmount,
      fee: buy ? quoteAmount * V2_FEE : (quoteAmount * V2_FEE) / (1 - V2_FEE),
      price: price > 0 ? price : baseAmount > 0 ? quoteAmount / baseAmount : 0,
      // Whose position changed: the buyer's recipient, or the seller.
      trader: getAddress(buy ? to : trader),
      timestamp: new Date(Number(timestamp) * 1000).toISOString(),
      blockNumber: Number(event.blockNumber),
      venue: "uniswap-v2",
    });
  }
  return swaps;
}
