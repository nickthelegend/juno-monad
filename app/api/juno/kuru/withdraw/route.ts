import { junoHandler, junoJson, junoOptions, readJson, requireString, retryWhenBusy } from "@/lib/juno/api";
import { buildKuruWithdrawAll } from "@/lib/juno/tx";
import { launchpadMissing } from "../../_lib/guards";

export const dynamic = "force-dynamic";
export const OPTIONS = junoOptions;

/** `POST {token, owner}` — move the wallet's MON and coin out of Kuru's MarginAccount: fills and unused change. */
export async function POST(request: Request) {
  return junoHandler(async () => {
    const missing = launchpadMissing();
    if (missing) return missing;
    const body = await readJson<Record<string, unknown>>(request);
    // Read and checked once; only the chain reads inside the build are retried.
    const input = {
      token: requireString(body.token, "token"),
      owner: requireString(body.owner, "owner"),
    };
    const steps = await retryWhenBusy(() => buildKuruWithdrawAll(input));
    return junoJson({ steps });
  });
}
