import { junoHandler, junoJson, junoOptions, readJson, requireNumber, requireString } from "@/lib/juno/api";
import { buildPerpWithdraw } from "@/lib/juno/tx";

export const dynamic = "force-dynamic";
export const OPTIONS = junoOptions;

/** `POST {owner, amount}` — free AUSD out of Perpl back to the wallet. */
export async function POST(request: Request) {
  return junoHandler(async () => {
    const body = await readJson<Record<string, unknown>>(request);
    const steps = await buildPerpWithdraw({
      owner: requireString(body.owner, "owner"),
      amount: requireNumber(body.amount, "amount"),
    });
    return junoJson({ steps });
  });
}
