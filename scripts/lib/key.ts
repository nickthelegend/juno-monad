/**
 * The local key the juno:* scripts sign with.
 *
 * Read from `JUNO_SCRIPT_PRIVATE_KEY`, else from `.juno/launcher.key` (a hex
 * private key on one line; `.juno/` is gitignored). This module only *reads*;
 * creating a key when there is none is `scriptAccount()` in `./cli.ts`, so the
 * integration tests can look for a funded key without ever writing one.
 *
 * The key itself is never printed, logged or put in an error message.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { Hex } from "viem";

export const KEY_PATH = path.resolve(process.cwd(), ".juno/launcher.key");

const HEX_KEY = /^(0x)?[0-9a-fA-F]{64}$/;

function normalise(raw: string, source: string): Hex {
  const trimmed = raw.trim();
  if (!HEX_KEY.test(trimmed)) {
    // Say where the bad value came from, never what it was.
    throw new Error(`${source} is not a 32-byte hex private key`);
  }
  return (trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`) as Hex;
}

/** The configured key, or null when neither the env var nor the key file has one. */
export function readScriptKey(): Hex | null {
  const fromEnv = process.env.JUNO_SCRIPT_PRIVATE_KEY?.trim();
  if (fromEnv) return normalise(fromEnv, "JUNO_SCRIPT_PRIVATE_KEY");
  if (existsSync(KEY_PATH)) return normalise(readFileSync(KEY_PATH, "utf8"), KEY_PATH);
  return null;
}
