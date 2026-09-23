import "server-only";

import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, inArray, isNull, lt } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { junoPosts } from "@/lib/db/schema";
import { networkKey } from "./network";
import { assertAddress } from "./social-graph";
import { CallerError } from "./api";

/**
 * Creator posts — the half of the social feed that is not a trade.
 *
 * Juno's feed mixes two kinds of item, and they have opposite storage needs.
 * Trades are facts about the chain: never stored, always re-read, verifiable by
 * anyone. A post is something a person wrote, which has nowhere else to live.
 *
 * A post may reference a coin or stand alone, so a creator can talk about a
 * launch without every message having to be one.
 */

export type JunoPostRow = typeof junoPosts.$inferSelect;

export type NewPost = {
  authorWallet: string;
  body: string;
  /** Optional: the coin this post is about. */
  token?: string | null;
  mediaUrl?: string | null;
  mediaMime?: string | null;
  /** Set to reply to another post. A comment is a post with a parent. */
  parentId?: string | null;
};

/** Long enough for a thought, short enough to read in a feed. */
export const MAX_POST_LENGTH = 500;

export async function createPost(input: NewPost): Promise<JunoPostRow> {
  const body = input.body.trim();
  if (body.length === 0) throw new CallerError("A post needs a body");
  if (body.length > MAX_POST_LENGTH) {
    throw new CallerError(`A post must be ${MAX_POST_LENGTH} characters or fewer`);
  }

  const [row] = await getDb()
    .insert(junoPosts)
    .values({
      // Trimmed to the column width; still 128 bits of entropy.
      id: randomUUID().replace(/-/g, "").slice(0, 32),
      authorWallet: assertAddress(input.authorWallet, "author"),
      network: networkKey(),
      body,
      token: input.token ? assertAddress(input.token, "token") : null,
      mediaUrl: input.mediaUrl ?? null,
      mediaMime: input.mediaMime ?? null,
      parentId: input.parentId ?? null,
    })
    .returning();

  return row;
}

/**
 * Newest first, scoped to the current network.
 *
 * Paginated by timestamp rather than offset: the feed has things inserted at
 * its head continuously, and an offset walks backwards through a list that is
 * shifting underneath it, showing the same post twice and skipping another.
 */
export async function listPosts(options: {
  limit?: number;
  before?: Date;
  authorWallet?: string;
  token?: string;
  /** Replies to one post. Omit for the feed, which shows top-level only. */
  parentId?: string;
} = {}): Promise<JunoPostRow[]> {
  const filters = [eq(junoPosts.network, networkKey())];
  // The feed is top-level posts; a reply belongs under its parent, not in it.
  filters.push(
    options.parentId ? eq(junoPosts.parentId, options.parentId) : isNull(junoPosts.parentId),
  );
  if (options.before) filters.push(lt(junoPosts.createdAt, options.before));
  if (options.authorWallet) filters.push(eq(junoPosts.authorWallet, options.authorWallet));
  if (options.token) filters.push(eq(junoPosts.token, options.token));

  return getDb()
    .select()
    .from(junoPosts)
    .where(and(...filters))
    // Replies read oldest-first, like a conversation; the feed newest-first.
    .orderBy(options.parentId ? asc(junoPosts.createdAt) : desc(junoPosts.createdAt))
    .limit(Math.min(options.limit ?? 30, 100));
}

/** How many replies each of these posts has. */
export async function replyCounts(ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = await getDb()
    .select({ parentId: junoPosts.parentId, count: count() })
    .from(junoPosts)
    .where(and(eq(junoPosts.network, networkKey()), inArray(junoPosts.parentId, ids)))
    .groupBy(junoPosts.parentId);
  return new Map(rows.map((row) => [row.parentId ?? "", Number(row.count)]));
}

export async function getPost(id: string): Promise<JunoPostRow | null> {
  const [row] = await getDb().select().from(junoPosts).where(eq(junoPosts.id, id)).limit(1);
  return row ?? null;
}
