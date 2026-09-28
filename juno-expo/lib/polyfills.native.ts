/**
 * What viem and Privy need that Hermes does not have, installed before
 * anything else on iOS and Android. The web build resolves `polyfills.ts`.
 *
 * - `crypto.getRandomValues`: viem's `generatePrivateKey` and Privy both draw
 *   randomness from it. `react-native-get-random-values` must come first:
 *   `@noble/hashes` reads `globalThis.crypto` once, when it is first imported,
 *   and keeps what it found (see `polyfills.ts`).
 * - `TextEncoder`/`TextDecoder`: Privy encodes and decodes text before Hermes
 *   has them.
 * - `Buffer`: Privy's core SDK calls the global `Buffer` in its EVM signing
 *   path (hex-encoding messages and typed transactions).
 *
 * Imported at the very top of the root layout, and by every module that
 * imports viem. A module is evaluated once, so the repeats cost nothing.
 */

import "react-native-get-random-values";
import "fast-text-encoding";
import { Buffer } from "buffer";

const scope = globalThis as { Buffer?: unknown };
if (typeof scope.Buffer === "undefined") scope.Buffer = Buffer;

export {};
