import type { ReactNode } from "react";

import type { SignerSource } from "./wallet";

/**
 * Privy, as the app sees it: a way to log in, and a `SignerSource` whose
 * signer is the person's Privy embedded wallet.
 *
 * This file is the native build's: Privy's React Native SDK needs an Expo
 * development build (native modules Expo Go does not carry), so iOS and
 * Android keep the device key for now and report Privy as unavailable. The
 * web build resolves `privy.web.tsx` instead, where it is real.
 */
export type PrivyIdentity = {
  /** The login's own labels — shown to the person, never published. */
  email?: string;
  google?: string;
  /** An X account linked through Privy's OAuth: public by nature, and what a profile can show. */
  twitter?: string;
};

export type PrivyState = {
  /** Configured (`EXPO_PUBLIC_PRIVY_APP_ID`) and supported on this platform. */
  available: boolean;
  ready: boolean;
  authenticated: boolean;
  identity: PrivyIdentity | null;
  /** The embedded wallet's address, once there is one. */
  address: string | null;
  /** Signs with the Privy embedded wallet. Null where Privy is unavailable. */
  source: SignerSource | null;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  /** The session's access token, for the server to verify who this is. */
  getAccessToken: () => Promise<string | null>;
};

const UNAVAILABLE: PrivyState = {
  available: false,
  ready: true,
  authenticated: false,
  identity: null,
  address: null,
  source: null,
  login: () => Promise.reject(new Error("Privy sign-in is on the web build for now")),
  logout: () => Promise.resolve(),
  getAccessToken: () => Promise.resolve(null),
};

export function PrivyBridge({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function usePrivyWallet(): PrivyState {
  return UNAVAILABLE;
}
