import type { ReactNode } from "react";

import type { SignerSource } from "./wallet";

/**
 * Privy, as the app sees it: a way to log in, and a `SignerSource` whose
 * signer is the person's Privy embedded wallet.
 *
 * The shared types, and a stub that reports Privy unavailable. At runtime
 * neither platform uses the stub: iOS and Android resolve `privy.native.tsx`
 * (email sign-in, `@privy-io/expo`, which needs a development build rather
 * than Expo Go) and the web resolves `privy.web.tsx` (`@privy-io/react-auth`).
 * TypeScript and the unit tests see this file.
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
  /**
   * Add a session signer to the embedded wallet: a key the server holds,
   * limited by a Privy policy (autopilot). Removing takes every signer off.
   */
  addSigner: (signerId: string, policyId: string) => Promise<void>;
  removeSigners: () => Promise<void>;
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
  addSigner: () => Promise.reject(new Error("Privy is not available here")),
  removeSigners: () => Promise.resolve(),
};

export function PrivyBridge({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function usePrivyWallet(): PrivyState {
  return UNAVAILABLE;
}
