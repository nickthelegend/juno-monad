import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { getAddress, isAddress } from "viem";

import { getDb } from "@/lib/db";
import { junoPools } from "@/lib/db/schema";
import { networkKey } from "./network";
import type { CoinFormat, CurvePresetId } from "./types";

/**
 * The index of pools Juno launched.
 *
 * Identity and provenance only. Every number that moves — price, reserves,
 * curve progress, graduation — is read from the launchpad at request time,
 * because a cached copy of a live market is a cache that is always wrong.
 */

export type JunoPoolRow = typeof junoPools.$inferSelect;

export type LaunchRecord = {
  token: string;
  launchpad: string;
  /** The AMM pair, from the `Launched` event. Null when no graduator was set. */
  pair: string | null;
  quoteToken: string;
  creatorWallet: string;
  name: string;
  symbol: string;
  description?: string | null;
  format: CoinFormat;
  curvePreset: CurvePresetId;
  mediaUrl?: string | null;
  posterUrl?: string | null;
  /** Decides image or video everywhere downstream — see `mediaKind`. */
  mediaMime?: string | null;
  mediaWidth?: number | null;
  mediaHeight?: number | null;
  navFeedId?: string | null;
  /** Units of the reference one token stands for — see the schema comment. */
  navUnitsPerToken?: number | null;
  createTx: string;
  createBlock?: number | null;
};

export async function recordLaunch(row: LaunchRecord): Promise<JunoPoolRow> {
  const db = getDb();
  const [inserted] = await db
    .insert(junoPools)
    .values({ ...row, network: networkKey() })
    // A retried request re-sends the same token. The chain has already
    // accepted the launch by then, so keep the first row rather than failing.
    .onConflictDoNothing({ target: junoPools.token })
    .returning();

  if (inserted) return inserted;
  const existing = await getPool(row.token);
  if (!existing) throw new Error(`Failed to record pool ${row.token}`);
  return existing;
}

/**
 * Newest first, scoped to the current network.
 *
 * `listedOnly` is for what visitors browse. Everything that follows a coin a
 * person already holds or planned — portfolio, plans, the indexer — reads
 * unlisted coins too, because unlisting hides a coin; it does not unmake it.
 */
export async function listPools(
  limit = 60,
  options: { listedOnly?: boolean } = {},
): Promise<JunoPoolRow[]> {
  return getDb()
    .select()
    .from(junoPools)
    .where(
      options.listedOnly
        ? and(eq(junoPools.network, networkKey()), eq(junoPools.listed, true))
        : eq(junoPools.network, networkKey()),
    )
    .orderBy(desc(junoPools.createdAt))
    .limit(limit);
}

export async function listPoolsByCreator(wallet: string): Promise<JunoPoolRow[]> {
  return getDb()
    .select()
    .from(junoPools)
    .where(and(eq(junoPools.network, networkKey()), eq(junoPools.creatorWallet, wallet)))
    .orderBy(desc(junoPools.createdAt));
}

/** The registry row for a token, whatever case the address arrived in. */
export async function getPool(token: string): Promise<JunoPoolRow | null> {
  if (!isAddress(token)) return null;
  const [row] = await getDb()
    .select()
    .from(junoPools)
    .where(and(eq(junoPools.token, getAddress(token)), eq(junoPools.network, networkKey())))
    .limit(1);
  return row ?? null;
}
