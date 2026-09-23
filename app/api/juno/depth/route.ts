import { junoError, junoHandler, junoJson, junoOptions } from "@/lib/juno/api";
import { fetchPoolSnapshot } from "@/lib/juno/launchpad";
import { sampleDepth, suggestSize } from "@/lib/juno/depth";
import { quoteTokenUsdPrice } from "@/lib/juno/pyth";
import { getPool } from "@/lib/juno/registry";
import { requireAddress } from "../_lib/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const OPTIONS = junoOptions;

/**
 * What this curve can absorb.
 *
 * `GET ?token=&side=buy|sell&max=&impact=` returns a depth curve sampled across
 * sizes and, when `impact` is given, the largest trade that stays under it.
 *
 * Every point is the launchpad's own `quoteBuy` / `quoteSell` — the arithmetic
 * `buy` and `sell` run — not a model of it. The probes of one round go out
 * together and the shared client folds them into a single Multicall3
 * `eth_call`, so a twelve-point chart is one round trip.
 */
export async function GET(request: Request) {
  return junoHandler(async () => {
    const url = new URL(request.url);
    const raw = url.searchParams.get("token") ?? "";
    if (!raw) return junoError("A token is required");
    const token = requireAddress(raw, "token");

    const side = url.searchParams.get("side") === "sell" ? "sell" : "buy";

    const row = await getPool(token);
    if (!row) return junoError("Coin not found", 404);

    const rate = (await quoteTokenUsdPrice(row.quoteToken).catch(() => null)) ?? 1;
    // Read from the launchpad this coin was recorded against, which is the one
    // that holds its curve.
    const snapshot = await fetchPoolSnapshot(row.token, rate, row.launchpad);
    if (!snapshot) return junoError("This coin's pool is not on its launchpad on this network", 404);

    /*
     * The default ceiling is scaled to the curve, not picked.
     *
     * A fixed "10 MON" is meaningless across four presets and two quote
     * tokens: on a thin-name curve it is the whole book, on a deep one it is
     * noise. What remains to raise before graduation is the only size that
     * means the same thing on every pool.
     */
    const remaining = Math.max(snapshot.curve.thresholdUsd - snapshot.curve.raisedUsd, 0) / rate;
    // For a sell, roughly the tokens that have been bought out of the curve so
    // far — quote raised, at the current price. It is only where the search
    // stops looking, never a figure this route publishes, so an approximation
    // is the right kind of number here. The search itself is capped at what
    // the curve can actually take back.
    const sold = snapshot.price > 0 ? snapshot.curve.raisedUsd / rate / snapshot.price : 0;
    const fallback = side === "buy" ? Math.max(remaining, 0.1) : sold;
    const asked = Number(url.searchParams.get("max"));
    const max = Number.isFinite(asked) && asked > 0 ? asked : fallback;

    const impact = Number(url.searchParams.get("impact"));
    const budget = Number.isFinite(impact) && impact > 0 ? impact : null;
    if (url.searchParams.has("impact") && budget === null) {
      return junoError("`impact` must be a ratio greater than zero, e.g. 0.01 for 1%");
    }

    /*
     * Sequential, not parallel.
     *
     * Each is a burst of quotes against the same endpoint; run together they
     * would be two multicalls racing the same rate limit, run in order they are
     * two polite ones.
     */
    const points = await sampleDepth(snapshot, side, max);
    const suggestion =
      budget === null ? null : await suggestSize(snapshot, side, budget, max);

    return junoJson({
      token: row.token,
      side,
      /** Spot, for the axis the impact is measured against. */
      spot: snapshot.price,
      quoteSymbol: snapshot.quote.symbol,
      quoteUsdRate: rate === 1 ? null : rate,
      max,
      points,
      /** Null when no size at all fits the budget — a real answer on a thin curve. */
      suggestion,
    });
  });
}
