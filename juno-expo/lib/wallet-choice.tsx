import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import { meraAvailable, meraSource } from "./mera";
import { usePrivyWallet } from "./privy";
import { WalletProvider, localKeySource, type WalletMode } from "./wallet";

/**
 * Which wallet signs: the device key, the person's Privy embedded wallet, or a
 * passkey account (Mera).
 *
 * The choice is the person's and is remembered on this device — in the browser's
 * storage on the web, in the keychain on a phone. Switching does
 * not move anything — they are two different addresses — so the profile says
 * which one is active and switching is an explicit act, never a fallback.
 */

type Choice = "local" | "privy" | "mera";

type WalletChoice = {
  choice: Choice;
  /** Privy is configured and supported here. */
  privyAvailable: boolean;
  /** This browser can run Mera's passkey ceremonies (WebAuthn with PRF). */
  meraAvailable: boolean;
  choose: (next: Choice) => void;
};

const KEY = "juno.wallet.choice.v1";

const ChoiceContext = createContext<WalletChoice>({ choice: "local", privyAvailable: false, meraAvailable: false, choose: () => undefined });

function stored(): Choice {
  try {
    const value =
      Platform.OS === "web" ? globalThis.localStorage?.getItem(KEY) : SecureStore.getItem(KEY.replace(/[^\w.-]/g, "_"));
    return value === "privy" || value === "mera" ? value : "local";
  } catch {
    return "local";
  }
}

function remember(choice: Choice) {
  try {
    if (Platform.OS === "web") globalThis.localStorage?.setItem(KEY, choice);
    else SecureStore.setItem(KEY.replace(/[^\w.-]/g, "_"), choice);
  } catch {
    // Private browsing, or a keychain that refused: the choice lasts for this visit only.
  }
}

export function WalletRoot({ children }: { children: ReactNode }) {
  const privy = usePrivyWallet();
  const [choice, setChoice] = useState<Choice>(stored);

  const passkeys = meraAvailable();
  // A stored choice this build or browser cannot honour falls back to the device key.
  const active: Choice =
    choice === "privy" && privy.available && privy.source ? "privy" : choice === "mera" && passkeys ? "mera" : "local";

  const choose = useCallback((next: Choice) => {
    setChoice(next);
    remember(next);
  }, []);

  useEffect(() => {
    if (choice === "privy" && privy.ready && !privy.available) choose("local");
  }, [choice, privy.ready, privy.available, choose]);

  return (
    <ChoiceContext.Provider value={{ choice: active, privyAvailable: privy.available, meraAvailable: passkeys, choose }}>
      <WalletProvider source={active === "privy" ? privy.source! : active === "mera" ? meraSource : localKeySource}>
        {children}
      </WalletProvider>
    </ChoiceContext.Provider>
  );
}

export function useWalletChoice(): WalletChoice & { mode: WalletMode } {
  const value = useContext(ChoiceContext);
  return { ...value, mode: value.choice };
}
