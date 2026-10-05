import { junoHandler, junoJson, junoOptions, readJson, requireString, retryWhenBusy } from "@/lib/juno/api";
import { buildAusdFaucet } from "@/lib/juno/tx";

export const dynamic = "force-dynamic";
export const OPTIONS = junoOptions;

/**
 * `POST {owner}` — testnet AUSD from Agora's faucet, for Perpl collateral.
 * Answers the one call to sign, or 400 with the faucet rule that refuses it
 * (one drip a minute across everyone; wallets topped up to a cap).
 */
export async function POST(request: Request) {
  return junoHandler(async () => {
    const body = await readJson<Record<string, unknown>>(request);
    const owner = requireString(body.owner, "owner");
    return junoJson(await retryWhenBusy(() => buildAusdFaucet({ owner })));
  });
}
