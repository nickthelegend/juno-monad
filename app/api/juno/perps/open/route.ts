import { CallerError, junoHandler, junoJson, junoOptions, readJson, requireNumber, requireString } from "@/lib/juno/api";
import { buildPerpOpen } from "@/lib/juno/tx";

export const dynamic = "force-dynamic";
export const OPTIONS = junoOptions;

/**
 * `POST {owner, perpId, side, collateral, leverage, slippageBps?}` — open or
 * add to a position: `collateral` AUSD at `leverage`, filled at once up to
 * `slippageBps` from the mark (default 1%). Answers `{ steps, size, mark,
 * limitPrice }`. The submit answer's `perp` says whether it filled.
 */
export async function POST(request: Request) {
  return junoHandler(async () => {
    const body = await readJson<Record<string, unknown>>(request);
    const side = requireString(body.side, "side");
    if (side !== "long" && side !== "short") throw new CallerError('"side" must be "long" or "short"');
    return junoJson(
      await buildPerpOpen({
        owner: requireString(body.owner, "owner"),
        perpId: requireNumber(body.perpId, "perpId"),
        side,
        collateral: requireNumber(body.collateral, "collateral"),
        leverage: requireNumber(body.leverage, "leverage"),
        slippageBps: body.slippageBps === undefined ? undefined : requireNumber(body.slippageBps, "slippageBps"),
      }),
    );
  });
}
