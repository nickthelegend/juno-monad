import "server-only";

import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { zeroAddress } from "viem";

import { getDb } from "@/lib/db";
import { junoFollows, junoSwaps } from "@/lib/db/schema";
import { hydratePools } from "./chain";
import { buildInbox, INBOX_LIMIT, type Inbox, type InboxItem } from "./inbox";
import { networkKey } from "./network";
import { getPool, listPoolsByCreator, type JunoPoolRow } from "./registry";
import { db } from "./social";
import { assertAddress, crossed, plans, watchlist } from "./social-graph";

type ReadDoc = { network: string; wallet: string; seenAt: Date };
type AlertHitDoc = { network: string; wallet: string; token: string; alertPrice: number; seenAt: Date };

async function reads() {
  const collection = (await db()).collection<ReadDoc>("inbox_reads");
  await collection.createIndex({ network: 1, wallet: 1 }, { unique: true }).catch(() => undefined);
  return collection;
}

async function alertHits() {
  const collection = (await db()).collection<AlertHitDoc>("inbox_alert_hits");
  await collection.createIndex({ network: 1, wallet: 1, token: 1, alertPrice: 1 }, { unique: true }).catch(() => undefined);
  return collection;
}

/** A source that fails leaves its items out; the inbox still opens. */
async function safely(read: () => Promise<InboxItem[]>): Promise<InboxItem[]> {
  return read().catch(() => []);
}

function quoteSymbol(row: JunoPoolRow): string {
  return row.quoteToken.toLowerCase() === zeroAddress ? "MON" : "USDC";
}

export async function loadInbox(walletInput: string): Promise<Inbox> {
  const wallet = assertAddress(walletInput);
  const network = networkKey();
  const mine = await listPoolsByCreator(wallet).catch(() => [] as JunoPoolRow[]);
  const byToken = new Map(mine.map((row) => [row.token, row]));
  const tokens = [...byToken.keys()];

  const trades = safely(async () => {
    if (tokens.length === 0) return [];
    const rows = await getDb()
      .select()
      .from(junoSwaps)
      .where(and(eq(junoSwaps.network, network), inArray(junoSwaps.token, tokens), ne(junoSwaps.trader, wallet)))
      .orderBy(desc(junoSwaps.blockTime))
      .limit(INBOX_LIMIT);
    return rows.map((row) => ({
      id: `trade:${row.id}`,
      kind: "trade" as const,
      at: row.blockTime.toISOString(),
      actor: row.trader,
      token: row.token,
      symbol: byToken.get(row.token)?.symbol ?? "",
      side: row.side === "sell" ? ("sell" as const) : ("buy" as const),
      base: row.baseAmount,
      quote: row.quoteAmount,
      quoteSymbol: byToken.has(row.token) ? quoteSymbol(byToken.get(row.token)!) : "MON",
      txHash: row.txHash,
    }));
  });

  const follows = safely(async () => {
    const rows = await getDb()
      .select()
      .from(junoFollows)
      .where(and(eq(junoFollows.network, network), eq(junoFollows.targetWallet, wallet)))
      .orderBy(desc(junoFollows.createdAt))
      .limit(INBOX_LIMIT);
    return rows.map((row) => ({
      id: `follow:${row.followerWallet}`,
      kind: "follow" as const,
      at: row.createdAt.toISOString(),
      actor: row.followerWallet,
    }));
  });

  const comments = safely(async () => {
    if (tokens.length === 0) return [];
    const rows = await (await db())
      .collection("comments")
      .find({ network, token: { $in: tokens }, wallet: { $ne: wallet } })
      .sort({ createdAt: -1 })
      .limit(INBOX_LIMIT)
      .toArray();
    return rows.map((row) => ({
      id: `comment:${String(row._id)}`,
      kind: "comment" as const,
      at: new Date(row.createdAt).toISOString(),
      actor: String(row.wallet),
      token: String(row.token),
      symbol: byToken.get(String(row.token))?.symbol ?? "",
      body: String(row.body).slice(0, 140),
    }));
  });

  const likes = safely(async () => {
    if (tokens.length === 0) return [];
    const rows = await (await db())
      .collection("likes")
      .find({ network, token: { $in: tokens }, wallet: { $ne: wallet } })
      .sort({ createdAt: -1 })
      .limit(INBOX_LIMIT)
      .toArray();
    return rows.map((row) => ({
      id: `like:${String(row.token)}:${String(row.wallet)}`,
      kind: "like" as const,
      at: new Date(row.createdAt).toISOString(),
      actor: String(row.wallet),
      token: String(row.token),
      symbol: byToken.get(String(row.token))?.symbol ?? "",
    }));
  });

  // Watched coins with an alert: priced now, and an alert that has crossed
  // keeps the time Juno first saw it cross, so it does not move each read.
  const alerts = safely(async () => {
    const rows = (await watchlist(wallet)).filter((row) => row.alertPrice !== null);
    if (rows.length === 0) return [];
    const pools = (await Promise.all(rows.map((row) => getPool(row.token)))).filter((row): row is JunoPoolRow => row !== null);
    const { coins } = await hydratePools(pools, 2);
    const priced = new Map(coins.map((coin) => [coin.address, coin]));
    const hits = await alertHits();
    const out: InboxItem[] = [];
    for (const row of rows) {
      const coin = priced.get(row.token);
      if (!coin) continue;
      const direction = crossed(row, coin.priceUsd);
      if (!direction) continue;
      const key = { network, wallet, token: row.token, alertPrice: row.alertPrice! };
      await hits.updateOne(key, { $setOnInsert: { ...key, seenAt: new Date() } }, { upsert: true });
      const hit = await hits.findOne(key);
      out.push({
        id: `alert:${row.token}:${row.alertPrice}`,
        kind: "alert",
        at: (hit?.seenAt ?? new Date()).toISOString(),
        token: row.token,
        symbol: coin.symbol,
        direction,
        alertPrice: row.alertPrice!,
        priceNow: coin.priceUsd,
      });
    }
    return out;
  });

  // A plan that has fallen due. One that never filled is due from when it
  // was made, not from "now", or it would be new on every read.
  const due = safely(async () => {
    const rows = (await plans(wallet)).filter((plan) => plan.due);
    if (rows.length === 0) return [];
    const pools = await Promise.all(rows.map((plan) => getPool(plan.token)));
    return rows.map((plan, index) => ({
      id: `plan:${plan.id}:${plan.lastFilledAt ?? plan.createdAt}`,
      kind: "plan" as const,
      at: plan.lastFilledAt ? plan.nextDueAt : plan.createdAt,
      token: plan.token,
      symbol: pools[index]?.symbol ?? "",
      amount: plan.amount,
      cadence: plan.cadence,
    }));
  });

  const [seen, ...sources] = await Promise.all([
    reads()
      .then((collection) => collection.findOne({ network, wallet }))
      .catch(() => null),
    trades,
    follows,
    comments,
    likes,
    alerts,
    due,
  ]);
  return buildInbox({ wallet, sources, seenAt: seen?.seenAt.toISOString() ?? null });
}

/** Opening the inbox reads everything in it. */
export async function markInboxSeen(walletInput: string, now = new Date()): Promise<{ seenAt: string }> {
  const wallet = assertAddress(walletInput);
  await (await reads()).updateOne({ network: networkKey(), wallet }, { $set: { seenAt: now } }, { upsert: true });
  return { seenAt: now.toISOString() };
}
