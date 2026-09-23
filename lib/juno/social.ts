import "server-only";

import { MongoClient, type Collection, type Db } from "mongodb";

/**
 * Social state: comments and likes.
 *
 * Deliberately not Postgres. The pool registry is relational and small; this
 * is append-heavy, per-coin, and schema-loose — and keeping it separate means
 * a comment outage can never take the market data down with it.
 *
 * Nothing here is authoritative about money. Trades live on-chain.
 */

declare global {
  // eslint-disable-next-line no-var
  var __junoMongo: MongoClient | undefined;
}

function client(): MongoClient {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is not set");
  // Reused across hot reloads; a new client per request exhausts the pool.
  globalThis.__junoMongo ??= new MongoClient(process.env.MONGODB_URI, {
    maxPoolSize: 5,
  });
  return globalThis.__junoMongo;
}

export async function db(): Promise<Db> {
  const c = client();
  await c.connect();
  return c.db(process.env.MONGODB_DB || "juno");
}

export type JunoComment = {
  id: string;
  token: string;
  wallet: string;
  body: string;
  /** Set when the comment was attached to a trade. */
  side?: "buy" | "sell";
  /** The trade's transaction hash, so the comment is verifiable. */
  txHash?: string;
  createdAt: string;
};

type CommentDoc = Omit<JunoComment, "id" | "createdAt"> & {
  network: string;
  createdAt: Date;
};

async function comments(): Promise<Collection<CommentDoc>> {
  const collection = (await db()).collection<CommentDoc>("comments");
  // Idempotent; Mongo ignores a create for an index that already exists.
  await collection
    .createIndex({ token: 1, network: 1, createdAt: -1 })
    .catch(() => undefined);
  return collection;
}

export const MAX_COMMENT = 280;

export async function listComments(
  token: string,
  network: string,
  limit = 50,
): Promise<JunoComment[]> {
  const docs = await (await comments())
    .find({ token, network })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();

  return docs.map((doc) => ({
    id: doc._id.toString(),
    token: doc.token,
    wallet: doc.wallet,
    body: doc.body,
    side: doc.side,
    txHash: doc.txHash,
    createdAt: doc.createdAt.toISOString(),
  }));
}

/**
 * Notes attached to specific trades, keyed by transaction hash.
 *
 * The feed shows trades read from the chain; a note is something the trader
 * chose to say about one. Joining them here rather than in the feed's walk
 * keeps it one query for the whole page instead of one per row, and keeps the
 * chain read independent of whether Mongo is up — a comments outage costs the
 * notes, not the feed.
 *
 * Signatures are unique, so the last write for one wins; in practice a trade
 * gets at most one note because only the sheet that signed it can attach one.
 */
export async function notesForTxs(
  txHashes: string[],
  network: string,
): Promise<Map<string, JunoComment>> {
  if (txHashes.length === 0) return new Map();
  const docs = await (await comments())
    .find({ network, txHash: { $in: txHashes } })
    .sort({ createdAt: 1 })
    .toArray();

  return new Map(
    docs.map((doc) => [
      doc.txHash!,
      {
        id: doc._id.toString(),
        token: doc.token,
        wallet: doc.wallet,
        body: doc.body,
        side: doc.side,
        txHash: doc.txHash,
        createdAt: doc.createdAt.toISOString(),
      },
    ]),
  );
}

export async function addComment(input: {
  token: string;
  network: string;
  wallet: string;
  body: string;
  side?: "buy" | "sell";
  txHash?: string;
}): Promise<JunoComment> {
  const body = input.body.trim().slice(0, MAX_COMMENT);
  if (!body) throw new Error("Comment is empty");

  const doc: CommentDoc = {
    token: input.token,
    network: input.network,
    wallet: input.wallet,
    body,
    side: input.side,
    txHash: input.txHash,
    createdAt: new Date(),
  };

  const result = await (await comments()).insertOne(doc);
  return {
    id: result.insertedId.toString(),
    token: doc.token,
    wallet: doc.wallet,
    body: doc.body,
    side: doc.side,
    txHash: doc.txHash,
    createdAt: doc.createdAt.toISOString(),
  };
}

export async function countComments(token: string, network: string): Promise<number> {
  return (await comments()).countDocuments({ token, network });
}

/* ------------------------------------------------------------------ */
/* Likes                                                               */
/* ------------------------------------------------------------------ */

/**
 * One wallet liking one coin.
 *
 * Keyed on the triple, uniquely, so a like is a fact rather than a counter: a
 * double tap that fires twice, or two devices on one key, cannot inflate the
 * count. The count is always `countDocuments`, never an incremented field that
 * could drift from the rows it claims to summarise.
 */
type LikeDoc = { token: string; network: string; wallet: string; createdAt: Date };

async function likes(): Promise<Collection<LikeDoc>> {
  const collection = (await db()).collection<LikeDoc>("likes");
  await collection
    .createIndex({ token: 1, network: 1, wallet: 1 }, { unique: true })
    .catch(() => undefined);
  return collection;
}

/** Like or unlike. Idempotent both ways. Returns the count after the write. */
export async function setLike(input: {
  token: string;
  network: string;
  wallet: string;
  like: boolean;
}): Promise<{ likes: number; liked: boolean }> {
  const collection = await likes();
  const key = { token: input.token, network: input.network, wallet: input.wallet };
  if (input.like) {
    await collection.updateOne(key, { $setOnInsert: { ...key, createdAt: new Date() } }, { upsert: true });
  } else {
    await collection.deleteOne(key);
  }
  return {
    likes: await collection.countDocuments({ token: input.token, network: input.network }),
    liked: input.like,
  };
}

export type SocialCounts = { likes: number; comments: number; viewerLiked: boolean | null };

/**
 * Likes and comments for many coins in two aggregate reads.
 *
 * A reel rail and a feed card both show these, for a whole page of coins at
 * once. Per-coin `countDocuments` would be 2N round trips to answer one
 * screen; grouping is two regardless of N.
 *
 * `viewerLiked` is null without a viewer — "did not like" and "nobody asked
 * who is looking" are different answers.
 */
export async function socialCounts(
  tokens: string[],
  network: string,
  viewer?: string | null,
): Promise<Map<string, SocialCounts>> {
  const out = new Map<string, SocialCounts>();
  for (const token of tokens) out.set(token, { likes: 0, comments: 0, viewerLiked: viewer ? false : null });
  if (tokens.length === 0) return out;

  const match = { token: { $in: tokens }, network };
  const [likeRows, commentRows, mine] = await Promise.all([
    (await likes())
      .aggregate<{ _id: string; n: number }>([{ $match: match }, { $group: { _id: "$token", n: { $sum: 1 } } }])
      .toArray(),
    (await comments())
      .aggregate<{ _id: string; n: number }>([{ $match: match }, { $group: { _id: "$token", n: { $sum: 1 } } }])
      .toArray(),
    viewer
      ? (await likes()).find({ ...match, wallet: viewer }, { projection: { token: 1 } }).toArray()
      : Promise.resolve([] as Array<{ token: string }>),
  ]);

  for (const row of likeRows) out.get(row._id)!.likes = row.n;
  for (const row of commentRows) out.get(row._id)!.comments = row.n;
  for (const row of mine) out.get(row.token)!.viewerLiked = true;
  return out;
}
