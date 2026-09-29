import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { junoLogCursor, junoSwaps } from "@/lib/db/schema";
import { networkKey } from "./network";
import type { PoolSwap } from "./swaps";

/**
 * Decoded trades, remembered.
 *
 * Every surface in the app — the chart, the portfolio, the leaderboard, the
 * feed, the crowd figures — reads the same trades. Monad's public RPC answers
 * `eth_getLogs` over at most 100 blocks, which is thirty seconds of chain, so
 * re-reading history from logs on every render is not an option. A trade is
 * decoded once, from the receipt of the transaction that made it or from the
 * launchpad's log tail, and written down here.
 *
 * ## This is not a cache of prices
 *
 * Nothing here is derived. Every column is something a `Trade` event said,
 * keyed by the log that proves it, so a row can be checked against an
 * explorer. Prices, volumes and P&L are still computed from these rows at read
 * time — the chain remains the source of truth and this is a record of what
 * was already read from it.
 *
 * ## Why `txHash:logIndex`
 *
 * The same trade reaches this table twice — once from the receipt when the app
 * submits it, once from the log tail — and the key makes the second write a
 * no-op rather than a duplicate. That makes every writer safe to call on every
 * pass, including partial ones.
 */

/** Write decoded trades. Idempotent — the log is the key. */
export async function rememberSwaps(swaps: PoolSwap[]): Promise<void> {
  const rows = swaps
    // A fill with no timestamp cannot be placed on a chart's time axis, and
    // `new Date(0)` would put it in 1970 rather than admitting the gap.
    .filter((swap) => Number.isFinite(Date.parse(swap.timestamp)))
    .map((swap) => ({
      id: swap.id,
      txHash: swap.txHash,
      logIndex: swap.logIndex,
      token: swap.token,
      network: networkKey(),
      side: swap.side,
      baseAmount: swap.baseAmount,
      quoteAmount: swap.quoteAmount,
      fee: swap.fee,
      price: swap.price,
      trader: swap.trader,
      blockNumber: swap.blockNumber,
      blockTime: new Date(swap.timestamp),
      venue: swap.venue ?? null,
    }));
  if (rows.length === 0) return;

  await getDb().insert(junoSwaps).values(rows).onConflictDoNothing();
}

/** Everything remembered for one token, newest first. */
export async function recalledSwaps(token: string, limit = 200): Promise<PoolSwap[]> {
  const rows = await getDb()
    .select()
    .from(junoSwaps)
    .where(and(eq(junoSwaps.token, token), eq(junoSwaps.network, networkKey())))
    .orderBy(desc(junoSwaps.blockNumber), desc(junoSwaps.logIndex))
    .limit(limit);

  return rows.map(toSwap);
}

/**
 * Everything remembered for several tokens at once.
 *
 * One query for a whole leaderboard rather than one per pool.
 */
export async function recalledSwapsFor(tokens: string[], limit = 2_000): Promise<Map<string, PoolSwap[]>> {
  const out = new Map<string, PoolSwap[]>();
  if (tokens.length === 0) return out;

  const rows = await getDb()
    .select()
    .from(junoSwaps)
    .where(and(eq(junoSwaps.network, networkKey()), inArray(junoSwaps.token, tokens)))
    .orderBy(desc(junoSwaps.blockNumber), desc(junoSwaps.logIndex))
    .limit(limit);

  for (const row of rows) {
    const list = out.get(row.token) ?? [];
    list.push(toSwap(row));
    out.set(row.token, list);
  }
  return out;
}

/** Every trade one wallet made, across all tokens, newest first. */
export async function recalledSwapsByTrader(trader: string, limit = 1_000): Promise<PoolSwap[]> {
  const rows = await getDb()
    .select()
    .from(junoSwaps)
    .where(and(eq(junoSwaps.network, networkKey()), eq(junoSwaps.trader, trader)))
    .orderBy(desc(junoSwaps.blockNumber), desc(junoSwaps.logIndex))
    .limit(limit);
  return rows.map(toSwap);
}

function toSwap(row: typeof junoSwaps.$inferSelect): PoolSwap {
  return {
    id: row.id,
    txHash: row.txHash,
    logIndex: row.logIndex,
    token: row.token,
    side: row.side === "sell" ? "sell" : "buy",
    baseAmount: row.baseAmount,
    quoteAmount: row.quoteAmount,
    fee: row.fee,
    price: row.price,
    trader: row.trader,
    timestamp: row.blockTime.toISOString(),
    blockNumber: row.blockNumber,
    ...(row.venue === "kuru" || row.venue === "uniswap-v2" ? { venue: row.venue } : {}),
  };
}

/** Newest first, the order every caller expects. */
export function compareSwaps(a: PoolSwap, b: PoolSwap): number {
  return b.blockNumber - a.blockNumber || b.logIndex - a.logIndex;
}

/**
 * Merge two reads of the same history.
 *
 * Deduplicated by log id with the *fresh* row winning, though in practice they
 * agree — a confirmed log does not change.
 */
export function mergeSwaps(recalled: PoolSwap[], fresh: PoolSwap[]): PoolSwap[] {
  // Transactions that hold a v2 fill of a coin, by any record's account: a
  // row stored before fills kept their venue still names the same trade.
  const onPair = new Set(
    [...recalled, ...fresh].filter((swap) => swap.venue === "uniswap-v2").map((swap) => pairTx(swap)),
  );
  const byId = new Map<string, PoolSwap>();
  const key = (swap: PoolSwap) => (onPair.has(pairTx(swap)) ? `${pairTx(swap)}:v2` : swap.id);
  for (const swap of recalled) byId.set(key(swap), swap);
  for (const swap of fresh) byId.set(key(swap), { ...byId.get(key(swap)), ...swap });
  return [...byId.values()].sort(compareSwaps);
}

function pairTx(swap: PoolSwap): string {
  return `${swap.txHash}:${swap.token.toLowerCase()}`;
}


/* ------------------------------------------------------------------ */
/* The log cursor                                                      */
/* ------------------------------------------------------------------ */

function cursorId(launchpad: string): string {
  return `${networkKey()}:${launchpad}`;
}

/** The last block whose launchpad logs are fully recorded, or null if none are. */
export async function readCursor(launchpad: string): Promise<bigint | null> {
  const [row] = await getDb()
    .select({ block: junoLogCursor.block })
    .from(junoLogCursor)
    .where(eq(junoLogCursor.id, cursorId(launchpad)))
    .limit(1);
  return row ? BigInt(row.block) : null;
}

export async function writeCursor(launchpad: string, block: bigint): Promise<void> {
  await getDb()
    .insert(junoLogCursor)
    .values({ id: cursorId(launchpad), block: Number(block), updatedAt: new Date() })
    .onConflictDoUpdate({
      target: junoLogCursor.id,
      set: { block: Number(block), updatedAt: new Date() },
    });
}
