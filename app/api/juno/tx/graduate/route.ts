import { buildGraduate } from "@/lib/juno/tx";
import { junoHandler, junoJson, junoOptions, readJson, requireString, retryWhenBusy } from "@/lib/juno/api";
import { launchpadMissing, requireAddress } from "../../_lib/guards";

export const dynamic = "force-dynamic";
export const OPTIONS = junoOptions;

/**
 * Build the transaction that moves a filled curve into its AMM pair.
 *
 * `POST {from, token}` → `{steps}`.
 *
 * Anyone may send it and the outcome does not depend on who does: the
 * launchpad seeds the pair from the curve's own reserves. `from` is only the
 * wallet that pays the gas. The build refuses a curve that has not filled or
 * has already graduated, which are the two ways the contract would revert.
 */
export async function POST(request: Request) {
  return junoHandler(async () => {
    const missing = launchpadMissing();
    if (missing) return missing;

    const body = await readJson<Record<string, unknown>>(request);
    const from = requireAddress(requireString(body.from, "from"), "from");
    const token = requireAddress(requireString(body.token, "token"), "token");

    const steps = await retryWhenBusy(() => buildGraduate({ from, token }));
    return junoJson({ steps });
  });
}
