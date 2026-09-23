import "server-only";

import {
  decodeEventLog,
  getAddress,
  parseEventLogs,
  type Address,
  type Log,
  type TransactionReceipt,
} from "viem";

import { junoLaunchpadAbi } from "./abi";
import { publicClient } from "./client";
import { envioConfigured, envioTrades } from "./envio";
import { quoteTokenOfPool } from "./launchpad";
import { launchpadAddress, launchpadDeployBlock } from "./network";
import { ttlCache, withRetry } from "./rpc";
import { mergeSwaps, readCursor, recalledSwaps, rememberSwaps, writeCursor } from "./swap-store";
import type { PricePoint } from "./types";

/**
 * Trade history, read from the launchpad's own `Trade` events.
 *
 * Every buy and sell emits one, with the trader, both amounts, the fee and the
 * price it left behind — so a fill's side and size are facts the contract
 * stated, not something reconstructed from balance changes.
 *
 * ## Getting them without hammering the RPC
 *
 * Monad's public endpoint answers `eth_getLogs` over at most a hundred blocks:
 * thirty seconds of chain. So history arrives three ways, cheapest first:
 *
 * 1. **The receipt.** Every trade made in the app is submitted by this server,
 *    which reads its `Trade` log from the receipt and records it on the spot.
 *    The chart moves the moment the transaction confirms.
 * 2. **The log tail.** One cursor for the whole launchpad walks forward a few
 *    ranges per request, catching trades made anywhere else — another app, a
 *    script, a direct contract call.
 * 3. **Envio.** When `ENVIO_GRAPHQL_URL` points at the HyperIndex deployment in
 *    `indexer/`, history comes from there instead: complete from the
 *    launchpad's first block, whatever the RPC allows.
 *
 * A history that the tail has not caught up on is reported `partial`, and the
 * UI says so rather than presenting a prefix as the whole story.
 */

export type PoolSwap = {
  /** `${txHash}:${logIndex}`. */
  id: string;
  txHash: string;
  logIndex: number;
  /** The token traded. */
  token: string;
  side: "buy" | "sell";
  /** Tokens that changed hands, in UI units. */
  baseAmount: number;
  /** Quote the trader paid (buy, fee included) or received (sell, fee deducted). */
  quoteAmount: number;
  /** Trading fee, in quote UI units. */
  fee: number;
  /** Realised price of this trade, in quote per token. */
  price: number;
  /** Whose position changed. */
  trader: string;
  timestamp: string;
  blockNumber: number;
};

const BASE_DECIMALS = 18;

type TradeArgs = {
  token: Address;
  trader: Address;
  isBuy: boolean;
  baseAmount: bigint;
  quoteAmount: bigint;
  fee: bigint;
};

/** Turn one decoded `Trade` into a row, or null when it moved nothing. */
export function swapFromTrade(params: {
  args: TradeArgs;
  txHash: string;
  logIndex: number;
  blockNumber: bigint | number;
  timestamp: number | bigint;
  quoteDecimals: number;
}): PoolSwap | null {
  const { args, quoteDecimals } = params;
  const baseAmount = Number(args.baseAmount) / 10 ** BASE_DECIMALS;
  const quoteAmount = Number(args.quoteAmount) / 10 ** quoteDecimals;
  if (!(baseAmount > 0) || !(quoteAmount > 0)) return null;
  return {
    id: `${params.txHash}:${params.logIndex}`,
    txHash: params.txHash,
    logIndex: params.logIndex,
    token: getAddress(args.token),
    side: args.isBuy ? "buy" : "sell",
    baseAmount,
    quoteAmount,
    fee: Number(args.fee) / 10 ** quoteDecimals,
    price: quoteAmount / baseAmount,
    trader: getAddress(args.trader),
    timestamp: new Date(Number(params.timestamp) * 1000).toISOString(),
    blockNumber: Number(params.blockNumber),
  };
}

/** Decode one raw log, or null when it is not a launchpad `Trade`. */
export function decodeTradeLog(log: Log, quoteDecimals: number, timestamp?: number | bigint): PoolSwap | null {
  try {
    const decoded = decodeEventLog({ abi: junoLaunchpadAbi, data: log.data, topics: log.topics });
    if (decoded.eventName !== "Trade") return null;
    const at = timestamp ?? (log as Log & { blockTimestamp?: bigint }).blockTimestamp;
    if (at === undefined || log.transactionHash === null || log.logIndex === null || log.blockNumber === null) {
      return null;
    }
    return swapFromTrade({
      args: decoded.args as TradeArgs,
      txHash: log.transactionHash,
      logIndex: log.logIndex,
      blockNumber: log.blockNumber,
      timestamp: at,
      quoteDecimals,
    });
  } catch {
    return null;
  }
}

/**
 * The trades in a transaction this server just submitted, recorded at once.
 *
 * The receipt carries the logs but not the block's time, so that costs one
 * `getBlock` — paid once per trade instead of once per chart render.
 */
export async function recordReceiptTrades(receipt: TransactionReceipt): Promise<PoolSwap[]> {
  const launchpad = launchpadAddress();
  if (!launchpad) return [];
  const events = parseEventLogs({
    abi: junoLaunchpadAbi,
    eventName: "Trade",
    logs: receipt.logs.filter((log) => getAddress(log.address) === launchpad),
  });
  if (events.length === 0) return [];

  const block = await withRetry(() => publicClient().getBlock({ blockNumber: receipt.blockNumber }));
  const swaps: PoolSwap[] = [];
  for (const event of events) {
    const quote = await quoteTokenOfPool(getAddress(event.args.token), launchpad);
    if (!quote) continue;
    const swap = swapFromTrade({
      args: event.args as TradeArgs,
      txHash: event.transactionHash,
      logIndex: event.logIndex,
      blockNumber: event.blockNumber,
      timestamp: block.timestamp,
      quoteDecimals: quote.decimals,
    });
    if (swap) swaps.push(swap);
  }
  await rememberSwaps(swaps).catch(() => undefined);
  for (const swap of swaps) invalidateSwapHistory(swap.token);
  return swaps;
}

/* ------------------------------------------------------------------ */
/* The log tail                                                        */
/* ------------------------------------------------------------------ */

/**
 * Blocks per `eth_getLogs`. The public endpoint allows 100; a dedicated RPC
 * usually allows far more, and `JUNO_LOG_RANGE` says how many.
 */
function logRange(): bigint {
  const raw = Number(process.env.JUNO_LOG_RANGE ?? 100);
  return BigInt(Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 100);
}

/** How many ranges one request may walk before it answers. */
const RANGES_PER_SYNC = 12;

/**
 * Where the tail starts on a fresh database with no deploy block configured:
 * the last ten thousand blocks, rather than genesis.
 */
const COLD_START_WINDOW = 10_000n;

export type SyncState = {
  /** The last block whose logs are recorded. */
  cursor: bigint | null;
  latest: bigint | null;
  /** Within a couple of blocks of the head. */
  caughtUp: boolean;
};

let syncing: Promise<SyncState> | null = null;

/**
 * Walk the launchpad's log tail forward a few ranges.
 *
 * Shared across concurrent callers — a page render that asks for six pools'
 * histories starts one walk, not six. Failure is tolerated: a refused range
 * leaves the cursor where it was and the next request picks it up.
 */
export async function syncTrades(): Promise<SyncState> {
  syncing ??= runSync().finally(() => {
    syncing = null;
  });
  return syncing;
}

async function runSync(): Promise<SyncState> {
  const launchpad = launchpadAddress();
  if (!launchpad) return { cursor: null, latest: null, caughtUp: false };
  const client = publicClient();

  let latest: bigint;
  try {
    latest = await withRetry(() => client.getBlockNumber({ cacheTime: 0 }));
  } catch {
    return { cursor: null, latest: null, caughtUp: false };
  }

  const recorded = await readCursor(launchpad).catch(() => null);
  const deployed = launchpadDeployBlock();
  let cursor: bigint =
    recorded ?? (deployed > 0n ? deployed - 1n : latest > COLD_START_WINDOW ? latest - COLD_START_WINDOW : 0n);

  const range = logRange();
  for (let pass = 0; pass < RANGES_PER_SYNC && cursor < latest; pass++) {
    const fromBlock: bigint = cursor + 1n;
    const toBlock: bigint = fromBlock + range - 1n < latest ? fromBlock + range - 1n : latest;
    try {
      const logs = await withRetry(
        () =>
          client.getLogs({
            address: launchpad,
            event: junoLaunchpadAbi.find((item) => item.type === "event" && item.name === "Trade") as never,
            fromBlock,
            toBlock,
          }),
        { attempts: 3, baseDelayMs: 300, maxDelayMs: 2_000 },
      );
      const swaps: PoolSwap[] = [];
      for (const log of logs as Log[]) {
        const token = log.topics[1] ? getAddress(`0x${log.topics[1].slice(26)}`) : null;
        if (!token) continue;
        const quote = await quoteTokenOfPool(token, launchpad).catch(() => null);
        if (!quote) continue;
        const swap = decodeTradeLog(log, quote.decimals);
        if (swap) swaps.push(swap);
      }
      await rememberSwaps(swaps);
      await writeCursor(launchpad, toBlock);
      for (const token of new Set(swaps.map((swap) => swap.token))) invalidateSwapHistory(token);
      cursor = toBlock;
    } catch {
      break;
    }
  }

  return { cursor, latest, caughtUp: latest - cursor <= 2n };
}

/* ------------------------------------------------------------------ */
/* Reading history                                                     */
/* ------------------------------------------------------------------ */

export type SwapHistory = {
  swaps: PoolSwap[];
  /**
   * True when part of the history could not be read. Callers that publish a
   * total — volume, a chart's range — need to know they are summing a subset,
   * because a short read looks exactly like a quiet market otherwise.
   */
  partial: boolean;
};

/** Kept small: a coin page shows recent trades, not an archive. */
const DEFAULT_LIMIT = 200;

/**
 * History is cached briefly. A trade that just landed is still shown at once:
 * the submit path records it and drops this cache on the way back.
 */
const HISTORY_TTL_MS = 15_000;
const PARTIAL_TTL_MS = 5_000;
const historyCache = ttlCache<SwapHistory>(HISTORY_TTL_MS);

/** Every trade Juno can see for this token, newest first. */
export async function listSwapHistory(token: string, limit = DEFAULT_LIMIT): Promise<SwapHistory> {
  const address = getAddress(token);
  return historyCache.get(
    `${address}:${limit}`,
    async () => {
      if (envioConfigured()) {
        const fromIndexer = await envioTrades({ token: address, limit }).catch(() => null);
        if (fromIndexer) {
          // The indexer lags the head by a block or two; anything the receipt
          // path recorded since is merged in so a fresh trade is never missing.
          const recent = await recalledSwaps(address, 20).catch(() => [] as PoolSwap[]);
          return { swaps: mergeSwaps(fromIndexer, recent).slice(0, limit), partial: false };
        }
      }

      const state = await syncTrades().catch(() => null);
      let recalled: PoolSwap[];
      try {
        recalled = await recalledSwaps(address, limit);
      } catch {
        // No database: the recent tail is all there is to show.
        return { swaps: await recentTradesFromLogs(address).catch(() => []), partial: true };
      }
      return { swaps: recalled, partial: !state?.caughtUp };
    },
    // A complete read holds for a while; a partial one is retried soon.
    (history) => (history.partial ? PARTIAL_TTL_MS : HISTORY_TTL_MS),
  );
}

/**
 * The last few ranges of one token's trades, straight from the logs.
 * Used only when there is no database to remember anything in.
 */
async function recentTradesFromLogs(token: Address): Promise<PoolSwap[]> {
  const launchpad = launchpadAddress();
  if (!launchpad) return [];
  const client = publicClient();
  const latest = await withRetry(() => client.getBlockNumber());
  const range = logRange();
  const quote = await quoteTokenOfPool(token, launchpad);
  if (!quote) return [];
  const swaps: PoolSwap[] = [];
  for (let i = 0n; i < 5n; i++) {
    const toBlock = latest - i * range;
    const fromBlock = toBlock - range + 1n;
    if (fromBlock < 0n) break;
    const logs = await client.getLogs({
      address: launchpad,
      event: junoLaunchpadAbi.find((item) => item.type === "event" && item.name === "Trade") as never,
      args: { token } as never,
      fromBlock,
      toBlock,
    });
    for (const log of logs as Log[]) {
      const swap = decodeTradeLog(log, quote.decimals);
      if (swap) swaps.push(swap);
    }
  }
  return mergeSwaps([], swaps);
}

/** Drop a token's cached history — call after a trade so the next read is live. */
export function invalidateSwapHistory(token: string): void {
  historyCache.invalidate(`${getAddress(token)}:`);
}

/** Convenience for callers that do not care whether the read was complete. */
export async function listPoolSwaps(token: string, limit = DEFAULT_LIMIT): Promise<PoolSwap[]> {
  return (await listSwapHistory(token, limit)).swaps;
}

/* ------------------------------------------------------------------ */
/* Derived series                                                      */
/* ------------------------------------------------------------------ */

/**
 * Traded quote volume inside a window, in quote units.
 *
 * Null rather than 0 when there is no history at all to measure against —
 * an empty read and a genuinely quiet day are different claims, and only one
 * of them is ours to make.
 */
export function volumeWithin(swaps: PoolSwap[], windowMs: number, now = Date.now()): number | null {
  if (swaps.length === 0) return null;
  let total = 0;
  for (const swap of swaps) {
    const at = Date.parse(swap.timestamp);
    if (Number.isFinite(at) && now - at <= windowMs) total += swap.quoteAmount;
  }
  return total;
}

/** Total traded quote volume across everything we can see. */
export function totalVolume(swaps: PoolSwap[]): number | null {
  if (swaps.length === 0) return null;
  return swaps.reduce((sum, swap) => sum + swap.quoteAmount, 0);
}

export type { PricePoint };

function chronological(a: PoolSwap, b: PoolSwap): number {
  return a.blockNumber - b.blockNumber || a.logIndex - b.logIndex;
}

/**
 * Realised price over time, oldest first — the series a chart draws.
 *
 * These are executed prices, not marks: each point is a trade that happened at
 * that price, which is why a flat stretch means nobody traded rather than a
 * price that held. Size rides along so the chart can aggregate the series into
 * candles with real volume rather than counting trades.
 */
export function priceSeries(swaps: PoolSwap[]): PricePoint[] {
  return [...swaps].sort(chronological).map((swap) => ({
    t: swap.timestamp,
    price: swap.price,
    volume: swap.quoteAmount,
    side: swap.side,
  }));
}

/**
 * Price change across a window, as a signed ratio.
 *
 * Null when there is no trade old enough to compare against — a market whose
 * entire history is inside the window has no "before" to measure from, and a
 * 0% change would be a claim about a period we cannot see.
 */
export function changeWithin(
  swaps: PoolSwap[],
  windowMs: number,
  currentPrice: number,
  now = Date.now(),
): number | null {
  if (swaps.length === 0 || currentPrice <= 0) return null;

  const ordered = [...swaps].sort(chronological);
  // The last trade at or before the window opened is the reference.
  let reference: number | null = null;
  for (const swap of ordered) {
    const at = Date.parse(swap.timestamp);
    if (Number.isFinite(at) && now - at > windowMs) reference = swap.price;
  }
  if (reference === null || reference <= 0) return null;

  return (currentPrice - reference) / reference;
}

export const DAY_MS = 24 * 60 * 60 * 1000;
