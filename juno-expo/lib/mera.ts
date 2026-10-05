import {
  createPasskeyWithPrfOutput,
  createSecp256k1SigningSession,
  createSecretVaultWithExistingPasskey,
  decryptSecretVaultWithPasskey,
  getPasskeyPrfOutput,
  isMeraError,
  parseSecretVault,
} from "@category-labs/mera";
import { toViemAccount } from "@category-labs/mera/viem";
import { HDKey } from "@scure/bip32";
import { entropyToMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import type { LocalAccount } from "viem";

import type { Address } from "./api";
import { passkeysSupported, webAuthnClient } from "./mera-client";
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
 * On iOS and Android the ceremonies go through Mera's React Native client
 * (`mera-client.native.ts`) against `PASSKEY_RP_ID`, the web app's domain, so
 * the same passkey is the same account in the browser and on the phone. That
 * needs the domain associated with the app (an Apple team for the iOS
 * entitlement, the release signing certificate for Android's asset links;
 * see `scripts/passkey-domain.mjs`). Sealed drafts stay web-only: Mera's
 * secret vaults call `navigator.credentials` directly.
 */

/** How long a session signs without asking again. */
export const SESSION_MS = 15 * 60_000;

const STORE_KEY = "juno.mera.v1";

/**
 * The relying party on a phone: the web app's domain, which the app is
 * associated with. `EXPO_PUBLIC_PASSKEY_RP_ID` overrides it.
 */
export const PASSKEY_RP_ID = process.env.EXPO_PUBLIC_PASSKEY_RP_ID?.trim() || "juno-monad-app.vercel.app";
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
  return passkeysSupported();
}

/** Where the account's (public) address and credential id live: the browser's storage, or the keychain on a phone. */
const store = {
  get: (): string | null =>
    Platform.OS === "web" ? (globalThis.localStorage?.getItem(STORE_KEY) ?? null) : SecureStore.getItem(STORE_KEY.replace(/[^\w.-]/g, "_")),
  set: (value: string) =>
    Platform.OS === "web" ? globalThis.localStorage?.setItem(STORE_KEY, value) : SecureStore.setItem(STORE_KEY.replace(/[^\w.-]/g, "_"), value),
  remove: () =>
    Platform.OS === "web" ? globalThis.localStorage?.removeItem(STORE_KEY) : void SecureStore.deleteItemAsync(STORE_KEY.replace(/[^\w.-]/g, "_")),
};

function readStored(): Stored | null {
  try {
    const raw = store.get();
    const parsed = raw ? (JSON.parse(raw) as Partial<Stored>) : null;
    return parsed?.address && parsed.credentialId ? { address: parsed.address, credentialId: parsed.credentialId } : null;
  } catch {
    return null;
  }
}

function writeStored(value: Stored | null) {
  try {
    if (value) store.set(JSON.stringify(value));
    else store.remove();
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
  return Platform.OS === "web" ? (globalThis.location?.hostname ?? "localhost") : PASSKEY_RP_ID;
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
      return new Error(
        Platform.OS === "ios"
          ? "This iPhone's passkeys can't make a Mera account (no PRF). It needs iOS 18 or later with iCloud Keychain."
          : Platform.OS === "android"
            ? "This phone's passkeys can't make a Mera account (no PRF). Use Google Password Manager as the passkey provider."
            : "This browser's passkeys can't make a Mera account (no PRF). Try Safari with iCloud Keychain, or Chrome with Google Password Manager.",
      );
    }
    if (error.code === "PASSKEY_OPERATION_FAILED") {
      return new Error(
        Platform.OS === "web"
          ? "The passkey prompt was closed or failed. Try again."
          : `The passkey prompt was closed or failed. If it keeps failing, this build is not yet associated with ${PASSKEY_RP_ID}.`,
      );
    }
  }
  return error instanceof Error ? error : new Error(String(error));
}

/** A new passkey, and the account it makes. One prompt (two on authenticators that can't evaluate PRF at creation). */
export async function createMeraAccount(): Promise<Address> {
  try {
    const created = await createPasskeyWithPrfOutput({
      rp: { id: relyingPartyId(), name: "Juno" },
      user: { name: `Juno account ${new Date().toISOString().slice(0, 10)}`, displayName: "Juno" },
      webAuthnClient,
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
  let result: Awaited<ReturnType<typeof getPasskeyPrfOutput>>;
  try {
    result = await getPasskeyPrfOutput({ rpId: relyingPartyId(), webAuthnClient });
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

/* ------------------------------------------------------------------ */
/* One passkey, more keys: secrets sealed under their own PRF salts    */
/* ------------------------------------------------------------------ */

/**
 * Encrypt bytes to this account's passkey (one prompt). Mera picks a fresh
 * random PRF salt for every vault, so each secret has its own key and none of
 * them is the wallet's. Returns the vault as JSON text — ciphertext, nonce,
 * salt and the passkey's id; nothing in it opens without the passkey.
 */
/** Whether sealed drafts work here: Mera's secret vaults run in the browser only. */
export function sealedDraftsAvailable(): boolean {
  return Platform.OS === "web" && meraAvailable();
}

export async function sealSecret(secret: Uint8Array): Promise<string> {
  if (!sealedDraftsAvailable()) throw new Error("Sealed drafts open in the web app for now.");
  const stored = readStored();
  if (!stored) throw new Error("Make or unlock a passkey account first.");
  try {
    const vault = await createSecretVaultWithExistingPasskey({
      rpId: relyingPartyId(),
      credential: { credentialId: stored.credentialId },
      secret,
    });
    return JSON.stringify(vault);
  } catch (error) {
    throw explain(error);
  }
}

/** Open a vault sealed by `sealSecret`: one prompt, on any device that has the passkey. */
export async function openSecret(vaultJson: string): Promise<Uint8Array> {
  if (!sealedDraftsAvailable()) throw new Error("Sealed drafts open in the web app for now.");
  try {
    return await decryptSecretVaultWithPasskey({ rpId: relyingPartyId(), vault: parseSecretVault(vaultJson) });
  } catch (error) {
    throw explain(error);
  }
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
