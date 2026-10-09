import "server-only";

import { and, count, countDistinct, eq, gte } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { junoPools, junoSwaps } from "@/lib/db/schema";
import { publicClient } from "./client";
import { recallContent } from "./ipfs-cache";
import { stillCids } from "./media-warm";
import { listPools } from "./registry";
import { localFork, networkKey } from "./network";
import { recentConfirmations, type ConfirmationSummary } from "./speed-log";

/**
 * What the landing page says is happening, read when it asks.
 *
 * - `coins`: listed markets on this network, from the registry;
 * - `trades24h` / `traders24h`: trades recorded in the last day, and how many
 *   wallets made them: every trade on the curves and Uniswap pairs, and the
 *   Kuru fills of the transactions Juno submitted (`recordReceiptKuruFills`);
 * - `block`: the chain's latest block, number and time, from the RPC;
 * - `confirmation`: the confirmation times this server measured, or null
 *   when it has submitted nothing since it started;
 * - `pictures`: how many of the feed's pictures this server already holds
 *   in memory, of how many there are (the warm-up's progress).
 *
 * A part whose read fails is null, and the page leaves that figure out.
 */
export type JunoStats = {
  network: string;
  localFork: boolean;
  coins: number | null;
  trades24h: number | null;
  traders24h: number | null;
  block: { number: number; timestamp: number } | null;
  confirmation: ConfirmationSummary;
  pictures: { held: number; total: number } | null;
  at: string;
};

const DAY_MS = 24 * 60 * 60_000;

export async function loadStats(now = Date.now()): Promise<JunoStats> {
  const db = getDb();
  const network = networkKey();
  const since = new Date(now - DAY_MS);
  const [coins, trades, block, rows] = await Promise.all([
    db
      .select({ n: count() })
      .from(junoPools)
      .where(and(eq(junoPools.network, network), eq(junoPools.listed, true)))
      .then((rows) => rows[0]?.n ?? 0)
      .catch(() => null),
    db
      .select({ n: count(), traders: countDistinct(junoSwaps.trader) })
      .from(junoSwaps)
      .where(and(eq(junoSwaps.network, network), gte(junoSwaps.blockTime, since)))
      .then((rows) => rows[0] ?? { n: 0, traders: 0 })
      .catch(() => null),
    publicClient()
      .getBlock()
      .then((b) => ({ number: Number(b.number), timestamp: Number(b.timestamp) }))
      .catch(() => null),
    listPools(60, { listedOnly: true }).catch(() => null),
  ]);
  const cids = rows ? stillCids(rows) : null;
  return {
    network,
    localFork: localFork(),
    coins,
    trades24h: trades?.n ?? null,
    traders24h: trades?.traders ?? null,
    block,
    confirmation: recentConfirmations(),
    pictures: cids ? { held: cids.filter((cid) => recallContent(cid)).length, total: cids.length } : null,
    at: new Date(now).toISOString(),
  };
}
