import { junoHandler, junoJson, junoOptions, readJson, requireNumber, requireString } from "@/lib/juno/api";
import { buildPerpDeposit } from "@/lib/juno/tx";

export const dynamic = "force-dynamic";
export const OPTIONS = junoOptions;

/** `POST {owner, amount}` — AUSD into Perpl, opening the account on first use (at least 100 AUSD). */
export async function POST(request: Request) {
  return junoHandler(async () => {
    const body = await readJson<Record<string, unknown>>(request);
    const steps = await buildPerpDeposit({
      owner: requireString(body.owner, "owner"),
      amount: requireNumber(body.amount, "amount"),
    });
    return junoJson({ steps });
  });
}
