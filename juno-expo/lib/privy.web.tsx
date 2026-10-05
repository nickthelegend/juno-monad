import {
  PrivyProvider,
  useCreateWallet,
  useLogin,
  usePrivy,
  useSignMessage,
  useSigners,
  useSignTransaction,
  type User,
} from "@privy-io/react-auth";
import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import { parseTransaction, toHex, type Hex } from "viem";
import { monad, monadTestnet } from "viem/chains";

import type { PrivyIdentity, PrivyState } from "./privy";
import type { Signer, SignerSource } from "./wallet";
import { theme } from "../theme";

export type { PrivyIdentity, PrivyState } from "./privy";

/**
 * Privy on the web build: log in with email, Google or X, and sign every
 * launch, trade and claim with the person's Privy embedded wallet.
 *
 * Nothing else in the app changes. Juno's server builds each transaction —
 * nonce, gas and fees included — and a `Signer` only has to sign it; this one
 * hands the transaction to Privy's `signTransaction`, which shows Privy's own
 * confirmation and returns the signed bytes. The server submits them as it
 * does any other wallet's.
 *
 * The embedded wallet is created on first use, not at login, so someone who
 * only wanted to look around never gets one.
 */

const APP_ID = process.env.EXPO_PUBLIC_PRIVY_APP_ID?.trim() || "";

const PrivyContext = createContext<PrivyState | null>(null);

export function PrivyBridge({ children }: { children: ReactNode }) {
  if (!APP_ID) return <>{children}</>;
  return (
    <PrivyProvider
      appId={APP_ID}
      config={{
        loginMethods: ["email", "google", "twitter"],
        defaultChain: monadTestnet,
        supportedChains: [monadTestnet, monad],
        appearance: { theme: "light", accentColor: theme.colors.ink as `#${string}`, showWalletLoginFirst: false },
        embeddedWallets: { ethereum: { createOnLogin: "off" } },
      }}
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
      login: () => Promise.reject(new Error("Privy is not configured on this build")),
      logout: () => Promise.resolve(),
      getAccessToken: () => Promise.resolve(null),
      addSigner: () => Promise.reject(new Error("Privy is not configured on this build")),
      removeSigners: () => Promise.resolve(),
    }
  );
}

/** The Privy embedded wallet on an account, if it has one. */
function embeddedWallet(user: User | null): string | null {
  const found = user?.linkedAccounts.find(
    (account) => account.type === "wallet" && account.walletClientType === "privy" && account.chainType === "ethereum",
  );
  return found && "address" in found ? found.address : null;
}

function identityOf(user: User | null): PrivyIdentity | null {
  if (!user) return null;
  return {
    email: user.email?.address,
    google: user.google?.email,
    twitter: user.twitter?.username ?? undefined,
  };
}

type Waiter = { resolve: () => void; reject: (error: Error) => void };

function Bridge({ children }: { children: ReactNode }) {
  const privy = usePrivy();
  const { createWallet } = useCreateWallet();
  const { signTransaction } = useSignTransaction();
  const { signMessage } = useSignMessage();
  const { addSigners, removeSigners } = useSigners();

  /*
   * A `SignerSource` is a plain object the wallet provider holds on to, while
   * Privy's state arrives through hooks. The source reads the latest state
   * through refs, so it stays one stable object — a new one each render
   * would restart the provider every time Privy re-rendered.
   */
  const latest = useRef({ privy, createWallet, signTransaction, signMessage, addSigners, removeSigners });
  latest.current = { privy, createWallet, signTransaction, signMessage, addSigners, removeSigners };

  // Promises waiting on Privy: for it to load, and for a login to finish.
  const readyWaiters = useRef<Array<() => void>>([]);
  const loginWaiter = useRef<Waiter | null>(null);

  useEffect(() => {
    if (!privy.ready) return;
    const waiting = readyWaiters.current;
    readyWaiters.current = [];
    waiting.forEach((resolve) => resolve());
  }, [privy.ready]);

  const { login } = useLogin({
    onComplete: () => {
      loginWaiter.current?.resolve();
      loginWaiter.current = null;
    },
    onError: (error) => {
      loginWaiter.current?.reject(new Error(error === "exited_auth_flow" ? "Sign-in was closed" : `Privy: ${error}`));
      loginWaiter.current = null;
    },
  });
  const latestLogin = useRef(login);
  latestLogin.current = login;

  const source = useMemo<SignerSource>(() => {
    const whenReady = () =>
      latest.current.privy.ready ? Promise.resolve() : new Promise<void>((resolve) => readyWaiters.current.push(resolve));

    const signerFor = (address: string): Signer => ({
      address: address as Signer["address"],
      mode: "privy",
      async signTransaction(transaction) {
        const { signature } = await latest.current.signTransaction(
          {
            type: 2,
            chainId: transaction.chainId,
            to: transaction.to ?? undefined,
            data: transaction.data,
            value: toHex(transaction.value ?? 0n),
            nonce: transaction.nonce,
            gasLimit: toHex(transaction.gas ?? 0n),
            maxFeePerGas: toHex(transaction.maxFeePerGas ?? 0n),
            maxPriorityFeePerGas: toHex(transaction.maxPriorityFeePerGas ?? 0n),
          },
          { address },
        );
        // Privy answers with the signed, serialised transaction. Parse it here
        // so anything else fails on this screen, not at the node.
        parseTransaction(signature);
        return signature as Hex;
      },
      async signMessage(message) {
        const { signature } = await latest.current.signMessage({ message }, { address });
        return signature as Hex;
      },
      accessToken: () => latest.current.privy.getAccessToken(),
    });

    return {
      mode: "privy",
      async restore() {
        await whenReady();
        const { privy: state } = latest.current;
        if (!state.authenticated) return null;
        const address = embeddedWallet(state.user);
        return address ? signerFor(address) : null;
      },
      async create() {
        await whenReady();
        if (!latest.current.privy.authenticated) {
          await new Promise<void>((resolve, reject) => {
            loginWaiter.current = { resolve, reject };
            latestLogin.current();
          });
        }
        const existing = embeddedWallet(latest.current.privy.user);
        if (existing) return signerFor(existing);
        const wallet = await latest.current.createWallet();
        return signerFor(wallet.address);
      },
      async forget() {
        await latest.current.privy.logout();
      },
    };
  }, []);

  const value = useMemo<PrivyState>(
    () => ({
      available: true,
      ready: privy.ready,
      authenticated: privy.authenticated,
      identity: identityOf(privy.user),
      address: embeddedWallet(privy.user),
      source,
      login: () =>
        latest.current.privy.authenticated
          ? Promise.resolve()
          : new Promise<void>((resolve, reject) => {
              loginWaiter.current = { resolve, reject };
              latestLogin.current();
            }),
      logout: () => latest.current.privy.logout(),
      getAccessToken: () => latest.current.privy.getAccessToken(),
      addSigner: async (signerId, policyId) => {
        const address = embeddedWallet(latest.current.privy.user);
        if (!address) throw new Error("Make your Privy wallet first.");
        await latest.current.addSigners({ address, signers: [{ signerId, policyIds: [policyId] }] });
      },
      removeSigners: async () => {
        const address = embeddedWallet(latest.current.privy.user);
        if (address) await latest.current.removeSigners({ address });
      },
    }),
    [privy.ready, privy.authenticated, privy.user, source],
  );

  return <PrivyContext.Provider value={value}>{children}</PrivyContext.Provider>;
}
