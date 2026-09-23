import "server-only";

import { and, count, desc, eq, inArray } from "drizzle-orm";
import { getAddress, isAddress } from "viem";

import { getDb } from "@/lib/db";
import { junoFollows, junoPlans, junoWatchlist } from "@/lib/db/schema";
import { networkKey } from "./network";
import { CallerError } from "./api";

/**
 * The social graph and the savings shelf.
 *
 * Juno had a feed but no relationships: nothing connected one wallet's
 * decisions to another's attention, which is why it read as a launchpad with
 * comments rather than a place to trade socially. Three tables change that —
 * who you follow, what you are watching, and what you have committed to buy
 * on a schedule — and every feature above them is a query against these.
 *
 * All of it is network-scoped. A testnet demo must not surface a mainnet
 * relationship, and the alternative (filtering at the call site) is the kind of
 * thing that works until one query forgets.
 */

/**
 * Addresses are validated and normalised here rather than at each route.
 *
 * A malformed address from a URL is a caller mistake, and reporting it as a
 * 500 would say the opposite. This turns it into a 400 with a sentence, at the
 * one place every caller passes through — and returns the checksummed form, so
 * a lowercase address and a checksummed one can never become two rows.
 */
export function assertAddress(value: string, field = "wallet"): string {
  if (typeof value !== "string" || !isAddress(value)) {
    throw new CallerError(`Not a Monad address: ${field}`);
  }
  return getAddress(value);
}

/* ------------------------------------------------------------------ */
/* Follows                                                             */
/* ------------------------------------------------------------------ */

/** Idempotent: following twice is the same as following once. */
export async function follow(follower: string, target: string): Promise<void> {
  follower = assertAddress(follower, "follower");
  target = assertAddress(target, "target");
  // Following yourself makes a follower count that flatters and a feed that
  // shows you your own trades. Refused rather than silently dropped, so the
  // client can say why.
  if (follower === target) throw new CallerError("A wallet cannot follow itself");

  await getDb()
    .insert(junoFollows)
    .values({ followerWallet: follower, targetWallet: target, network: networkKey() })
    .onConflictDoNothing();
}

export async function unfollow(follower: string, target: string): Promise<void> {
  follower = assertAddress(follower, "follower");
  target = assertAddress(target, "target");
  await getDb()
    .delete(junoFollows)
    .where(
      and(
        eq(junoFollows.followerWallet, follower),
        eq(junoFollows.targetWallet, target),
        eq(junoFollows.network, networkKey()),
      ),
    );
}

/** Wallets this one follows, newest first. */
export async function following(wallet: string): Promise<string[]> {
  wallet = assertAddress(wallet);
  const rows = await getDb()
    .select({ target: junoFollows.targetWallet })
    .from(junoFollows)
    .where(and(eq(junoFollows.followerWallet, wallet), eq(junoFollows.network, networkKey())))
    .orderBy(desc(junoFollows.createdAt));
  return rows.map((row) => row.target);
}

/**
 * Follower and following counts, plus whether `viewer` follows `wallet`.
 *
 * Counts are real reads, so a profile can show a number instead of the dash it
 * has been showing since these were `number | null` with nothing to fill them.
 */
export async function followStats(
  wallet: string,
  viewer?: string | null,
): Promise<{ followers: number; following: number; viewerFollows: boolean | null }> {
  wallet = assertAddress(wallet);
  const db = getDb();
  const network = networkKey();

  const [followers, follows] = await Promise.all([
    db
      .select({ n: count() })
      .from(junoFollows)
      .where(and(eq(junoFollows.targetWallet, wallet), eq(junoFollows.network, network))),
    db
      .select({ n: count() })
      .from(junoFollows)
      .where(and(eq(junoFollows.followerWallet, wallet), eq(junoFollows.network, network))),
  ]);

  // Null, not false, when there is no viewer: "you do not follow them" and
  // "nobody is signed in" are different answers and the button differs.
  let viewerFollows: boolean | null = null;
  if (viewer && isAddress(viewer)) {
    viewer = getAddress(viewer);
    const [hit] = await db
      .select({ n: count() })
      .from(junoFollows)
      .where(
        and(
          eq(junoFollows.followerWallet, viewer),
          eq(junoFollows.targetWallet, wallet),
          eq(junoFollows.network, network),
        ),
      );
    viewerFollows = (hit?.n ?? 0) > 0;
  }

  return {
    followers: followers[0]?.n ?? 0,
    following: follows[0]?.n ?? 0,
    viewerFollows,
  };
}

/** Follower counts for several wallets at once, for a leaderboard. */
export async function followerCounts(wallets: string[]): Promise<Map<string, number>> {
  if (wallets.length === 0) return new Map();
  const rows = await getDb()
    .select({ target: junoFollows.targetWallet, n: count() })
    .from(junoFollows)
    .where(and(eq(junoFollows.network, networkKey()), inArray(junoFollows.targetWallet, wallets)))
    .groupBy(junoFollows.targetWallet);
  return new Map(rows.map((row) => [row.target, row.n]));
}

/* ------------------------------------------------------------------ */
/* Watchlist                                                           */
/* ------------------------------------------------------------------ */

export type WatchRow = {
  token: string;
  alertPrice: number | null;
  /** The price when the alert was set — the crossing direction comes from this. */
  alertSetAtPrice: number | null;
  createdAt: string;
};

export async function watch(
  wallet: string,
  token: string,
  alert?: { price: number; priceNow: number } | null,
): Promise<void> {
  wallet = assertAddress(wallet);
  token = assertAddress(token, "token");
  if (alert && (!Number.isFinite(alert.price) || alert.price <= 0)) {
    throw new CallerError("An alert price must be greater than zero");
  }

  await getDb()
    .insert(junoWatchlist)
    .values({
      wallet,
      token,
      network: networkKey(),
      alertPrice: alert?.price ?? null,
      alertSetAtPrice: alert?.priceNow ?? null,
    })
    .onConflictDoUpdate({
      target: [junoWatchlist.wallet, junoWatchlist.token, junoWatchlist.network],
      set: {
        alertPrice: alert?.price ?? null,
        alertSetAtPrice: alert?.priceNow ?? null,
      },
    });
}

export async function unwatch(wallet: string, token: string): Promise<void> {
  wallet = assertAddress(wallet);
  token = assertAddress(token, "token");
  await getDb()
    .delete(junoWatchlist)
    .where(
      and(
        eq(junoWatchlist.wallet, wallet),
        eq(junoWatchlist.token, token),
        eq(junoWatchlist.network, networkKey()),
      ),
    );
}

export async function watchlist(wallet: string): Promise<WatchRow[]> {
  wallet = assertAddress(wallet);
  const rows = await getDb()
    .select()
    .from(junoWatchlist)
    .where(and(eq(junoWatchlist.wallet, wallet), eq(junoWatchlist.network, networkKey())))
    .orderBy(desc(junoWatchlist.createdAt));

  return rows.map((row) => ({
    token: row.token,
    alertPrice: row.alertPrice,
    alertSetAtPrice: row.alertSetAtPrice,
    createdAt: row.createdAt.toISOString(),
  }));
}

/**
 * Which watched coins have crossed their alert.
 *
 * The direction is derived rather than stored: an alert set above the price at
 * the time is an upward one, below it a downward one. Storing a direction as
 * well would let the two disagree after an edit.
 */
export function crossed(row: WatchRow, priceNow: number): "up" | "down" | null {
  if (row.alertPrice === null || row.alertSetAtPrice === null) return null;
  if (!Number.isFinite(priceNow)) return null;
  const wantsUp = row.alertPrice > row.alertSetAtPrice;
  if (wantsUp && priceNow >= row.alertPrice) return "up";
  if (!wantsUp && priceNow <= row.alertPrice) return "down";
  return null;
}

/* ------------------------------------------------------------------ */
/* Recurring buys                                                      */
/* ------------------------------------------------------------------ */

export type PlanRow = {
  id: string;
  token: string;
  amount: number;
  cadence: "daily" | "weekly" | "monthly";
  target: number | null;
  contributed: number;
  fills: number;
  lastFilledAt: string | null;
  nextDueAt: string;
  due: boolean;
  active: boolean;
  createdAt: string;
};

const CADENCE_MS = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
} as const;

export async function createPlan(input: {
  wallet: string;
  token: string;
  amount: number;
  cadence: "daily" | "weekly" | "monthly";
  target?: number | null;
}): Promise<string> {
  const wallet = assertAddress(input.wallet);
  const token = assertAddress(input.token, "token");
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new CallerError("A plan needs an amount greater than zero");
  }
  if (input.target !== undefined && input.target !== null) {
    if (!Number.isFinite(input.target) || input.target <= 0) {
      throw new CallerError("A target must be greater than zero");
    }
    // A target below one contribution completes on the first buy, which makes
    // the progress bar meaningless. Caught here rather than rendering 100%.
    if (input.target < input.amount) {
      throw new CallerError("A target must be at least one contribution");
    }
  }

  const id = crypto.randomUUID().replace(/-/g, "");
  await getDb().insert(junoPlans).values({
    id,
    wallet,
    token,
    network: networkKey(),
    amount: input.amount,
    cadence: input.cadence,
    target: input.target ?? null,
  });
  return id;
}

export async function plans(wallet: string): Promise<PlanRow[]> {
  wallet = assertAddress(wallet);
  const rows = await getDb()
    .select()
    .from(junoPlans)
    .where(and(eq(junoPlans.wallet, wallet), eq(junoPlans.network, networkKey())))
    .orderBy(desc(junoPlans.createdAt));

  const now = Date.now();
  return rows.map((row) => {
    // A plan that has never filled is due immediately — the point of creating
    // one is to start, not to wait a day first.
    const since = row.lastFilledAt?.getTime() ?? null;
    const nextDue = since === null ? now : since + CADENCE_MS[row.cadence];
    return {
      id: row.id,
      token: row.token,
      amount: row.amount,
      cadence: row.cadence,
      target: row.target,
      contributed: row.contributed,
      fills: row.fills,
      lastFilledAt: row.lastFilledAt?.toISOString() ?? null,
      nextDueAt: new Date(nextDue).toISOString(),
      due: row.active && nextDue <= now,
      active: row.active,
      createdAt: row.createdAt.toISOString(),
    };
  });
}

export async function setPlanActive(id: string, active: boolean): Promise<void> {
  await getDb().update(junoPlans).set({ active }).where(eq(junoPlans.id, id));
}

export async function deletePlan(id: string): Promise<void> {
  await getDb().delete(junoPlans).where(eq(junoPlans.id, id));
}

/**
 * Record a contribution that actually landed.
 *
 * Called only after a swap confirms, never when one is built or sent, so the
 * progress bar is a record of transactions rather than of intentions. That
 * distinction is the whole reason this is honest: a plan cannot inflate itself
 * by being looked at.
 */
export async function recordContribution(id: string, amount: number): Promise<PlanRow | null> {
  const db = getDb();
  const [row] = await db.select().from(junoPlans).where(eq(junoPlans.id, id)).limit(1);
  if (!row) return null;

  await db
    .update(junoPlans)
    .set({
      contributed: row.contributed + amount,
      fills: row.fills + 1,
      lastFilledAt: new Date(),
    })
    .where(eq(junoPlans.id, id));

  const [fresh] = await plans(row.wallet).then((all) => all.filter((p) => p.id === id));
  return fresh ?? null;
}
