import { junoError, junoHandler, junoJson, junoOptions } from "@/lib/juno/api";
import { assertAddress, plans, watchlist } from "@/lib/juno/social-graph";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const OPTIONS = junoOptions;

/**
 * One wallet's relationship to one coin: watching it, and any plan against it.
 *
 * This exists because the coin screen needs two booleans and a row, and the
 * list endpoints that already answer those questions each walk the registry and
 * hydrate every pool from the chain — seconds against a rate-limited endpoint,
 * to decide whether a button says "Watch" or "Watching". Nothing here touches
 * the chain at all: both answers live in Postgres, and the price the coin
 * screen needs to judge an alert against is already on that screen.
 *
 * `GET ?wallet=&token=`.
 */
export async function GET(request: Request) {
  return junoHandler(async () => {
    const url = new URL(request.url);
    const rawWallet = url.searchParams.get("wallet") ?? "";
    const rawToken = url.searchParams.get("token") ?? "";
    if (!rawWallet) return junoError("A wallet is required");
    if (!rawToken) return junoError("A token is required");
    // Checksummed, because that is how both tables store them — a lowercase
    // address from a URL must match the row a checksummed one wrote.
    const wallet = assertAddress(rawWallet);
    const token = assertAddress(rawToken, "token");

    const [watched, owned] = await Promise.all([watchlist(wallet), plans(wallet)]);
    const row = watched.find((item) => item.token === token) ?? null;

    return junoJson({
      wallet,
      token,
      watching: row !== null,
      alertPrice: row?.alertPrice ?? null,
      // The direction an alert will fire in is the price it was set against.
      // Returned rather than resolved here because resolving it needs the live
      // price, which the caller already has and this route deliberately does not
      // pay to read.
      alertSetAtPrice: row?.alertSetAtPrice ?? null,
      // Every plan this wallet has against this coin, newest first. Plural
      // because nothing stops two — a weekly and a monthly are a reasonable
      // pair, and silently showing one would hide the other.
      plans: owned.filter((plan) => plan.token === token),
    });
  });
}
