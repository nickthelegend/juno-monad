import { CallerError, junoHandler, junoJson, junoOptions, readJson, requireNumber, requireString } from "@/lib/juno/api";
import { buildKuruLimit } from "@/lib/juno/tx";
import { launchpadMissing } from "../../_lib/guards";

export const dynamic = "force-dynamic";
export const OPTIONS = junoOptions;

/**
 * `POST {token, owner, side, price, amount}` — a limit order on the Kuru
 * market of a coin that graduated there. `price` is MON per token, `amount`
 * tokens. Answers `{ steps, market, price, amount, locks }`: the steps move
 * any shortfall into Kuru's MarginAccount (with an approval first for a sell)
 * and place the order; `price` is snapped to the market's tick, never worse
 * than asked; `locks` is what the order holds while it rests.
 */
export async function POST(request: Request) {
  return junoHandler(async () => {
    const missing = launchpadMissing();
    if (missing) return missing;
    const body = await readJson<Record<string, unknown>>(request);
    const side = requireString(body.side, "side");
    if (side !== "buy" && side !== "sell") throw new CallerError('"side" must be "buy" or "sell"');
    return junoJson(
      await buildKuruLimit({
        token: requireString(body.token, "token"),
        owner: requireString(body.owner, "owner"),
        side,
        price: requireNumber(body.price, "price"),
        amount: requireNumber(body.amount, "amount"),
      }),
    );
  });
}
