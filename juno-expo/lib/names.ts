import { useEffect, useState } from "react";

import { api } from "./api";

/**
 * Names for wallets, read in batches and remembered.
 *
 * Every card, reel, comment and ranking shows a person. Asking the server one
 * wallet at a time would be a request per row; instead the wallets a screen
 * asks about in the same tick are collected into one request, and the answer
 * is kept for the session. A wallet with no name is remembered as having
 * none, so it is not asked about again on every render.
 */
const known = new Map<string, string | null>();
const listeners = new Map<string, Set<(name: string | null) => void>>();

/**
 * Who a wallet is, as verified through Privy (`POST profiles/privy`): an X
 * handle Privy checked by OAuth. Arrives in the same batched answer as names.
 */
export type Identity = { twitter?: string; emailVerified: boolean; via: "privy"; verifiedAt: string };
const knownIdentities = new Map<string, Identity | null>();
const identityListeners = new Map<string, Set<(identity: Identity | null) => void>>();
let queue = new Set<string>();
let scheduled = false;

function flush() {
  scheduled = false;
  const batch = [...queue];
  queue = new Set();
  if (batch.length === 0) return;
  api
    .get<{ names: Record<string, string>; identities?: Record<string, Identity> }>(
      `/api/juno/profiles?wallets=${batch.join(",")}`,
    )
    .then(({ names, identities }) => {
      for (const wallet of batch) {
        publish(wallet, names[wallet] ?? null);
        publishIdentity(wallet, identities?.[wallet] ?? null);
      }
    })
    // A failed read leaves these unknown, so a later screen can ask again.
    .catch(() => undefined);
}

function publish(wallet: string, name: string | null) {
  known.set(wallet, name);
  listeners.get(wallet)?.forEach((listener) => {
    listener(name);
  });
}

function request(wallet: string) {
  if (known.has(wallet) || queue.has(wallet)) return;
  queue.add(wallet);
  // A microtask, not a timer: every effect in one render commit runs before
  // it, so a whole screen's wallets still go in one request — and it is not
  // subject to the throttling browsers apply to timers in background tabs.
  if (!scheduled) {
    scheduled = true;
    queueMicrotask(flush);
  }
}

function publishIdentity(wallet: string, identity: Identity | null) {
  knownIdentities.set(wallet, identity);
  identityListeners.get(wallet)?.forEach((listener) => {
    listener(identity);
  });
}

/** After a Privy verification, so the badge appears without a reload. */
export function rememberIdentity(wallet: string, identity: Identity) {
  publishIdentity(wallet, identity);
}

/** The identity verified for this wallet, or null while unknown or when there is none. */
export function useIdentity(wallet: string | null | undefined): Identity | null {
  const [identity, setIdentity] = useState<Identity | null>(wallet ? (knownIdentities.get(wallet) ?? null) : null);
  useEffect(() => {
    if (!wallet) {
      setIdentity(null);
      return;
    }
    setIdentity(knownIdentities.get(wallet) ?? null);
    const set = identityListeners.get(wallet) ?? new Set();
    set.add(setIdentity);
    identityListeners.set(wallet, set);
    request(wallet);
    return () => {
      set.delete(setIdentity);
    };
  }, [wallet]);
  return identity;
}

/** After a successful claim, so every row showing this wallet updates at once. */
export function rememberName(wallet: string, name: string) {
  publish(wallet, name);
}

/**
 * The short form of an address, for anyone without a name: `0x1a2b…9f3e`.
 * Six characters in front, because the first two are always `0x` and say
 * nothing about whose wallet it is.
 */
export function shortAddress(wallet: string): string {
  return `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
}

/** This wallet's name, or null while unknown or when it has none. */
export function useName(wallet: string | null | undefined): string | null {
  const [name, setName] = useState<string | null>(wallet ? (known.get(wallet) ?? null) : null);

  useEffect(() => {
    if (!wallet) {
      setName(null);
      return;
    }
    setName(known.get(wallet) ?? null);
    const set = listeners.get(wallet) ?? new Set();
    set.add(setName);
    listeners.set(wallet, set);
    request(wallet);
    return () => {
      set.delete(setName);
    };
  }, [wallet]);

  return name;
}

/** What to print for a person: their name, or their short address. */
export function useHandle(wallet: string | null | undefined): string {
  const name = useName(wallet);
  if (!wallet) return "";
  return name ?? shortAddress(wallet);
}
