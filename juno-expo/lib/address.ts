// First, before viem: its hashing library reads `globalThis.crypto` once, at
// import, and keeps whatever it found. See `./polyfills`.
import "./polyfills";

import { getAddress, isAddress } from "viem";

import type { Address } from "./api";

/**
 * Monad addresses, as the app compares and checks them.
 *
 * An EVM address has one canonical spelling (EIP-55, mixed case) and any
 * number of equivalent ones — all lower case from a pasted link, all upper
 * case from someone's QR code. The server answers in checksummed form and
 * viem produces checksummed form, but a route param is whatever was typed.
 * Comparing two of them with `===` said "not you" on your own profile the
 * first time a lower-cased link was opened, so every comparison goes through
 * here instead.
 */

/**
 * The checksummed form of anything that is an address, or null.
 *
 * Not strict about the checksum: a lower-cased address is a real address that
 * lost its capitals in transit, and turning it away would be unhelpful. A
 * mixed-case string with a *wrong* checksum is still accepted and repaired —
 * the server normalises the same way, with `getAddress`.
 */
export function toAddress(value: string | null | undefined): Address | null {
  if (!value || !isAddress(value, { strict: false })) return null;
  return getAddress(value);
}

/** Same account, whatever the casing. False when either side is missing. */
export function sameAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}
