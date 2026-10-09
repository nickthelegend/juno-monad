import "server-only";

import type { Hash } from "viem";

import { ensureHeartbeat, heartbeatSnapshot } from "./heartbeat";
import { recallContent } from "./ipfs-cache";
import { quoteTokenFor } from "./launchpad";
import { mediaCid } from "./media";
import { isMainnet } from "./network";
import { getPool } from "./registry";
import { swapsOfTransaction } from "./swap-store";
import { readTxCost } from "./tx-cost-read";
import { timingOf } from "./tx-timing";

/**
 * Everything a shareable receipt card says, each figure read or measured:
 * - `executedMs`: broadcast to receipt, as Juno's server measured it when it
 *   submitted the transaction (kept in `tx_timings`); null for a transaction
 *   Juno did not submit;
 * - `finalMs`: Monad testnet's finality right now, the live median of its
 *   commit stream, labelled as the network's on the card;
 * - the trade, from the trade table the receipt path writes;
 * - the fee from the receipt, and the same gas on Ethereum now.
 * A figure that could not be read is null and the card leaves it out.
 */
export type ReceiptCard = {
  hash: string;
  blockNumber: number;
  localFork: boolean;
  network: "monad" | "monad-testnet";
  executedMs: number | null;
  finalMs: number | null;
  trade: {
    side: "buy" | "sell";
    baseAmount: number;
    quoteAmount: number;
    quoteSymbol: string;
    venue: "curve" | "kuru" | "uniswap-v2";
    symbol: string;
    name: string;
  } | null;
  /** A data URI of the coin's picture when this server holds it; never fetched for the card. */
  image: string | null;
  fee: { mon: number; usd: number | null; billed: "limit" | "used" };
  ethereum: { usd: number | null; eth: number } | null;
};

export async function loadReceiptCard(hash: Hash): Promise<ReceiptCard | null> {
  ensureHeartbeat(isMainnet());
  const [cost, executedMs, swaps] = await Promise.all([
    readTxCost(hash),
    timingOf(hash).catch(() => null),
    swapsOfTransaction(hash).catch(() => []),
  ]);
  if (!cost) return null;
  const swap = swaps[0] ?? null;
  const pool = swap ? await getPool(swap.token).catch(() => null) : null;

  let image: string | null = null;
  const cid = mediaCid(pool?.posterUrl) ?? (pool?.mediaMime?.startsWith("video") ? null : mediaCid(pool?.mediaUrl));
  const held = cid ? recallContent(cid) : null;
  if (held && /^image\/(png|jpe?g)$/i.test(held.type)) {
    image = `data:${held.type};base64,${Buffer.from(held.bytes).toString("base64")}`;
  }

  return {
    hash,
    blockNumber: cost.blockNumber,
    localFork: cost.localFork,
    network: isMainnet() ? "monad" : "monad-testnet",
    executedMs,
    finalMs: heartbeatSnapshot(isMainnet()).finalizedMs,
    trade:
      swap && pool
        ? {
            side: swap.side,
            baseAmount: swap.baseAmount,
            quoteAmount: swap.quoteAmount,
            quoteSymbol: quoteTokenFor(pool.quoteToken)?.symbol ?? "MON",
            venue: swap.venue ?? "curve",
            symbol: pool.symbol,
            name: pool.name,
          }
        : null,
    image,
    fee: { mon: cost.monad.feeMon, usd: cost.monad.feeUsd, billed: cost.monad.billed },
    ethereum: cost.ethereum ? { usd: cost.ethereum.feeUsd, eth: cost.ethereum.feeEth } : null,
  };
}

/* Formatting, for the card's text. */

export function compactAmount(value: number): string {
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e4) return `${(value / 1e3).toFixed(1)}K`;
  if (value >= 1) return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return value.toPrecision(2);
}

/** Two significant figures past the zeros: 0.0063, 0.000052. */
export function smallAmount(value: number): string {
  if (value === 0) return "0";
  if (value >= 1) return value.toFixed(3);
  const decimals = Math.min(12, Math.max(2, 1 - Math.floor(Math.log10(value))));
  return value.toFixed(decimals);
}

export function usd(value: number): string {
  if (value >= 100) return `$${Math.round(value).toLocaleString("en-US")}`;
  if (value >= 0.01) return `$${value.toFixed(2)}`;
  if (value === 0) return "$0";
  return `$${smallAmount(value)}`;
}

/** The sentence for the trade: "Bought 1.23M $COIN for 0.1 MON". */
export function tradeLine(trade: NonNullable<ReceiptCard["trade"]>): string {
  const base = `${compactAmount(trade.baseAmount)} $${trade.symbol}`;
  const quote = `${smallAmount(trade.quoteAmount)} ${trade.quoteSymbol}`;
  return trade.side === "buy" ? `Bought ${base} for ${quote}` : `Sold ${base} for ${quote}`;
}

export const VENUE_LABEL: Record<NonNullable<ReceiptCard["trade"]>["venue"], string> = {
  curve: "on its bonding curve",
  kuru: "filled on Kuru",
  "uniswap-v2": "on its Uniswap v2 pair",
};
