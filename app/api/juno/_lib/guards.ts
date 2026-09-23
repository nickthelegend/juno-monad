import { isAddress, isHash, getAddress, type Address, type Hex } from "viem";

import { CallerError, junoError } from "@/lib/juno/api";
import { launchpadConfigured } from "@/lib/juno/launchpad";

/**
 * Small checks every chain-facing route repeats.
 *
 * This lives beside the routes (an `_`-prefixed folder is never routed) rather
 * than in `lib/juno`, because it is about how a *route* answers, not about the
 * chain.
 */

export const LAUNCHPAD_MISSING = "The Juno launchpad is not configured on this server.";

/**
 * A 503 when `NEXT_PUBLIC_JUNO_LAUNCHPAD` is unset, or null when it is set.
 *
 * Without it, every read that needs the launchpad throws a plain `Error` from
 * `requireLaunchpad()`, which surfaces as a 500 — "something broke on our
 * side" — when the truth is that this deployment was never pointed at a
 * contract. That is an operator's problem with a one-line fix, and the answer
 * should say so rather than read like a crash.
 */
export function launchpadMissing(): Response | null {
  return launchpadConfigured() ? null : junoError(LAUNCHPAD_MISSING, 503);
}

/** A checksummed address from a caller-supplied string, or a 400 with a sentence. */
export function requireAddress(value: unknown, field: string): Address {
  if (typeof value !== "string" || !isAddress(value.trim())) {
    throw new CallerError(`Not a Monad address: ${field}`);
  }
  return getAddress(value.trim());
}

/**
 * A transaction hash, lowercased — the spelling viem gives every log and
 * receipt, so a hash from the phone and one from the chain compare equal.
 */
export function requireTxHash(value: unknown, field: string): Hex {
  if (typeof value !== "string" || !isHash(value.trim())) {
    throw new CallerError(`"${field}" must be a transaction hash (0x followed by 64 hex characters)`);
  }
  return value.trim().toLowerCase() as Hex;
}
