import { junoJson, junoOptions, junoRead } from "@/lib/juno/api";
import { perpAccount } from "@/lib/juno/perpl";
import { requireAddress } from "../../_lib/guards";

export const dynamic = "force-dynamic";
export const OPTIONS = junoOptions;

/**
 * `GET ?owner=` — a wallet on Perpl, read from the contract: its account (null
 * until it deposits), free and locked collateral, the AUSD in the wallet, and
 * every open position with entry, mark, collateral, P&L, funding and the
 * liquidation price. `markValid` false on a position means Perpl's price is
 * stale: closing works, opening does not.
 */
export async function GET(request: Request) {
  return junoRead(async () => {
    const owner = requireAddress(new URL(request.url).searchParams.get("owner"), "owner");
    return junoJson(await perpAccount(owner));
  });
}
