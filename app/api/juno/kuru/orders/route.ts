import { CallerError, junoJson, junoOptions, junoRead } from "@/lib/juno/api";
import { envioConfigured, envioKuruOrderIds } from "@/lib/juno/envio";
import { kuruBalances, kuruMarketOf, kuruOpenOrders } from "@/lib/juno/kuru";
import { recordedKuruOrderIds } from "@/lib/juno/kuru-orders";
import { requireAddress, launchpadMissing } from "../../_lib/guards";

export const dynamic = "force-dynamic";
export const OPTIONS = junoOptions;

/**
 * `GET ?token=&owner=` — a wallet's resting orders on a coin's Kuru market,
 * and what Kuru's MarginAccount holds for it (fills and change, withdrawable).
 *
 * The indexer names the orders the wallet placed; without one, the orders
 * Juno recorded from the receipts of the transactions it submitted do. Each
 * is then read from the book itself, so a list is what the book holds this
 * block. `orders` is null only when neither could be read: not "no orders".
 * `source` says which named them.
 */
export async function GET(request: Request) {
  return junoRead(async () => {
    const missing = launchpadMissing();
    if (missing) return missing;
    const params = new URL(request.url).searchParams;
    const token = requireAddress(params.get("token"), "token");
    const owner = requireAddress(params.get("owner"), "owner");
    const market = await kuruMarketOf(token);
    if (!market) throw new CallerError("This coin has no Kuru market", 404);

    const source = envioConfigured() ? "indexer" : "receipts";
    const [balances, orders] = await Promise.all([
      kuruBalances(owner, token),
      (source === "indexer" ? envioKuruOrderIds(owner, token) : recordedKuruOrderIds(owner, token))
        .then((ids) => kuruOpenOrders(market, owner, ids))
        .catch(() => null),
    ]);
    return junoJson({ market, orders, balances, source });
  });
}
