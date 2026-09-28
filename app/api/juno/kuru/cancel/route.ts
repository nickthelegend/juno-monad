import { CallerError, junoHandler, junoJson, junoOptions, readJson, requireString, retryWhenBusy } from "@/lib/juno/api";
import { buildKuruCancelOrders } from "@/lib/juno/tx";
import { launchpadMissing } from "../../_lib/guards";

export const dynamic = "force-dynamic";
export const OPTIONS = junoOptions;

/** `POST {token, owner, orderIds}` — cancel resting Kuru orders; what they locked returns to the MarginAccount. */
export async function POST(request: Request) {
  return junoHandler(async () => {
    const missing = launchpadMissing();
    if (missing) return missing;
    const body = await readJson<Record<string, unknown>>(request);
    if (!Array.isArray(body.orderIds)) throw new CallerError('"orderIds" must be a list');
    // Read and checked once; only the chain reads inside the build are retried.
    const input = {
      token: requireString(body.token, "token"),
      owner: requireString(body.owner, "owner"),
      orderIds: body.orderIds.map((id) => String(id)),
    };
    const steps = await retryWhenBusy(() => buildKuruCancelOrders(input));
    return junoJson({ steps });
  });
}
