import { globalActivity, hydratePool } from "@/lib/juno/chain";
import { mediaKind, mediaSrc } from "@/lib/juno/media";
import { identicon } from "@/lib/juno/identicon";
import { shortAddress } from "@/lib/juno/format";
import { listPosts, replyCounts } from "@/lib/juno/posts";
import { notesForTxs } from "@/lib/juno/social";
import { listPools } from "@/lib/juno/registry";
import { junoError, junoJson, junoOptions, junoRead } from "@/lib/juno/api";
import { following } from "@/lib/juno/social-graph";
import { networkKey } from "@/lib/juno/network";

export const dynamic = "force-dynamic";
export const OPTIONS = junoOptions;

/**
 * How many pools the trade half of the feed walks.
 *
 * Each pool's history is a database read once the launchpad's log tail has
 * recorded it, but the read still nudges that tail forward against a
 * rate-limited endpoint. Eight fills a screen from the pools most likely to
 * have traded recently; most pools have never traded at all, so walking the
 * whole registry finds nothing extra.
 */
const POOLS_SCANNED = 8;

type FeedItem =
  | {
      kind: "trade";
      id: string;
      timestamp: string;
      side: "buy" | "sell";
      amount: number;
      valueUsd: number;
      /** What one token cost in this trade — value over size. */
      price: number;
      /** The coin's live price now, so a card can show the move since. */
      priceNow: number | null;
      currency: string;
      /** The transaction that made the trade. */
      txHash?: string;
      /**
       * What the trader said about this fill, if anything.
       *
       * Attached at the moment of signing and stored against the hash, so
       * the feed can show the claim beside the transaction that backs it. A
       * trade with no note is just a trade; this is what makes announcing one
       * a thing you can choose to do.
       */
      note: string | null;
      actor: { wallet: string; handle: string; avatarUrl: string };
      coin: {
        address: string;
        name: string;
        symbol: string;
        mediaUrl: string | null;
        mediaKind: string;
        posterUrl: string | null;
      };
    }
  | {
      kind: "post";
      id: string;
      timestamp: string;
      body: string;
      author: { wallet: string; handle: string; avatarUrl: string };
      mediaUrl: string | null;
      mediaKind: string | null;
      replyCount: number;
      /**
       * The market this post is about, priced.
       *
       * The whole premise is that a post *is* a market, and a post card that
       * names one without pricing it is a link, not a market. Price is null
       * when the pool could not be read — never zero, which would read as
       * worthless rather than unknown.
       */
      coin: {
        address: string;
        name: string;
        symbol: string;
        priceUsd: number | null;
        currency: string;
        changePct: number | null;
        progress: number | null;
        graduated: boolean;
        /**
         * How many wallets hold it. Null when the holder read was refused,
         * which the public endpoint does often — and "held by 0" would be a
         * different and false claim about a coin with holders.
         */
        holders: number | null;
      } | null;
    };

/**
 * The social feed: real trades and creator posts, newest first.
 *
 * The two halves have opposite natures and are merged rather than unified.
 * A trade is a fact about the chain — a launchpad `Trade` event, verifiable
 * by anyone with the transaction hash. A post is something a person wrote and
 * lives in Postgres. Interleaving them by timestamp is the only thing they
 * share.
 */
export async function GET(request: Request) {
  return junoRead(async () => {
    const url = new URL(request.url);
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 40) || 40, 80);

    /*
     * `?following=<wallet>` narrows the feed to wallets that one follows.
     *
     * Filtered here rather than on the client for one reason that matters:
     * the client would have to ask for enough rows to be sure the filter had
     * something to work with, and "enough" is unknowable — a wallet following
     * three people might need the whole network walked to find one of their
     * trades. The walk is the same either way; only what comes back differs.
     *
     * A wallet that follows nobody gets an empty feed and a flag saying so,
     * which is a different screen from "nobody has traded".
     */
    const viewer = url.searchParams.get("following");
    let allowed: Set<string> | null = null;
    if (viewer !== null) {
      if (!viewer) return junoError("`following` needs a wallet");
      const list = await following(viewer);
      allowed = new Set(list);
    }

    const pools = await listPools(POOLS_SCANNED);
    const byToken = new Map(pools.map((row) => [row.token, row]));

    const [feed, posts] = await Promise.all([
      globalActivity(pools, 8, 2, limit),
      listPosts({ limit }),
    ]);
    const trades = feed.items;

    /*
     * One hydration per coin that appears, not per row.
     *
     * A feed shows the same coin several times and each hydration is a pool
     * read. Posts are in this set as well as trades: a post card prices the
     * market it argues for, and the alternative — naming it and leaving the
     * price off — is the version this feed shipped with.
     */
    const mentioned = [
      ...new Set([
        ...trades.map((trade) => trade.coinAddress),
        ...posts.map((post) => post.token).filter((token): token is string => !!token),
      ]),
    ];
    const live = new Map<
      string,
      {
        price: number;
        currency: string;
        changePct: number | null;
        progress: number;
        graduated: boolean;
        holders: number | null;
      }
    >();
    for (const token of mentioned) {
      const row = byToken.get(token);
      if (!row) continue;
      const coin = await hydratePool(row).catch(() => null);
      if (coin) {
        live.set(token, {
          price: coin.priceUsd,
          currency: coin.marketCapCurrency,
          changePct: coin.marketCapChangePct,
          progress: coin.curve.progress,
          graduated: coin.curve.graduated,
          holders: coin.holders,
        });
      }
    }

    /* One query for every note on this page, rather than one per row. A
       comments outage costs the notes and leaves the fills — they come from
       completely different places and only one of them is the chain. */
    const notes = await notesForTxs(
      trades.map((trade) => trade.txHash).filter((hash): hash is string => typeof hash === "string"),
      networkKey(),
    ).catch(() => new Map<string, { body: string }>());

    const items: FeedItem[] = [];

    for (const trade of trades) {
      if (allowed && !allowed.has(trade.wallet)) continue;
      const row = byToken.get(trade.coinAddress);
      items.push({
        kind: "trade",
        id: trade.id,
        timestamp: trade.timestamp,
        side: trade.side,
        amount: trade.amount,
        valueUsd: trade.valueUsd,
        // Derived, never assumed: a zero-size row has no price to report.
        price: trade.amount > 0 ? trade.valueUsd / trade.amount : 0,
        priceNow: live.get(trade.coinAddress)?.price ?? null,
        currency: live.get(trade.coinAddress)?.currency ?? "USD",
        txHash: trade.txHash,
        note: (trade.txHash ? notes.get(trade.txHash)?.body : null) ?? null,
        actor: { wallet: trade.wallet, ...trade.actor },
        coin: {
          address: trade.coinAddress,
          name: trade.coinName,
          symbol: row?.symbol ?? "",
          mediaUrl: mediaSrc(row?.mediaUrl) ?? null,
          mediaKind: mediaKind(row?.mediaMime),
          // A reel's `mediaUrl` is a video; a feed row wants a frame from it.
          // Without this the mobile feed drew a grey square beside every trade
          // on a reel coin, because `<Image>` had been handed an mp4.
          posterUrl: mediaSrc(row?.posterUrl) ?? null,
        },
      });
    }

    const counts = await replyCounts(posts.map((post) => post.id)).catch(
      () => new Map<string, number>(),
    );

    for (const post of posts) {
      if (allowed && !allowed.has(post.authorWallet)) continue;
      const row = post.token ? byToken.get(post.token) : undefined;
      items.push({
        kind: "post",
        id: post.id,
        timestamp: post.createdAt.toISOString(),
        body: post.body,
        author: {
          wallet: post.authorWallet,
          handle: shortAddress(post.authorWallet, 4, 4),
          avatarUrl: identicon(post.authorWallet),
        },
        mediaUrl: mediaSrc(post.mediaUrl) ?? null,
        mediaKind: post.mediaMime ? mediaKind(post.mediaMime) : null,
        replyCount: counts.get(post.id) ?? 0,
        coin: row
          ? {
              address: row.token,
              name: row.name,
              symbol: row.symbol,
              priceUsd: live.get(row.token)?.price ?? null,
              currency: live.get(row.token)?.currency ?? "USD",
              changePct: live.get(row.token)?.changePct ?? null,
              progress: live.get(row.token)?.progress ?? null,
              graduated: live.get(row.token)?.graduated ?? false,
              holders: live.get(row.token)?.holders ?? null,
            }
          : null,
      });
    }

    items.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));

    return junoJson({
      network: networkKey(),
      items: items.slice(0, limit),
      /*
       * Whether this is the following-only feed, and how many wallets it
       * covers. The client needs both: an empty following feed reads
       * differently when you follow nobody than when the people you follow
       * have simply been quiet, and only the count distinguishes them.
       */
      scope: allowed ? ("following" as const) : ("everyone" as const),
      followingCount: allowed ? allowed.size : null,
      /*
       * The trade half of this feed is not everything that traded.
       *
       * Posts come from Postgres and are always complete; trades are read per
       * pool from a log tail that may not have caught up. Without this flag a
       * client cannot tell a quiet network from a lagging read, and would
       * render the second as the first.
       */
      tradesPartial: feed.partial,
    });
  });
}
