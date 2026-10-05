import { generateKeyPairSync } from "node:crypto";

import { toHex, type Address, type Hex } from "viem";

/**
 * A P-256 key pair in the form Privy takes for an authorization key: the
 * private key as base64 PKCS8 DER with no PEM headers (what
 * `authorization_context.authorization_private_keys` wants), the public key
 * as base64 SPKI DER (what a key quorum's `public_keys` wants).
 */
export function generateAuthorizationKey(): { privateKey: string; publicKey: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return {
    privateKey: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    publicKey: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
  };
}

/** The input to Privy's `wallets().ethereum().sendTransaction` for one autopilot call. */
export function privySendInput(
  call: { to: Address; data: Hex; value: bigint },
  options: { chainId: number; sponsor: boolean; authorizationKey: string },
) {
  return {
    caip2: `eip155:${options.chainId}` as const,
    params: { transaction: { to: call.to, data: call.data, value: toHex(call.value), chain_id: options.chainId } },
    sponsor: options.sponsor,
    authorization_context: { authorization_private_keys: [options.authorizationKey] },
  };
}
