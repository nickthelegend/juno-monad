import { junoError, junoHandler, junoJson, junoOptions, junoRead, readJson, requireNumber, requireString } from "@/lib/juno/api";
import { hydratePools } from "@/lib/juno/chain";
import { getPool, listPools } from "@/lib/juno/registry";
import { assertAddress, crossed, unwatch, watch, watchlist } from "@/lib/juno/social-graph";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const OPTIONS = junoOptions;

/**
 * Coins a wallet is watching, priced, with any alert resolved.
 *
 * The rows come from Postgres and are always complete; the prices come from the
 * chain and may not be. `missing` says how many could not be priced rather than
 * dropping them silently, which is the same contract every other list here
 * follows.
 */
export async function GET(request: Request) {
  return junoRead(async () => {
    const raw = new URL(request.url).searchParams.get("wallet") ?? "";
    if (!raw) return junoError("A wallet is required");
    const wallet = assertAddress(raw);

    const rows = await watchlist(wallet);
    if (rows.length === 0) return junoJson({ wallet, items: [], missing: 0 });

    const registry = await listPools(60);
    const wanted = new Set(rows.map((row) => row.token));
    const { coins, missing } = await hydratePools(registry.filter((row) => wanted.has(row.token)));
    const priced = new Map(coins.map((coin) => [coin.address, coin]));

    const items = rows.map((row) => {
      const coin = priced.get(row.token) ?? null;
      return {
        token: row.token,
        watchedAt: row.createdAt,
        alertPrice: row.alertPrice,
        // Null when the coin could not be priced: an alert cannot be said to
        // have fired or not fired against a price nobody read.
        alertCrossed: coin ? crossed(row, coin.priceUsd) : null,
        coin: coin
          ? {
              address: coin.address,
              name: coin.name,
              symbol: coin.symbol,
              priceUsd: coin.priceUsd,
              marketCap: coin.marketCap,
              currency: coin.marketCapCurrency,
              changePct: coin.marketCapChangePct,
              progress: coin.curve.progress,
              graduated: coin.curve.graduated,
              media: coin.media,
            }
          : null,
      };
    });

    return junoJson({ wallet, items, missing });
  });
}

/**
 * `POST {wallet, token, watch?: boolean, alertPrice?: number, priceNow?: number}`.
 *
 * `priceNow` is required with an alert: the direction the alert fires in is
 * derived from the price it was set against.
 */
export async function POST(request: Request) {
  return junoHandler(async () => {
    const body = await readJson<Record<string, unknown>>(request);
    const wallet = assertAddress(requireString(body.wallet, "wallet"));
    const token = assertAddress(requireString(body.token, "token"), "token");

    if (body.watch === false) {
      await unwatch(wallet, token);
      return junoJson({ token, watching: false });
    }

    // A pool that is not in the registry cannot be watched: the list would
    // carry a row nothing can ever price.
    const row = await getPool(token);
    if (!row) return junoError("Coin not found", 404);

    let alert: { price: number; priceNow: number } | null = null;
    if (body.alertPrice !== undefined && body.alertPrice !== null) {
      const price = requireNumber(body.alertPrice, "alertPrice");
      const priceNow = requireNumber(body.priceNow, "priceNow");
      alert = { price, priceNow };
    }

    await watch(wallet, token, alert);
    return junoJson({ token, watching: true, alertPrice: alert?.price ?? null });
  });
}
