import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Platform } from "react-native";

import { usePrivyWallet } from "./privy";
import { WalletProvider, localKeySource, type WalletMode } from "./wallet";

/**
 * Which wallet signs: the device key, or the person's Privy embedded wallet.
 *
 * The choice is the person's and is remembered on this device. Switching does
 * not move anything — they are two different addresses — so the profile says
 * which one is active and switching is an explicit act, never a fallback.
 */

type Choice = "local" | "privy";

type WalletChoice = {
  choice: Choice;
  /** Privy is configured and supported here. */
  privyAvailable: boolean;
  choose: (next: Choice) => void;
};

const KEY = "juno.wallet.choice.v1";

const ChoiceContext = createContext<WalletChoice>({ choice: "local", privyAvailable: false, choose: () => undefined });

function stored(): Choice {
  if (Platform.OS !== "web") return "local";
  try {
    return globalThis.localStorage?.getItem(KEY) === "privy" ? "privy" : "local";
  } catch {
    return "local";
  }
}

export function WalletRoot({ children }: { children: ReactNode }) {
  const privy = usePrivyWallet();
  const [choice, setChoice] = useState<Choice>(stored);

  // A stored choice of Privy on a build without it falls back to the device key.
  const active: Choice = choice === "privy" && privy.available && privy.source ? "privy" : "local";

  const choose = useCallback((next: Choice) => {
    setChoice(next);
    try {
      globalThis.localStorage?.setItem(KEY, next);
    } catch {
      // Private browsing: the choice lasts for this visit only.
    }
  }, []);

  useEffect(() => {
    if (choice === "privy" && privy.ready && !privy.available) choose("local");
  }, [choice, privy.ready, privy.available, choose]);

  return (
    <ChoiceContext.Provider value={{ choice: active, privyAvailable: privy.available, choose }}>
      <WalletProvider source={active === "privy" ? privy.source! : localKeySource}>{children}</WalletProvider>
    </ChoiceContext.Provider>
  );
}

export function useWalletChoice(): WalletChoice & { mode: WalletMode } {
  const value = useContext(ChoiceContext);
  return { ...value, mode: value.choice };
}
