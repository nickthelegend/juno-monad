import { hydratePool, poolActivityRead } from "@/lib/juno/chain";
import { listPoolHolders } from "@/lib/juno/activity";
import { crowdFromSwaps } from "@/lib/juno/crowd";
import { fetchPoolSnapshot } from "@/lib/juno/launchpad";
import { listSwapHistory } from "@/lib/juno/swaps";
import { quoteTokenUsdPrice } from "@/lib/juno/pyth";
import { getPool } from "@/lib/juno/registry";
import { networkKey } from "@/lib/juno/network";
import { junoError, junoHandler, junoJson, junoOptions } from "@/lib/juno/api";
import type { Holder } from "@/lib/juno/types";
import { requireAddress } from "../../_lib/guards";

export const dynamic = "force-dynamic";
export const OPTIONS = junoOptions;

/**
 * One coin, fully hydrated: price, curve, NAV band, chart series and activity.
 *
 * Unlike the web coin page, this cannot stream — a JSON response is one
 * payload — so the caller gets everything at once and the mobile client shows
 * its own skeletons while it waits.
 *
 * Every chain read here names the launchpad the registry row was recorded
 * against, so a coin page keeps working even on a server whose own launchpad
 * setting has moved on or is not set.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  return junoHandler(async () => {
    const { token: raw } = await params;
    const token = requireAddress(raw, "token");

    const row = await getPool(token);
    if (!row) return junoError("Coin not found", 404);

    // Hydration first, then the rest. `hydratePool` and `poolActivityRead` both
    // want this coin's trade history, and firing them together made them race
    // for the same uncached read. Sequenced, the second call is a cache hit.
    const coin = await hydratePool(row, { detailed: true });
    if (!coin) return junoError("This coin's pool is not on its launchpad on this network", 404);

    /*
     * Activity, crowd and holders are extras, and they are allowed to fail.
     *
     * The price, the curve and the NAV band have all been read successfully by
     * this point, and a refused history read must not discard them. Everything
     * after this degrades to empty — but an empty list is reported *with* the
     * flag that says whether it was read or merely attempted. Without that
     * flag the mobile client printed "No trades yet." for a coin whose history
     * simply had not been read, which is the one thing this app is not allowed
     * to do.
     */
    /*
     * One history read, two consumers.
     *
     * The crowd figures and the holder book are both built from this coin's
     * `Trade` events. `listSwapHistory` is cached, so a second call would be
     * cheap rather than free — but reading it once here also means the two
     * cannot disagree about what the history contained, which they could if
     * one of them landed either side of a cache expiry.
     */
    const decoded = await (async () => {
      // The *same* rate `hydratePool` used, so this is the cached snapshot
      // rather than a second read under a different key.
      const rate = (await quoteTokenUsdPrice(row.quoteToken).catch(() => null)) ?? 1;
      const snapshot = await fetchPoolSnapshot(row.token, rate, row.launchpad);
      if (!snapshot) return null;
      const history = await listSwapHistory(row.token);
      return { history, snapshot, rate };
    })().catch(() => null);

    // `snapshot.price`, not `coin.priceUsd`. A trade's price is quote per
    // token, so comparing it against a USD price would multiply the first
    // buyer's return by whatever MON costs.
    const crowd = decoded
      ? crowdFromSwaps(
          decoded.history.swaps,
          decoded.history.partial,
          decoded.snapshot.price,
          decoded.rate,
        )
      : null;

    const holders = await (async (): Promise<{
      items: Holder[];
      unreadable: boolean;
      source: "balances" | "fills" | null;
    }> => {
      if (!decoded) return { items: [], unreadable: true, source: null };
      const { swaps, partial } = decoded.history;
      // A complete history with no trades in it is a real answer: nobody has
      // bought, so nobody holds. That is different from a read that failed,
      // and `listPoolHolders` cannot tell the two apart from an empty list.
      if (swaps.length === 0) return { items: [], unreadable: partial, source: null };
      // The traders name the candidates; their live `balanceOf` says what each
      // actually holds now, falling back to net fills if that read is refused.
      const book = await listPoolHolders(row.token, swaps);
      return { items: book?.holders ?? [], unreadable: book === null, source: book?.source ?? null };
    })().catch(() => ({ items: [], unreadable: true, source: null }));

    const activity = await poolActivityRead(row, 20).catch(() => ({ items: [], partial: true }));

    return junoJson({
      /* Which network this is. The client renders it in the details, and
         guessing it there would be the one fact on that list that was not
         read from anywhere. */
      network: networkKey(),
      coin,
      activity: activity.items,
      /** True when the history read was cut short: `activity` is not the whole story. */
      activityPartial: activity.partial,
      /** Null when the history could not be read at all — not "nobody traded". */
      crowd,
      /** How the holder list was derived: live balances, or net fills. Null when neither ran. */
      holdersSource: holders.source,
      holders: holders.items,
      /** True when the holder read failed outright — not "nobody holds it". */
      holdersUnreadable: holders.unreadable,
      /** The transaction that launched this coin — the receipt a judge clicks. */
      launchTx: row.createTx,
    });
  });
}
