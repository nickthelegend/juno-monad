import { CallerError, junoHandler, junoJson, junoOptions, readJson, requireString } from "@/lib/juno/api";
import { autopilotStatus, confirmAutopilot, startAutopilot, stopAutopilot, type AutopilotProof } from "@/lib/juno/autopilot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const OPTIONS = junoOptions;

/** `GET ?wallet=` — whether autopilot acts for this wallet, what its policy allows, its last runs. */
export async function GET(request: Request) {
  return junoHandler(async () => {
    const wallet = new URL(request.url).searchParams.get("wallet");
    if (!wallet) throw new CallerError("wallet is required");
    return junoJson(await autopilotStatus(wallet));
  });
}

/**
 * `POST {action: "start" | "confirm" | "stop", wallet, accessToken}`, with the
 * person's Privy session.
 */
export async function POST(request: Request) {
  return junoHandler(async () => {
    const body = await readJson<Record<string, unknown>>(request);
    const input = {
      wallet: requireString(body.wallet, "wallet"),
      accessToken: typeof body.accessToken === "string" ? body.accessToken : undefined,
    } satisfies { wallet: string } & AutopilotProof;
    switch (body.action) {
      case "start":
        return junoJson(await startAutopilot(input));
      case "confirm":
        return junoJson(await confirmAutopilot(input));
      case "stop":
        return junoJson(await stopAutopilot(input));
      default:
        throw new CallerError('action is one of "start", "confirm", "stop"');
    }
  });
}
