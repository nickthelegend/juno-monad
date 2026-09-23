import { isHex } from "viem";

import { submitSigned } from "@/lib/juno/tx";
import {
  CallerError,
  junoHandler,
  junoJson,
  junoOptions,
  readJson,
  requireString,
} from "@/lib/juno/api";

export const dynamic = "force-dynamic";
export const OPTIONS = junoOptions;

/**
 * Submit a transaction the device signed, and wait for it to confirm.
 *
 * `POST {signed}` where `signed` is the serialized, signed EIP-1559
 * transaction as `0x…` hex — exactly what viem's `signTransaction` returns.
 *
 * This server never holds the key that signed these bytes. It checks the chain
 * id, broadcasts them, waits for the receipt (Monad finalises in about a
 * second), records any trades the receipt carries, and drops the caches for
 * the pools that just moved so the next read is live. A launch comes back with
 * `launched`, which is the app's cue to index the coin with `POST pools`.
 *
 * Steps from one build must be submitted in order, each after the previous one
 * answered: their nonces are consecutive, and a later one sent first is only
 * held by the node until the gap fills.
 */
export async function POST(request: Request) {
  return junoHandler(async () => {
    const body = await readJson<Record<string, unknown>>(request);
    const signed = requireString(body.signed, "signed");
    if (!isHex(signed) || signed.length < 4) {
      throw new CallerError('"signed" must be a signed transaction as 0x-prefixed hex');
    }

    const result = await submitSigned({ signed });
    return junoJson(result);
  });
}
