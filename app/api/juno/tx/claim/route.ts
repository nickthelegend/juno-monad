import { buildClaim } from "@/lib/juno/tx";
import { junoHandler, junoJson, junoOptions, readJson, requireString, retryWhenBusy } from "@/lib/juno/api";
import { launchpadMissing, requireAddress } from "../../_lib/guards";

export const dynamic = "force-dynamic";
export const OPTIONS = junoOptions;

/**
 * Build the transaction that pays a creator their trading fees.
 *
 * `POST {creator, token}` → `{steps}`.
 *
 * The launchpad accrues a share of every trade's fee to the coin's creator and
 * pays it out only to them — `claimCreatorFees` reverts with `NotCreator` for
 * anyone else. `buildClaim` checks that against the pool read from the chain
 * before building, along with whether there is anything to claim, so the
 * person gets a sentence instead of a transaction that would revert after
 * they signed it.
 */
export async function POST(request: Request) {
  return junoHandler(async () => {
    const missing = launchpadMissing();
    if (missing) return missing;

    const body = await readJson<Record<string, unknown>>(request);
    const creator = requireAddress(requireString(body.creator, "creator"), "creator");
    const token = requireAddress(requireString(body.token, "token"), "token");

    const steps = await retryWhenBusy(() => buildClaim({ creator, token }));
    return junoJson({ steps });
  });
}
