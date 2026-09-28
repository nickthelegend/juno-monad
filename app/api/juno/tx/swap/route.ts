import { buildSwap } from "@/lib/juno/tx";
import { getPool } from "@/lib/juno/registry";
import {
  CallerError,
  junoHandler,
  junoJson,
  junoOptions,
  readJson,
  requireNumber,
  requireString,
  retryWhenBusy,
} from "@/lib/juno/api";
import type { TradeSide } from "@/lib/juno/types";
import { launchpadMissing, requireAddress } from "../../_lib/guards";

export const dynamic = "force-dynamic";
export const OPTIONS = junoOptions;

/**
 * Build an unsigned swap for a coin.
 *
 * The client sends what it wants to trade; it gets back the transactions to
 * sign (an approval first when a USDC buy needs one), the quote they were
 * built against, and the deadline after which the launchpad refuses them. It
 * signs on-device and posts each step to `/api/juno/tx/submit`, in order.
 *
 * Only coins Juno launched can be traded here, so the token is looked up in
 * the registry first. The registry is not what the transaction is built from,
 * though: `buildSwap` reads the pool from the launchpad itself, and that read
 * is the source of truth for the curve, the quote token and whether the curve
 * is still open. There is no pool address to accept from the caller at all —
 * on Monad a pool is keyed by its token inside the launchpad.
 */
export async function POST(request: Request) {
  return junoHandler(async () => {
    const missing = launchpadMissing();
    if (missing) return missing;

    const body = await readJson<Record<string, unknown>>(request);

    const token = requireAddress(requireString(body.token, "token"), "token");
    const owner = requireAddress(requireString(body.owner, "owner"), "owner");
    const side = requireString(body.side, "side") as TradeSide;
    if (side !== "buy" && side !== "sell") {
      throw new CallerError('"side" must be "buy" or "sell"');
    }
    // Either what to spend (`amountIn`) or, on a buy against the curve,
    // exactly how many tokens to receive (`amountOut`).
    const amountOut =
      body.amountOut === undefined || body.amountOut === null ? undefined : requireNumber(body.amountOut, "amountOut");
    const amountIn = amountOut === undefined ? requireNumber(body.amountIn, "amountIn") : 0;

    // Basis points become a bigint factor when the minimum is computed, so a
    // fraction would throw deep inside the quote and come back as a 500.
    let slippageBps: number | undefined;
    if (body.slippageBps !== undefined && body.slippageBps !== null) {
      slippageBps = requireNumber(body.slippageBps, "slippageBps");
      if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 5_000) {
        throw new CallerError('"slippageBps" must be a whole number from 0 to 5000');
      }
    }

    const row = await getPool(token);
    if (!row) throw new CallerError("Coin not found", 404);

    const result = await retryWhenBusy(() => buildSwap({ token, side, amountIn, amountOut, owner, slippageBps }));

    return junoJson({ ...result, token: row.token, symbol: row.symbol });
  });
}
