import type { PoolSwap } from "./swaps";

/**
 * Kuru's taker fee on the markets Juno opens (`KuruGraduator.TAKER_FEE_BPS`).
 * Kuru takes it from what the order receives; its events report the gross fill.
 */
export const KURU_TAKER_FEE = 0.003;

/**
 * One Kuru fill from the taker's side, as a trade, given the gross fill in
 * display units. A buy's fee comes out of the tokens and a sell's out of the
 * MON; it is stated in MON either way. `quoteAmount` is what was paid (buy) or
 * received (sell), the curve's convention, so one cost basis spans both venues.
 */
export function kuruTakerSwap(fill: {
  id: string;
  txHash: string;
  logIndex: number;
  token: string;
  trader: string;
  isBuy: boolean;
  grossBase: number;
  grossQuote: number;
  price: number;
  timestamp: string;
  blockNumber: number;
}): PoolSwap {
  const fee = fill.grossQuote * KURU_TAKER_FEE;
  return {
    id: fill.id,
    txHash: fill.txHash,
    logIndex: fill.logIndex,
    token: fill.token,
    side: fill.isBuy ? "buy" : "sell",
    baseAmount: fill.grossBase * (fill.isBuy ? 1 - KURU_TAKER_FEE : 1),
    quoteAmount: fill.isBuy ? fill.grossQuote : fill.grossQuote - fee,
    fee,
    price: fill.price,
    trader: fill.trader,
    timestamp: fill.timestamp,
    blockNumber: fill.blockNumber,
    venue: "kuru",
  };
}

/**
 * One Kuru market order, as one trade.
 *
 * Kuru logs a `Trade` for every price level an order takes — each resting
 * order and each step of the vault's range — so one sell of 178M tokens into a
 * thin book came back as a hundred rows. Activity is twenty rows long, so that
 * one sale was the whole of it; a portfolio counted it as a hundred trades.
 *
 * Fills of one transaction by one trader on one side are one trade: amounts and
 * fees add up, and the price is the last level reached — the mark the order
 * left behind, which is what `PoolSwap.price` means everywhere else. The id is
 * the first fill's, so it is stable across reads.
 *
 * Merging is by key, so it is safe to run again on rows it already merged: a
 * caller that pages through fills can merge each page and then the whole, and
 * an order split across a page boundary comes back together.
 */
export function coalesceFills(swaps: PoolSwap[]): PoolSwap[] {
  const out: PoolSwap[] = [];
  const groups = new Map<string, { swap: PoolSwap; lastLogIndex: number }>();
  for (const swap of swaps) {
    if (swap.venue !== "kuru") {
      out.push(swap);
      continue;
    }
    const key = `${swap.txHash.toLowerCase()}:${swap.token.toLowerCase()}:${swap.trader.toLowerCase()}:${swap.side}`;
    const group = groups.get(key);
    if (!group) {
      const copy = { ...swap };
      groups.set(key, { swap: copy, lastLogIndex: swap.logIndex });
      out.push(copy);
      continue;
    }
    const merged = group.swap;
    merged.baseAmount += swap.baseAmount;
    merged.quoteAmount += swap.quoteAmount;
    merged.fee += swap.fee;
    if (swap.logIndex > group.lastLogIndex) {
      group.lastLogIndex = swap.logIndex;
      merged.price = swap.price;
    }
    if (swap.logIndex < merged.logIndex) {
      merged.logIndex = swap.logIndex;
      merged.id = swap.id;
    }
  }
  return out;
}
