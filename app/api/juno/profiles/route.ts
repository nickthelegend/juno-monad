import { getAddress, isAddress } from "viem";

import { junoHandler, junoJson, junoOptions, readJson, requireString } from "@/lib/juno/api";
import { claimName, namesFor } from "@/lib/juno/profiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const OPTIONS = junoOptions;

/**
 * `GET ?wallets=a,b,c` — names for up to 100 wallets. Wallets without one are
 * absent. Names are stored against the checksummed address, so that is the
 * spelling the answer is keyed by, whatever case the query used.
 */
export async function GET(request: Request) {
  return junoHandler(async () => {
    const wallets = (new URL(request.url).searchParams.get("wallets") ?? "")
      .split(",")
      .map((wallet) => wallet.trim())
      .filter((wallet) => isAddress(wallet))
      .map((wallet) => getAddress(wallet))
      .slice(0, 100);
    return junoJson({ names: await namesFor([...new Set(wallets)]) });
  });
}

/**
 * `POST {wallet, name, issuedAt, signature}` — claim or change a name.
 *
 * `signature` is an EIP-191 `personal_sign` of `nameMessage(wallet, name,
 * issuedAt)` by the wallet itself, so no one can rename someone else and there
 * is no password to lose.
 */
export async function POST(request: Request) {
  return junoHandler(async () => {
    const body = await readJson<Record<string, unknown>>(request);
    const result = await claimName({
      wallet: requireString(body.wallet, "wallet"),
      name: requireString(body.name, "name"),
      issuedAt: requireString(body.issuedAt, "issuedAt"),
      signature: requireString(body.signature, "signature"),
    });
    return junoJson(result);
  });
}
