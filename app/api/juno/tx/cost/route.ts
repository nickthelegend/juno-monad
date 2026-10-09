import { isHash, type Hash } from "viem";

import { CallerError, junoJson, junoOptions, junoRead } from "@/lib/juno/api";
import { readTxCost } from "@/lib/juno/tx-cost-read";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const OPTIONS = junoOptions;

/**
 * `GET /tx/cost?hash=0x…` — what a confirmed transaction cost on Monad, and
 * what the same gas would cost on Ethereum mainnet now.
 *
 * Asked for after a trade lands, so the receipt shows its time at once and
 * this line a moment later; a slow Ethereum endpoint never slows a trade.
 * `ethereum` is null when Ethereum's gas price could not be read, and each
 * dollar figure is null when its price feed could not be.
 */
export async function GET(request: Request) {
  return junoRead(async () => {
    const hash = new URL(request.url).searchParams.get("hash") ?? "";
    if (!isHash(hash)) throw new CallerError("hash is not a transaction hash");
    const cost = await readTxCost(hash as Hash);
    if (!cost) throw new CallerError("No confirmed transaction with that hash", 404);
    return junoJson(cost);
  });
}
