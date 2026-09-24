import { junoHandler, junoJson, junoOptions, readJson, requireString } from "@/lib/juno/api";
import { verifyPrivyIdentity } from "@/lib/juno/privy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const OPTIONS = junoOptions;

/**
 * `POST {wallet, accessToken}` — prove who owns `wallet` through Privy.
 *
 * `accessToken` is the Privy session's access token (`getAccessToken()` in the
 * app). The server verifies it with the app's secret, reads the Privy user,
 * and records the X handle linked to that login against `wallet` — but only
 * when `wallet` is one of that user's own wallets. Answers the identity now on
 * record: `{ twitter?, emailVerified, via: "privy", verifiedAt }`.
 */
export async function POST(request: Request) {
  return junoHandler(async () => {
    const body = await readJson<Record<string, unknown>>(request);
    const identity = await verifyPrivyIdentity({
      wallet: requireString(body.wallet, "wallet"),
      accessToken: requireString(body.accessToken, "accessToken"),
    });
    return junoJson({ identity });
  });
}
