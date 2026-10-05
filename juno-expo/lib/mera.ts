import { createPasskeyWithPrfOutput, getPasskeyPrfOutput, isMeraError, createSecp256k1SigningSession } from "@category-labs/mera";
import { toViemAccount } from "@category-labs/mera/viem";
import { HDKey } from "@scure/bip32";
import { entropyToMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { Platform } from "react-native";
import type { LocalAccount } from "viem";

import type { Address } from "./api";
import type { Signer, SignerSource } from "./wallet";

/**
 * A passkey account, through Mera (Category Labs' passkey library).
 *
 * The passkey is the whole account: no seed phrase to write down, no browser
 * extension, nothing held by a server. One passkey ceremony gives Mera's
 * WebAuthn PRF output — 32 bytes the authenticator derives from the passkey
 * and the site, the same every time — and that is turned into a standard
 * wallet: BIP-39 entropy → seed → BIP-44 account `m/44'/60'/0'/0/0`. So the
 * same passkey on any device, or after this browser's storage is cleared,
 * comes back as the same address; and the account is an ordinary EVM key any
 * wallet could import.
 *
 * ## Signing sessions
 *
 * Asking for the passkey on every trade would make a feed of one-tap buys
 * unusable, so an unlock opens a **signing session**: Mera keeps the derived
 * key and signs without further prompts until the session ends — after
 * `SESSION_MS`, or when the person ends it. Ending zeroes the key. The next
 * signature after that asks for the passkey once, checks it is the same
 * account, and opens a new session. The PRF output and the seed are wiped as
 * soon as the key is derived; only the address and the credential id are
 * stored, and neither is a secret.
 *
 * Web only for now: a phone build needs the passkey domain wired into the app
 * (associated domains on iOS, asset links on Android). Elsewhere `available`
 * is false and the option is not offered.
 */

/** How long a session signs without asking again. */
export const SESSION_MS = 15 * 60_000;

const STORE_KEY = "juno.mera.v1";
const PATH = "m/44'/60'/0'/0/0";

type Stored = { address: Address; credentialId: string };

export type MeraSessionState = {
  /** The account this browser last used, if any (not a secret). */
  address: Address | null;
  /** Unix ms the open session ends; null when locked. */
  expiresAt: number | null;
};

let session: { account: LocalAccount; end: () => void; expiresAt: number; timer: ReturnType<typeof setTimeout> } | null = null;
const listeners = new Set<(state: MeraSessionState) => void>();

/** Whether this platform can run Mera's passkey ceremonies (WebAuthn with PRF). */
export function meraAvailable(): boolean {
  return Platform.OS === "web" && typeof globalThis.PublicKeyCredential !== "undefined" && Boolean(globalThis.navigator?.credentials);
}

function readStored(): Stored | null {
  try {
    const raw = globalThis.localStorage?.getItem(STORE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<Stored>) : null;
    return parsed?.address && parsed.credentialId ? { address: parsed.address, credentialId: parsed.credentialId } : null;
  } catch {
    return null;
  }
}

function writeStored(value: Stored | null) {
  try {
    if (value) globalThis.localStorage?.setItem(STORE_KEY, JSON.stringify(value));
    else globalThis.localStorage?.removeItem(STORE_KEY);
  } catch {
    // Private browsing: the account still works for this visit, and the passkey brings it back next time.
  }
}

export function meraState(): MeraSessionState {
  const stored = readStored();
  return { address: stored?.address ?? null, expiresAt: session && session.expiresAt > Date.now() ? session.expiresAt : null };
}

function emit() {
  const state = meraState();
  for (const listener of listeners) listener(state);
}

export function onMeraState(listener: (state: MeraSessionState) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** End the session now: Mera zeroes the key. The account stays; the next signature asks for the passkey. */
export function endMeraSession() {
  if (!session) return;
  clearTimeout(session.timer);
  session.end();
  session = null;
  emit();
}

function relyingPartyId(): string {
  return globalThis.location?.hostname ?? "localhost";
}

/** PRF output → the account's private key, wiping every intermediate. */
function deriveKey(prfOutput: Uint8Array): Uint8Array {
  const mnemonic = entropyToMnemonic(prfOutput, wordlist);
  const seed = mnemonicToSeedSync(mnemonic);
  const child = HDKey.fromMasterSeed(seed).derive(PATH);
  const key = child.privateKey;
  seed.fill(0);
  prfOutput.fill(0);
  if (!key) throw new Error("The passkey did not yield a key.");
  return key;
}

function open(prfOutput: Uint8Array, credentialId: string): Address {
  const key = deriveKey(prfOutput);
  const signing = createSecp256k1SigningSession({ privateKey: key });
  key.fill(0);
  const account = toViemAccount(signing);
  endMeraSession();
  const expiresAt = Date.now() + SESSION_MS;
  session = { account, end: () => signing.end(), expiresAt, timer: setTimeout(endMeraSession, SESSION_MS) };
  writeStored({ address: account.address as Address, credentialId });
  emit();
  return account.address as Address;
}

/** Words for what went wrong in a ceremony, not Mera's error codes. */
function explain(error: unknown): Error {
  if (isMeraError(error)) {
    if (error.code === "PRF_UNAVAILABLE") {
      return new Error("This browser's passkeys can't make a Mera account (no PRF). Try Safari with iCloud Keychain, or Chrome with Google Password Manager.");
    }
    if (error.code === "PASSKEY_OPERATION_FAILED") return new Error("The passkey prompt was closed or failed. Try again.");
  }
  return error instanceof Error ? error : new Error(String(error));
}

/** A new passkey, and the account it makes. One prompt (two on authenticators that can't evaluate PRF at creation). */
export async function createMeraAccount(): Promise<Address> {
  try {
    const created = await createPasskeyWithPrfOutput({
      rp: { id: relyingPartyId(), name: "Juno" },
      user: { name: `Juno account ${new Date().toISOString().slice(0, 10)}`, displayName: "Juno" },
    });
    return open(created.prfOutput, created.credentialId);
  } catch (error) {
    throw explain(error);
  }
}

/**
 * Unlock with a passkey this person already has — any of theirs for this site,
 * picked in the system prompt. Works on a fresh device or after storage is
 * cleared, because the account is derived from the passkey alone.
 */
export async function unlockMeraAccount(expected?: Address | null): Promise<Address> {
  let result;
  try {
    result = await getPasskeyPrfOutput({ rpId: relyingPartyId() });
  } catch (error) {
    throw explain(error);
  }
  const address = open(result.prfOutput, result.credentialId);
  if (expected && address.toLowerCase() !== expected.toLowerCase()) {
    endMeraSession();
    writeStored({ address: expected, credentialId: readStored()?.credentialId ?? result.credentialId });
    throw new Error("That passkey belongs to a different Juno account. Pick the one you signed in with.");
  }
  return address;
}

/** The open session's account, unlocking first when it has ended. */
async function account(expected: Address): Promise<LocalAccount> {
  if (!session || session.expiresAt <= Date.now()) await unlockMeraAccount(expected);
  return session!.account;
}

function meraSigner(address: Address): Signer {
  return {
    address,
    mode: "mera",
    signTransaction: async (transaction) => (await account(address)).signTransaction!(transaction),
    signMessage: async (message) => (await account(address)).signMessage!({ message }),
  };
}

/** Mera as a wallet source: restores the last account (locked until it signs), creates one with a new passkey. */
export const meraSource: SignerSource = {
  mode: "mera",
  async restore() {
    const stored = readStored();
    return stored ? meraSigner(stored.address) : null;
  },
  async create() {
    return meraSigner(await createMeraAccount());
  },
  async forget() {
    endMeraSession();
    writeStored(null);
  },
};
