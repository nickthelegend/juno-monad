import "server-only";

import { curveTotals } from "./curve-math";
import { feeSchedule } from "./economics";
import { quoteTrade, weiToUi, type PoolSnapshot, type TradeQuote } from "./launchpad";

/**
 * How much this curve can take.
 *
 * A bonding curve moves as it fills, so "the price" is only the price of an
 * infinitesimal trade. Every other size clears higher — and how much higher is
 * the single most useful thing a trader can know about a curve, because it is
 * the whole difference between the four presets this app offers.
 *
 * Both functions here quote against the *live* curve through the launchpad's
 * own `quoteBuy` / `quoteSell` — the same arithmetic `buy` and `sell` run.
 * Nothing is modelled or approximated. The probes of one round are issued
 * together, and viem folds them into a single Multicall3 `eth_call`, so a
 * twelve-point chart is one round trip rather than twelve.
 */

export type DepthPoint = {
  /** Input size, in quote units for a buy and base units for a sell. */
  amountIn: number;
  amountOut: number;
  /** Realised price of the whole fill — not the spot price. */
  averagePrice: number;
  /** Total shortfall against spot, fee included: 0.012 is 1.2%. */
  priceImpact: number;
  /** The part of that the curve caused, with the fee taken out. */
  curveImpact: number;
  /** Trading fee on this size, in quote units. */
  fee: number;
};

/**
 * The most this curve can absorb on one side right now, in the input token's
 * UI units — read from the pool, not searched for.
 *
 * A buy can spend what is left to the curve's top, grossed up by the current
 * fee; past that the launchpad fills what it can and refunds the rest. A sell
 * can return at most what the curve has sold; past that it reverts. Knowing
 * both up front means no probe is spent on a size that cannot happen.
 */
export function capacity(snapshot: PoolSnapshot, side: "buy" | "sell"): number {
  const { pool } = snapshot;
  if (side === "buy") {
    const remaining = pool.migrationQuoteThreshold - pool.quoteReserve;
    if (remaining <= 0n) return 0;
    const fee = feeSchedule(pool);
    const feeFraction = (fee?.currentBps ?? pool.endFeeBps) / 10_000;
    return weiToUi(remaining, snapshot.quoteDecimals) / Math.max(1e-6, 1 - feeFraction);
  }
  const { curveBase } = curveTotals(pool.sqrtStartPriceX96, snapshot.segments);
  const sold = curveBase - pool.baseReserve;
  // A hair under: rounding always favours the pool, so the very last wei of a
  // round trip may not be accepted back.
  return sold > 0n ? weiToUi(sold, snapshot.baseDecimals) * 0.999_999 : 0;
}

/** Quote one size, or null when the curve cannot fill it. */
async function quoteAt(snapshot: PoolSnapshot, side: "buy" | "sell", amountIn: number): Promise<TradeQuote | null> {
  const quote = await quoteTrade({ snapshot, side, amountIn }).catch(() => null);
  if (!quote || !(quote.amountOut > 0)) return null;
  // A buy past the top is only partly filled; that is not this size's price.
  if (side === "buy" && quote.amountUsed < amountIn * (1 - 1e-9)) return null;
  return quote;
}

/**
 * Sample the curve across sizes, for a depth chart.
 *
 * Logarithmically spaced, because impact on a curve is not linear in size and
 * an evenly spaced sample spends most of its points in the flat part. The top
 * of the range is the largest size the curve will actually fill rather than the
 * caller's ceiling — sampling past it drew nothing, so a twelve-point chart
 * came back with four.
 */
export async function sampleDepth(
  snapshot: PoolSnapshot,
  side: "buy" | "sell",
  /** Largest size to consider, in the input token's UI units. */
  max: number,
  steps = 12,
): Promise<DepthPoint[]> {
  if (!(max > 0)) return [];

  const top = Math.min(max, capacity(snapshot, side));
  if (!(top > 0)) return [];

  const min = top / 1000;
  const sizes = Array.from({ length: steps }, (_, i) => min * Math.pow(top / min, i / (steps - 1)));
  // Issued together: one multicall, not twelve requests.
  const quotes = await Promise.all(sizes.map((amountIn) => quoteAt(snapshot, side, amountIn)));

  const points: DepthPoint[] = [];
  quotes.forEach((quote, i) => {
    if (!quote) return;
    const amountIn = sizes[i];
    points.push({
      amountIn,
      amountOut: quote.amountOut,
      averagePrice: side === "buy" ? amountIn / quote.amountOut : quote.amountOut / amountIn,
      priceImpact: quote.priceImpact,
      curveImpact: quote.curveImpact,
      fee: quote.fee,
    });
  });
  return points;
}

export type SizeSuggestion = {
  /** The largest input that stays inside the impact budget. */
  amountIn: number;
  amountOut: number;
  /** Total shortfall at that size, fee included — what it actually costs. */
  priceImpact: number;
  /** What the search was run on: curve movement, with the fee excluded. */
  curveImpact: number;
  fee: number;
  averagePrice: number;
  /**
   * True when the whole range this curve can fill stays inside the budget, so
   * the answer is bounded by the curve rather than by the budget. Saying so
   * matters: "you can buy this much without moving it 1%" is a different claim
   * from "this is all there is to buy".
   */
  ceilingReached: boolean;
};

/**
 * The largest trade that stays under a chosen price impact.
 *
 * Searched rather than solved: the curve's closed form changes with the fee
 * schedule and sixteen liquidity ranges, and asking the same quoting function
 * the transaction uses is both simpler and exactly right. The search is a grid,
 * refined — each round quotes a dozen sizes in one multicall, so three rounds
 * pin the answer to well under a percent in three round trips.
 *
 * Returns null when even the smallest probe exceeds the budget, which is a real
 * answer on a thin curve: there is no size that small a move allows.
 */
export async function suggestSize(
  snapshot: PoolSnapshot,
  side: "buy" | "sell",
  /**
   * Budget as a ratio: 0.01 for 1%. Measured on *curve movement*, not on total
   * cost — the fee is a constant percentage that does not grow with size, so
   * searching on it would mostly be searching on a constant.
   */
  budget: number,
  /** Where to stop looking, in input units. */
  ceiling: number,
  probes = 16,
): Promise<SizeSuggestion | null> {
  if (!(budget > 0) || !(ceiling > 0)) return null;

  const at = async (amountIn: number) => {
    const quote = await quoteAt(snapshot, side, amountIn);
    if (!quote) return null;
    return {
      amountIn,
      amountOut: quote.amountOut,
      priceImpact: quote.priceImpact,
      curveImpact: quote.curveImpact,
      fee: quote.fee,
      averagePrice: side === "buy" ? amountIn / quote.amountOut : quote.amountOut / amountIn,
    };
  };

  // Search inside what the curve can actually fill.
  const top = Math.min(ceiling, capacity(snapshot, side));
  if (!(top > 0)) return null;

  const atTop = await at(top);
  if (atTop && atTop.curveImpact <= budget) return { ...atTop, ceilingReached: top < ceiling };

  let low = top / 100_000;
  let high = top;
  let best: Awaited<ReturnType<typeof at>> = null;
  const rounds = Math.max(1, Math.ceil(probes / 12));

  for (let round = 0; round < rounds; round += 1) {
    const sizes = Array.from({ length: 12 }, (_, i) => low * Math.pow(high / low, i / 11));
    const quotes = await Promise.all(sizes.map((size) => at(size)));
    let lastInside = -1;
    quotes.forEach((quote, i) => {
      if (quote && quote.curveImpact <= budget) lastInside = i;
    });
    if (lastInside < 0) break;
    best = quotes[lastInside];
    if (lastInside === sizes.length - 1) break;
    low = sizes[lastInside];
    high = sizes[lastInside + 1];
  }

  return best ? { ...best, ceilingReached: false } : null;
}
