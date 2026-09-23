import { junoHandler, junoJson, junoOptions } from "@/lib/juno/api";
import { networkKey } from "@/lib/juno/network";
import { syncTrades, type SyncState } from "@/lib/juno/swaps";
import { launchpadMissing } from "../_lib/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Catching up from a cold start is slow by design; give it room. */
export const maxDuration = 300;
export const OPTIONS = junoOptions;

/**
 * How long one request keeps walking, leaving headroom under `maxDuration`
 * for the pass in flight to finish and the answer to be written.
 */
const DEFAULT_BUDGET_MS = 240_000;

/**
 * Walk the launchpad's trade log forward and write down what it finds.
 *
 * Every trade made through the app is recorded from its own receipt the moment
 * it confirms. This catches the rest — a trade from another app, a script, a
 * direct contract call — by reading the launchpad's `Trade` events a range of
 * blocks at a time from one shared cursor. Page requests nudge that cursor
 * forward a few ranges each; this is what a cron hits so it never falls
 * behind, and what to run once after a deploy to catch up from the deploy
 * block.
 *
 * Each pass is `syncTrades()`: up to a dozen `eth_getLogs` ranges (100 blocks
 * each on the public RPC, `JUNO_LOG_RANGE` on a dedicated one). Passes repeat
 * until the tail is within a couple of blocks of the head, the time budget is
 * spent, or a pass makes no progress — which means the RPC refused, and
 * hammering it would not help. Safe to re-run and safe to run while the app is
 * serving: a trade's `txHash:logIndex` is its key, so a second pass over the
 * same range inserts nothing.
 *
 * `GET /api/juno/index` — optionally `?seconds=` to stop sooner than the
 * default budget, for a scheduler with a shorter timeout.
 */
export async function GET(request: Request) {
  return junoHandler(async () => {
    const missing = launchpadMissing();
    if (missing) return missing;

    const asked = Number(new URL(request.url).searchParams.get("seconds"));
    const budgetMs =
      Number.isFinite(asked) && asked > 0 ? Math.min(asked * 1000, DEFAULT_BUDGET_MS) : DEFAULT_BUDGET_MS;
    const stopAt = Date.now() + budgetMs;

    let state: SyncState = { cursor: null, latest: null, caughtUp: false };
    let passes = 0;
    while (Date.now() < stopAt) {
      const before = state.cursor;
      state = await syncTrades();
      passes += 1;
      if (state.caughtUp) break;
      // No cursor at all (the head could not be read), or a pass that moved
      // nothing: the endpoint is refusing. Stop and let the next run resume.
      if (state.cursor === null || state.cursor === before) break;
    }

    return junoJson({
      network: networkKey(),
      /** The last block whose trades are on record. Null when the head could not be read. */
      cursor: state.cursor === null ? null : Number(state.cursor),
      latest: state.latest === null ? null : Number(state.latest),
      /** Within a couple of blocks of the head. False means re-run to finish. */
      caughtUp: state.caughtUp,
      passes,
    });
  });
}
