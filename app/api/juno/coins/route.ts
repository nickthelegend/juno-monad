import { getAddress, isAddress } from "viem";

import { hydratePools } from "@/lib/juno/chain";
import { listPools } from "@/lib/juno/registry";
import { junoHandler, junoJson, junoOptions } from "@/lib/juno/api";
import { networkKey } from "@/lib/juno/network";
import { socialCounts } from "@/lib/juno/social";
import type { Coin } from "@/lib/juno/types";

export const dynamic = "force-dynamic";
export const OPTIONS = junoOptions;

/**
 * The market list: every Juno coin on this network, priced.
 *
 * List views deliberately skip the detailed reads — holders, fee metrics, trade
 * history — because a grid shows none of them and each one is another call
 * against an endpoint that throttles. What is left is one launchpad read per
 * coin, and the shared client batches those into Multicall3.
 *
 * `?sort=marketCap|graduating|memes`. `memes` is the posts and reels only —
 * every coin that tracks nothing — for comparing curves as a list rather than
 * scrolling a feed. Unknown values leave the registry's newest-first order.
 */
export async function GET(request: Request) {
  return junoHandler(async () => {
    const url = new URL(request.url);
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 40) || 40, 60);
    const sort = url.searchParams.get("sort");

    // `?nav=1`: each tracker's reference price too — see `hydratePool`.
    const hydrated = await hydratePools(await listPools(limit, { listedOnly: true }), 2, {
      nav: url.searchParams.get("nav") === "1",
    });
    const { missing } = hydrated;
    let coins = hydrated.coins;

    if (sort === "memes") {
      // A tracker names a reference (a Pyth feed or a Tessera mark); a meme
      // does not. Trackers live under their own tabs.
      coins = coins.filter((coin) => !coin.reference);
    } else if (sort === "marketCap") {
      coins.sort((a, b) => b.marketCap - a.marketCap);
    } else if (sort === "graduating") {
      /*
       * Closest to its migration threshold first — the coins about to become
       * permanent AMM markets.
       *
       * A pool that has already graduated is *done*, so it drops to the bottom
       * rather than topping a list about what is next — a graduated pool
       * reports 100% progress, so without this the list would lead with pools
       * that had already finished.
       */
      const rank = (coin: Coin) =>
        coin.curve.graduated ? -1 : coin.curve.progress;
      coins.sort((a, b) => rank(b) - rank(a));
    }

    /*
     * `?social=1` adds likes and comment counts, and `&viewer=` whether that
     * wallet liked each — what a feed card and a reel rail print.
     *
     * Two grouped Mongo reads for the whole page, and optional in both
     * directions: a Mongo outage leaves the counts off rather than failing a
     * market list whose numbers come from the chain.
     */
    if (url.searchParams.get("social") === "1") {
      const viewer = url.searchParams.get("viewer");
      const counts = await socialCounts(
        coins.map((coin) => coin.address),
        networkKey(),
        // Likes are stored against the checksummed address.
        viewer && isAddress(viewer) ? getAddress(viewer) : null,
      ).catch(() => null);
      if (counts) {
        for (const coin of coins) {
          const entry = counts.get(coin.address);
          if (!entry) continue;
          coin.likes = entry.likes;
          coin.commentCount = entry.comments;
          coin.viewerLiked = entry.viewerLiked;
        }
      }
    }

    return junoJson({
      network: networkKey(),
      coins,
      /*
       * Registry rows this read could not resolve.
       *
       * Without it the list presents itself as the whole market while it is
       * quietly two coins short, which is what a throttled endpoint produces
       * most of the time. The client shows the number; it does not guess.
       */
      missing,
    });
  });
}
