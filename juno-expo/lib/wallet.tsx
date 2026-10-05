// First, before viem: its hashing library reads `globalThis.crypto` once, at
// import, and keeps whatever it found. See `./polyfills`.
import "./polyfills";

import type React from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import type { TransactionSerializableEIP1559 } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { sameAddress } from "./address";
import { juno, type Address, type Hex, type SubmitResult, type UnsignedTransaction } from "./api";
import { autopilotUnavailable, sponsoredSend } from "./autopilot-relay";

/**
 * The wallet.
 *
 * Juno's transactions are built on the server and signed here. This module owns
 * that second half: it holds a signer, turns the server's hex-encoded EIP-1559
 * requests into signed transactions, and hands the bytes back to be submitted.
 * The key never leaves the device, and what lands is an ordinary Monad
 * transaction anyone can check on MonadVision.
 *
 * ## One interface, more than one signer
 *
 * Everything the screens need from a wallet is an address and two signatures —
 * a transaction and a message — so that is all `Signer` asks for. The provider
 * never touches a key directly; it asks a `SignerSource` to restore, create or
 * forget one.
 *
 * **A local device key** is the only source today. It generates a secp256k1
 * key with viem, keeps it in the device keychain, and signs with it. That is
 * the one option that works everywhere this app is demoed — an iOS Simulator,
 * an Android emulator, a browser — with no account and no dashboard setup.
 *
 * **An embedded wallet** (Privy) or **a passkey wallet** (Mera) is the
 * intended replacement. Either one is a `SignerSource` whose signer forwards
 * the same `TransactionSerializableEIP1559` to its own `eth_signTransaction`
 * and the same text to `personal_sign`; pass it to `WalletProvider` and no
 * screen changes. `mode` is exposed so the UI can say which one it is.
 *
 * The local mode is **not a simulation**. It produces real secp256k1
 * signatures, lands real transactions on Monad testnet, and the explorer link
 * resolves. What it is not is a recoverable wallet — the key lives only on
 * this device and is worth nothing beyond testnet. The profile says exactly
 * that rather than implying a custody story it does not have.
 */

export type WalletMode = "local" | "privy" | "mera";

/** Something that can sign for exactly one address. */
export interface Signer {
  readonly address: Address;
  readonly mode: WalletMode;
  /** Sign a fully-specified EIP-1559 transaction; returns the serialised, signed bytes. */
  signTransaction(transaction: TransactionSerializableEIP1559): Promise<Hex>;
  /** EIP-191 `personal_sign` of UTF-8 text. */
  signMessage(message: string): Promise<Hex>;
  /** A Privy wallet's session token, so the server can act for it (autopilot). Privy signers only. */
  accessToken?: () => Promise<string | null>;
}

/** Where a signer comes from, and where it goes when the person signs out. */
export interface SignerSource {
  readonly mode: WalletMode;
  /**
   * The signer this device already has, or null when it has none.
   *
   * Throws when the store could not be *read* — which is not the same as it
   * being empty, and must never be treated as permission to create a new key
   * over one that is merely locked.
   */
  restore(): Promise<Signer | null>;
  /** Make one. Only called after `restore` said there is none. */
  create(): Promise<Signer>;
  forget(): Promise<void>;
}

/** Where a multi-step submit has got to, for a button label or a status line. */
export type StepProgress = {
  index: number;
  total: number;
  label: string;
  phase: "signing" | "submitting";
};

/**
 * A batch that stopped part-way.
 *
 * Steps are submitted in order, so when a later one fails the earlier ones are
 * already on chain — an approval that went through before its buy did not.
 * That is a different outcome from "nothing happened", and the caller gets
 * the receipts that did land alongside the reason the next one did not.
 */
export class PartialSubmitError extends Error {
  readonly landed: SubmitResult[];
  constructor(message: string, landed: SubmitResult[]) {
    super(message);
    this.name = "PartialSubmitError";
    this.landed = landed;
  }
}

export type WalletState = {
  /** EIP-55 checksummed. */
  address: Address | null;
  mode: WalletMode;
  ready: boolean;
  /** True while a signature is being produced. */
  signing: boolean;
  /** Create or restore a wallet. Called when the user first needs one. */
  connect: () => Promise<Address>;
  disconnect: () => Promise<void>;
  /** Sign one server-built step. Returns the signed transaction, ready for `submit`. */
  signStep: (step: UnsignedTransaction) => Promise<Hex>;
  /**
   * Sign a plain-text message (EIP-191 `personal_sign`).
   *
   * Used to prove ownership of this wallet off-chain — claiming a name — where
   * a transaction would cost gas to say nothing the chain needs to know.
   */
  signMessage: (message: string) => Promise<Hex>;
  /**
   * Sign every step, then submit them in order, each after the last answered.
   *
   * Signed up front because the nonces are already fixed and consecutive, so
   * nothing about step two depends on step one having landed — and a signer
   * that refuses step two should refuse before step one is on chain, not
   * after. Submitted one at a time because the server waits for each receipt,
   * and the second step is only valid once the first has confirmed.
   */
  signAndSubmit: (
    steps: UnsignedTransaction[],
    onStep?: (progress: StepProgress) => void,
    /** Each step's receipt, the moment it lands — for screens that show them as they come. */
    onLanded?: (result: SubmitResult, step: { index: number; total: number; label: string }) => void,
  ) => Promise<SubmitResult[]>;
};

const WalletContext = createContext<WalletState | null>(null);

/* ------------------------------------------------------------------ */
/* The local device key                                                */
/* ------------------------------------------------------------------ */

/**
 * Keychain entry holding the local key.
 *
 * A new name rather than the one the app's previous chain used: that entry
 * held an Ed25519 secret as a JSON byte array, which is not a secp256k1 key
 * and must never be parsed as one. It is left where it is, untouched.
 */
const LOCAL_KEY = "juno.monad.signer.v1";

/**
 * Where the key is kept: the keychain on a phone, `localStorage` on web.
 *
 * `expo-secure-store` ships an empty module for web, so every call threw and
 * the web build could never hold a wallet — likes, follows and trades all
 * failed at the first step without saying why. A testnet key in a browser's
 * storage is exactly as recoverable as one in a simulator's keychain, which
 * is to say not at all; the profile screen already says so.
 */
const store = {
  get: (key: string): Promise<string | null> =>
    Platform.OS === "web"
      ? Promise.resolve(globalThis.localStorage?.getItem(key) ?? null)
      : SecureStore.getItemAsync(key),
  set: (key: string, value: string): Promise<void> =>
    Platform.OS === "web"
      ? Promise.resolve(globalThis.localStorage?.setItem(key, value))
      : SecureStore.setItemAsync(key, value),
  remove: (key: string): Promise<void> =>
    Platform.OS === "web"
      ? Promise.resolve(globalThis.localStorage?.removeItem(key))
      : SecureStore.deleteItemAsync(key),
};

function localSigner(privateKey: Hex): Signer {
  const account = privateKeyToAccount(privateKey);
  return {
    address: account.address,
    mode: "local",
    signTransaction: (transaction) => account.signTransaction(transaction),
    signMessage: (message) => account.signMessage({ message }),
  };
}

/** A secp256k1 key generated on this device and kept in its keychain. */
export const localKeySource: SignerSource = {
  mode: "local",
  async restore() {
    const stored = await store.get(LOCAL_KEY);
    // A malformed entry is worth discarding rather than crashing the app on
    // boot; `create` overwrites it. A *failed read* throws above instead.
    if (!stored || !/^0x[0-9a-fA-F]{64}$/.test(stored)) return null;
    try {
      return localSigner(stored as Hex);
    } catch {
      return null;
    }
  },
  async create() {
    const key = generatePrivateKey();
    await store.set(LOCAL_KEY, key);
    return localSigner(key);
  },
  forget: () => store.remove(LOCAL_KEY),
};

/* ------------------------------------------------------------------ */
/* Signing                                                             */
/* ------------------------------------------------------------------ */

/**
 * The server's JSON request, as viem wants it.
 *
 * Every quantity crosses the wire as hex so it survives JSON; viem's
 * serialiser wants bigints. `from` is not part of a signed transaction at all
 * — the signature determines it — so it is checked against the signer rather
 * than passed along.
 */
function toSerializable(step: UnsignedTransaction): TransactionSerializableEIP1559 {
  const { request } = step;
  return {
    type: "eip1559",
    chainId: request.chainId,
    to: request.to,
    data: request.data,
    value: BigInt(request.value),
    nonce: request.nonce,
    gas: BigInt(request.gas),
    maxFeePerGas: BigInt(request.maxFeePerGas),
    maxPriorityFeePerGas: BigInt(request.maxPriorityFeePerGas),
  };
}

export function WalletProvider({
  children,
  source = localKeySource,
}: {
  children: React.ReactNode;
  /** Swap in an embedded or passkey wallet here; nothing downstream changes. */
  source?: SignerSource;
}) {
  const [signer, setSigner] = useState<Signer | null>(null);
  const [ready, setReady] = useState(false);
  const [signing, setSigning] = useState(false);
  /** The live signer, for callbacks that must not wait on a re-render. */
  const current = useRef<Signer | null>(null);
  /**
   * One connect at a time. A like and a follow tapped together on a fresh
   * install each found no key and each generated one; the second overwrote
   * the first in the keychain while the first's address was already on a
   * row on the server.
   */
  const connecting = useRef<Promise<Signer> | null>(null);

  const adopt = useCallback((next: Signer | null) => {
    current.current = next;
    setSigner(next);
  }, []);

  // Restore an existing key on boot so a returning user keeps their balance
  // and their position history.
  useEffect(() => {
    let cancelled = false;
    // A new source starts from nothing. Switching from the device key to
    // Privy kept the device key's signer, and its `ready`, while Privy was
    // still starting: the profile offered "Sign in" on a provider that had
    // not restored yet, and a trade in between signed with the old key.
    adopt(null);
    setReady(false);
    connecting.current = null;
    source
      .restore()
      .then((existing) => {
        if (!cancelled) adopt(existing);
      })
      // A keychain that will not answer yet (a phone still locked after a
      // restart) leaves the wallet absent for now. `connect` reads again.
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [source, adopt]);

  const ensure = useCallback((): Promise<Signer> => {
    if (current.current) return Promise.resolve(current.current);
    if (!connecting.current) {
      connecting.current = (async () => {
        const next = (await source.restore()) ?? (await source.create());
        adopt(next);
        return next;
      })().finally(() => {
        connecting.current = null;
      });
    }
    return connecting.current;
  }, [source, adopt]);

  /** The signer that exists, never a new one: something built for an address needs *that* key. */
  const existing = useCallback(async (): Promise<Signer> => {
    const found = current.current ?? (await source.restore());
    if (!found) throw new Error("No wallet to sign with");
    if (!current.current) adopt(found);
    return found;
  }, [source, adopt]);

  const connect = useCallback(async () => (await ensure()).address, [ensure]);

  const disconnect = useCallback(async () => {
    await source.forget();
    adopt(null);
  }, [source, adopt]);

  const signStep = useCallback(
    async (step: UnsignedTransaction) => {
      const active = await existing();
      // The server builds for the address it was given. A mismatch means the
      // build belongs to a different wallet — a stale screen after a reset —
      // and signing it would only produce a transaction the chain rejects.
      if (!sameAddress(step.request.from, active.address)) {
        throw new Error("This transaction was built for a different wallet. Close it and try again.");
      }
      setSigning(true);
      try {
        return await active.signTransaction(toSerializable(step));
      } finally {
        setSigning(false);
      }
    },
    [existing],
  );

  const signMessage = useCallback(
    async (message: string) => {
      const active = await existing();
      setSigning(true);
      try {
        return await active.signMessage(message);
      } finally {
        setSigning(false);
      }
    },
    [existing],
  );

  const signAndSubmit = useCallback(
    async (
      steps: UnsignedTransaction[],
      onStep?: (progress: StepProgress) => void,
      onLanded?: (result: SubmitResult, step: { index: number; total: number; label: string }) => void,
    ) => {
      const total = steps.length;

      // A Privy wallet on autopilot while Privy sponsors gas: Juno sends the
      // steps for it, inside its policy, and the person needs no MON. If
      // autopilot has since been switched off or expired, sign as usual.
      const sponsored = steps.length > 0 && sameAddress(steps[0].request.from, current.current?.address ?? "")
        ? sponsoredSend(current.current!)
        : null;
      if (sponsored) {
        onStep?.({ index: 0, total, label: steps[0].label, phase: "submitting" });
        try {
          const results = await sponsored(steps);
          results.forEach((result, index) => {
            onLanded?.(result, { index, total, label: steps[index].label });
          });
          return results;
        } catch (caught) {
          if (!autopilotUnavailable(caught)) throw caught;
        }
      }

      const signed: Hex[] = [];
      for (const [index, step] of steps.entries()) {
        onStep?.({ index, total, label: step.label, phase: "signing" });
        signed.push(await signStep(step));
      }

      const landed: SubmitResult[] = [];
      for (const [index, bytes] of signed.entries()) {
        onStep?.({ index, total, label: steps[index].label, phase: "submitting" });
        try {
          const result = await juno.submit({ signed: bytes });
          landed.push(result);
          onLanded?.(result, { index, total, label: steps[index].label });
        } catch (caught) {
          const reason = caught instanceof Error ? caught.message : "the network refused it";
          if (landed.length === 0) throw caught;
          throw new PartialSubmitError(
            `${steps[index - 1].label} went through, but ${steps[index].label.toLowerCase()} did not: ${reason}`,
            landed,
          );
        }
      }
      return landed;
    },
    [signStep],
  );

  const value = useMemo<WalletState>(
    () => ({
      address: signer?.address ?? null,
      mode: signer?.mode ?? source.mode,
      ready,
      signing,
      connect,
      disconnect,
      signStep,
      signMessage,
      signAndSubmit,
    }),
    [signer, source.mode, ready, signing, connect, disconnect, signStep, signMessage, signAndSubmit],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletState {
  const context = useContext(WalletContext);
  if (!context) throw new Error("useWallet must be used inside a WalletProvider");
  return context;
}
