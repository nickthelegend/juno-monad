import { CallerError, junoHandler, junoJson, junoOptions } from "@/lib/juno/api";
import { envioConfigured, envioKuruOrderIds } from "@/lib/juno/envio";
import { kuruBalances, kuruMarketOf, kuruOpenOrders } from "@/lib/juno/kuru";
import { requireAddress, launchpadMissing } from "../../_lib/guards";

export const dynamic = "force-dynamic";
export const OPTIONS = junoOptions;

/**
 * `GET ?token=&owner=` — a wallet's resting orders on a coin's Kuru market,
 * and what Kuru's MarginAccount holds for it (fills and change, withdrawable).
 *
 * The indexer names the orders the wallet placed; each is then read from the
 * book itself, so a list is what the book holds this block. `orders` is null
 * when there is no indexer to ask — not "no orders".
 */
export async function GET(request: Request) {
  return junoHandler(async () => {
    const missing = launchpadMissing();
    if (missing) return missing;
    const params = new URL(request.url).searchParams;
    const token = requireAddress(params.get("token"), "token");
    const owner = requireAddress(params.get("owner"), "owner");
    const market = await kuruMarketOf(token);
    if (!market) throw new CallerError("This coin has no Kuru market", 404);

    const [balances, orders] = await Promise.all([
      kuruBalances(owner, token),
      envioConfigured()
        ? envioKuruOrderIds(owner, token)
            .then((ids) => kuruOpenOrders(market, owner, ids))
            .catch(() => null)
        : Promise.resolve(null),
    ]);
    return junoJson({ market, orders, balances });
  });
}
