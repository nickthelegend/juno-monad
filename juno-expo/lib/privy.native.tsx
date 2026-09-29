import {
  PrivyProvider,
  useEmbeddedEthereumWallet,
  useEmbeddedWallet,
  useLoginWithEmail,
  usePrivy,
} from "@privy-io/expo";
import * as Application from "expo-application";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getAddress, parseTransaction, toHex, type Hex } from "viem";
import { monad, monadTestnet } from "viem/chains";

import { SignInSheet } from "../components/SignInSheet";
import type { PrivyIdentity, PrivyState } from "./privy";
import type { Signer, SignerSource } from "./wallet";

export type { PrivyIdentity, PrivyState } from "./privy";

/**
 * Privy on iOS and Android: sign in with email, get an embedded EVM wallet,
 * and sign every launch, trade and claim with it.
 *
 * The same contract as the web build (`privy.web.tsx`): Juno's server builds
 * each transaction, nonce and fees included, and this signer only signs it —
 * `eth_signTransaction` on the embedded wallet's provider — so the server can
 * submit it with `eth_sendRawTransactionSync` and measure the confirmation as
 * it does for every other wallet. Privy holds the key, not the phone, so the
 * wallet survives a reinstall or a new phone.
 *
 * There is no hosted modal on a phone, so sign-in is Juno's own sheet
 * (`components/SignInSheet.tsx`): an email address, the six-digit code Privy
 * sends to it, then a short wait while the wallet is made.
 *
 * Which Privy app. The web build uses `EXPO_PUBLIC_PRIVY_APP_ID`. A native
 * build needs an app *client* allowed for its bundle id; the defaults below
 * are the "juno" app's, which has Ethereum embedded wallets on and a native
 * client. Both ids are public: they ship in every build and only work from
 * the bundle ids and URL schemes allowed in the Privy dashboard
 * (`app.launch.junomonad`, scheme `junomonad`). Override with
 * `EXPO_PUBLIC_PRIVY_NATIVE_APP_ID` / `EXPO_PUBLIC_PRIVY_NATIVE_CLIENT_ID`.
 */

const APP_ID = process.env.EXPO_PUBLIC_PRIVY_NATIVE_APP_ID?.trim() || "cmuh8o5on014v0cjmdk6w1l0q";
const CLIENT_ID =
  process.env.EXPO_PUBLIC_PRIVY_NATIVE_CLIENT_ID?.trim() || "client-WY6dy4WiB1bozhetK8yhaZh1mu4kQNUhF8a8SmV7xoJWN";

const PrivyContext = createContext<PrivyState | null>(null);

/**
 * How long Privy may take to come up before the sheet says so. Privy is ready
 * once its hidden wallet page has loaded, usually a second or two. On a
 * simulator short of memory it took minutes, and a page that never loads
 * would leave "Connecting…" on screen forever.
 */
const STALL_MS = 15_000;

/** What the sheet says when Privy will not come up. */
function notConnected(reason: string | null): string {
  const build = Application.applicationId ?? "this build";
  return reason
    ? `Privy could not start: ${reason}`
    : `Privy has not connected yet. Check the connection and try again in a moment. If it keeps happening, check that the Privy app allows ${build}.`;
}

type Provider = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };
type Waiter = { resolve: () => void; reject: (error: Error) => void };

export function PrivyBridge({ children }: { children: ReactNode }) {
  return (
    <PrivyProvider
      appId={APP_ID}
      clientId={CLIENT_ID}
      supportedChains={[monadTestnet, monad]}
      config={{ embedded: { ethereum: { createOnLogin: "users-without-wallets" } } }}
    >
      <Bridge>{children}</Bridge>
    </PrivyProvider>
  );
}

export function usePrivyWallet(): PrivyState {
  return (
    useContext(PrivyContext) ?? {
      available: false,
      ready: true,
      authenticated: false,
      identity: null,
      address: null,
      source: null,
      login: () => Promise.reject(new Error("Privy is not ready")),
      logout: () => Promise.resolve(),
      getAccessToken: () => Promise.resolve(null),
    }
  );
}

type LinkedAccount = { type: string; address?: string; email?: string; username?: string | null };

function identityOf(user: { linked_accounts?: LinkedAccount[] } | null): PrivyIdentity | null {
  if (!user) return null;
  const linked = user.linked_accounts ?? [];
  return {
    email: linked.find((account) => account.type === "email")?.address,
    google: linked.find((account) => account.type === "google_oauth")?.email,
    twitter: linked.find((account) => account.type === "twitter_oauth")?.username ?? undefined,
  };
}

/**
 * The bridge's view of sign-in, for the sheet: where it has got to, and the
 * three things the sheet can ask for.
 */
export type NativeSignIn = {
  /**
   * Privy starting; Privy that did not start (`error` says why); no session;
   * signed in with the wallet on its way (or stuck); usable.
   */
  status: "loading" | "unavailable" | "signed-out" | "creating" | "error" | "ready";
  /** Privy's own wallet state, shown while the wallet is on its way. */
  walletStatus: string;
  error: string | null;
  sendCode: (email: string) => Promise<void>;
  loginWithCode: (code: string, email: string) => Promise<void>;
  retry: () => Promise<void>;
};

function Bridge({ children }: { children: ReactNode }) {
  const { user, isReady, error: initError, logout, getAccessToken } = usePrivy();
  const ethereum = useEmbeddedEthereumWallet();
  const walletState = useEmbeddedWallet();
  const email = useLoginWithEmail();
  const wallet = ethereum.wallets?.[0] ?? null;
  const walletError = walletState.status === "error" ? (walletState.error ?? "The wallet could not be made") : null;

  // Hooks hand back new objects every render; the source below is one stable
  // object that reads the latest of them through this ref.
  const latest = useRef({ user, isReady, wallet, ethereum, walletState, email, logout, getAccessToken });
  latest.current = { user, isReady, wallet, ethereum, walletState, email, logout, getAccessToken };

  const [sheet, setSheet] = useState(false);
  const readyWaiters = useRef<Array<() => void>>([]);
  const signInWaiter = useRef<Waiter | null>(null);

  useEffect(() => {
    if (!isReady) return;
    const waiting = readyWaiters.current;
    readyWaiters.current = [];
    waiting.forEach((resolve) => resolve());
  }, [isReady]);

  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    if (isReady) {
      setStalled(false);
      return;
    }
    const timer = setTimeout(() => setStalled(true), STALL_MS);
    return () => clearTimeout(timer);
  }, [isReady]);

  // Signed in *and* holding a wallet is the finish line: close the sheet and
  // hand the result to whoever asked.
  useEffect(() => {
    if (!isReady || !user || !wallet) return;
    setSheet(false);
    signInWaiter.current?.resolve();
    signInWaiter.current = null;
  }, [isReady, user, wallet]);

  /*
   * `createOnLogin` covers a new sign-in. An account that signed in before its
   * wallet existed comes back without one, so make it — after giving
   * `createOnLogin` a moment, since two creates at once is an error.
   */
  const created = useRef(false);
  useEffect(() => {
    if (!user || wallet || walletState.status !== "not-created" || created.current) return;
    const timer = setTimeout(() => {
      created.current = true;
      latest.current.ethereum.create().catch(() => undefined);
    }, 2_500);
    return () => clearTimeout(timer);
  }, [user, wallet, walletState.status]);
  useEffect(() => {
    if (!user) created.current = false;
  }, [user]);

  const signIn = useCallback(
    () =>
      new Promise<void>((resolve, reject) => {
        signInWaiter.current?.reject(new Error("Sign-in replaced"));
        signInWaiter.current = { resolve, reject };
        setSheet(true);
      }),
    [],
  );

  const cancel = useCallback(() => {
    setSheet(false);
    signInWaiter.current?.reject(new Error("Sign-in was closed"));
    signInWaiter.current = null;
  }, []);

  const source = useMemo<SignerSource>(() => {
    /** Privy ready, or false once it has had `STALL_MS` and still is not. */
    const whenReady = () =>
      latest.current.isReady
        ? Promise.resolve(true)
        : new Promise<boolean>((resolve) => {
            const timer = setTimeout(() => resolve(false), STALL_MS);
            readyWaiters.current.push(() => {
              clearTimeout(timer);
              resolve(true);
            });
          });

    const provider = async (): Promise<Provider> => {
      const current = latest.current.wallet;
      if (!current) throw new Error("Your Privy wallet is not ready yet");
      return (await current.getProvider()) as unknown as Provider;
    };

    const signerFor = (address: string): Signer => ({
      address: getAddress(address),
      mode: "privy",
      async signTransaction(transaction) {
        const eth = await provider();
        // Exactly what the server built: Privy signs it and hands back the
        // serialised bytes; nothing is broadcast from the phone.
        const signed = await eth.request({
          method: "eth_signTransaction",
          params: [
            {
              from: address,
              to: transaction.to ?? undefined,
              data: transaction.data,
              value: toHex(transaction.value ?? 0n),
              nonce: transaction.nonce,
              chainId: transaction.chainId,
              type: 2,
              gasLimit: toHex(transaction.gas ?? 0n),
              maxFeePerGas: toHex(transaction.maxFeePerGas ?? 0n),
              maxPriorityFeePerGas: toHex(transaction.maxPriorityFeePerGas ?? 0n),
            },
          ],
        });
        if (typeof signed !== "string" || !signed.startsWith("0x")) {
          throw new Error("Privy returned no signed transaction");
        }
        // Parse it here so a malformed answer fails on this screen, not at the node.
        parseTransaction(signed as Hex);
        return signed as Hex;
      },
      async signMessage(message) {
        const eth = await provider();
        // Hex-encoded UTF-8: Privy signs hex as the bytes it spells, which are
        // exactly the text the server rebuilds and verifies.
        const signature = await eth.request({ method: "personal_sign", params: [toHex(message), address] });
        if (typeof signature !== "string") throw new Error("Privy returned no signature");
        return signature as Hex;
      },
    });

    return {
      mode: "privy",
      async restore() {
        // A Privy that never starts restores nothing; signing in says why.
        if (!(await whenReady())) return null;
        const { user: current, wallet: held } = latest.current;
        return current && held ? signerFor(held.address) : null;
      },
      async create() {
        // The sheet opens at once and shows Privy starting, rather than a
        // button that does nothing until it has.
        if (!latest.current.isReady || !latest.current.user || !latest.current.wallet) await signIn();
        const held = latest.current.wallet;
        if (!held) throw new Error("Privy signed you in but has not made the wallet yet. Try again.");
        return signerFor(held.address);
      },
      async forget() {
        await latest.current.logout();
      },
    };
  }, [signIn]);

  const flow = useMemo<NativeSignIn>(
    () => ({
      status: !isReady
        ? initError || stalled
          ? "unavailable"
          : "loading"
        : !user
          ? "signed-out"
          : wallet
            ? "ready"
            : walletError
              ? "error"
              : "creating",
      walletStatus: walletState.status,
      error: !isReady && (initError || stalled) ? notConnected(initError?.message ?? null) : walletError,
      sendCode: async (address) => {
        await latest.current.email.sendCode({ email: address });
      },
      loginWithCode: async (code, address) => {
        await latest.current.email.loginWithCode({ code, email: address });
      },
      retry: async () => {
        const state = latest.current.walletState;
        if (state.status === "needs-recovery" || state.status === "disconnected" || latest.current.wallet) {
          // Privy-managed recovery: asking for the provider reconnects the wallet.
          await state.getProvider();
          return;
        }
        await latest.current.ethereum.create();
      },
    }),
    [isReady, initError, stalled, user, wallet, walletError, walletState.status],
  );

  const value = useMemo<PrivyState>(
    () => ({
      available: true,
      ready: isReady,
      authenticated: !!user,
      identity: identityOf(user as { linked_accounts?: LinkedAccount[] } | null),
      address: wallet ? getAddress(wallet.address) : null,
      source,
      login: () => (latest.current.user && latest.current.wallet ? Promise.resolve() : signIn()),
      logout: () => latest.current.logout(),
      getAccessToken: () => latest.current.getAccessToken(),
    }),
    [isReady, user, wallet, source, signIn],
  );

  return (
    <PrivyContext.Provider value={value}>
      {children}
      <SignInSheet visible={sheet} onClose={cancel} flow={flow} />
    </PrivyContext.Provider>
  );
}
