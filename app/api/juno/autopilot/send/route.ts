import { CallerError, junoHandler, junoJson, junoOptions, readJson, requireString } from "@/lib/juno/api";
import { sendForWallet } from "@/lib/juno/autopilot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const OPTIONS = junoOptions;

/**
 * `POST {wallet, steps: [{to, data, value, label}], accessToken}` — send the
 * steps the server built for this wallet through autopilot, so Privy pays the
 * gas. Each must pass the wallet's policy. Answers `{results}` in order, as
 * `tx/submit` answers one.
 */
export async function POST(request: Request) {
  return junoHandler(async () => {
    const body = await readJson<Record<string, unknown>>(request);
    if (!Array.isArray(body.steps)) throw new CallerError("steps is required");
    const results = await sendForWallet({
      wallet: requireString(body.wallet, "wallet"),
      steps: body.steps as Array<{ to: string; data: string; value: string; label: string }>,
      accessToken: typeof body.accessToken === "string" ? body.accessToken : undefined,
      issuedAt: typeof body.issuedAt === "string" ? body.issuedAt : undefined,
      signature: typeof body.signature === "string" ? body.signature : undefined,
    });
    return junoJson({ results });
  });
}
