import { junoError, junoHandler, junoJson, junoOptions } from "@/lib/juno/api";
import { perpMarkets, perpl } from "@/lib/juno/perpl";

export const dynamic = "force-dynamic";
export const OPTIONS = junoOptions;

/**
 * `GET` — Perpl's perpetual markets on this network, live: mark, oracle and
 * last price, 24h change and volume, open interest, funding and the most
 * leverage each allows. From Perpl's public API; `exchange` and `collateral`
 * are the contracts the orders go to.
 */
export async function GET() {
  return junoHandler(async () => {
    const markets = await perpMarkets().catch(() => null);
    if (!markets) return junoError("Perpl's market data did not answer. Try again in a moment.", 503);
    return junoJson({ exchange: perpl().exchange, collateral: { symbol: "AUSD", address: perpl().ausd, decimals: 6 }, markets });
  });
}
