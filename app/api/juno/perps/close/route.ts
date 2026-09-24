import { junoHandler, junoJson, junoOptions, readJson, requireNumber, requireString } from "@/lib/juno/api";
import { buildPerpClose } from "@/lib/juno/tx";

export const dynamic = "force-dynamic";
export const OPTIONS = junoOptions;

/** `POST {owner, perpId, slippageBps?}` — close the whole position with a reduce-only order (default 1.5% from the mark). */
export async function POST(request: Request) {
  return junoHandler(async () => {
    const body = await readJson<Record<string, unknown>>(request);
    const steps = await buildPerpClose({
      owner: requireString(body.owner, "owner"),
      perpId: requireNumber(body.perpId, "perpId"),
      slippageBps: body.slippageBps === undefined ? undefined : requireNumber(body.slippageBps, "slippageBps"),
    });
    return junoJson({ steps });
  });
}
