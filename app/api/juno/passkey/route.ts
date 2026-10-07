import { CallerError, junoHandler, junoJson, junoOptions, junoRead, readJson, requireString } from "@/lib/juno/api";
import { issueChallenge, verifyPasskeyLink } from "@/lib/juno/passkey-link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const OPTIONS = junoOptions;

/** `GET /passkey?wallet=` — a five-minute challenge for this wallet's passkey to sign. */
export async function GET(request: Request) {
  return junoRead(async () => junoJson(issueChallenge(requireString(new URL(request.url).searchParams.get("wallet"), "wallet"))));
}

/**
 * `POST /passkey {wallet, challenge, credentialId, publicKey: {x, y},
 * authenticatorData, clientDataJSON, signature, walletSignature}` — check the
 * passkey's assertion with Monad's P256 precompile and the wallet's
 * signature over the link, then record it. All byte fields are hex.
 */
export async function POST(request: Request) {
  return junoHandler(async () => {
    const body = await readJson<Record<string, unknown>>(request);
    const key = body.publicKey as { x?: unknown; y?: unknown } | undefined;
    if (!key || typeof key.x !== "string" || typeof key.y !== "string") throw new CallerError("publicKey {x, y} is required");
    return junoJson(
      await verifyPasskeyLink({
        wallet: requireString(body.wallet, "wallet"),
        challenge: requireString(body.challenge, "challenge"),
        credentialId: requireString(body.credentialId, "credentialId"),
        publicKey: { x: key.x, y: key.y },
        authenticatorData: requireString(body.authenticatorData, "authenticatorData"),
        clientDataJSON: requireString(body.clientDataJSON, "clientDataJSON"),
        signature: requireString(body.signature, "signature"),
        walletSignature: requireString(body.walletSignature, "walletSignature"),
      }),
    );
  });
}
