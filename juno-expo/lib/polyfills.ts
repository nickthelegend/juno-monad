/**
 * What viem needs that React Native does not have, installed before anything else.
 *
 * `crypto.getRandomValues` — viem's `generatePrivateKey` draws the key from
 * it, and Hermes has no Web Crypto at all. `react-native-get-random-values`
 * installs one backed by the platform's secure random source. It must be
 * imported for its side effect, and it must come first: `@noble/hashes`,
 * which viem signs and hashes with, reads `globalThis.crypto` once when it is
 * first imported and keeps what it found. Imported after it, the polyfill is
 * too late, and the first wallet created throws "crypto.getRandomValues must
 * be defined" instead of being created.
 *
 * Nothing else is needed. Signing is deterministic (RFC 6979), so it draws no
 * randomness; `TextEncoder`/`TextDecoder` come from Expo's own runtime; and
 * viem works in bigints and `Uint8Array`s, never Node's `Buffer`, so the
 * `Buffer` shim the previous chain's client needed is gone. In a browser the
 * real `crypto` already exists and the import below leaves it alone.
 *
 * This file is imported at the very top of the root layout for that reason —
 * and again at the top of every module that imports viem, because nothing
 * guarantees the root layout is evaluated before every route that reaches
 * viem. A module is only ever evaluated once, so the repeats cost nothing.
 * Ordering here is not stylistic — it is the difference between a working app
 * and a crash on the first wallet.
 */

import "react-native-get-random-values";
