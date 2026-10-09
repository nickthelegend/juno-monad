import * as SecureStore from "expo-secure-store";
import { useCallback, useState } from "react";
import { Platform } from "react-native";

/**
 * Whether this device has been shown the feed's first-run tips.
 *
 * Kept where the wallet choice is kept: the browser's storage on the web, the
 * keychain on a phone. Storage that refuses (private browsing) means the
 * tips come back next visit, which is the right failure.
 */
const KEY = "juno.coach.feed.v1";

function seen(): boolean {
  try {
    const value = Platform.OS === "web" ? globalThis.localStorage?.getItem(KEY) : SecureStore.getItem(KEY.replace(/[^\w.-]/g, "_"));
    return value === "done";
  } catch {
    return false;
  }
}

function remember() {
  try {
    if (Platform.OS === "web") globalThis.localStorage?.setItem(KEY, "done");
    else SecureStore.setItem(KEY.replace(/[^\w.-]/g, "_"), "done");
  } catch {
    // Shown again next time.
  }
}

/** The step on show, or null once the tips are done or were seen before. */
export function useCoach(steps: number) {
  const [step, setStep] = useState<number | null>(() => (seen() ? null : 0));
  const finish = useCallback(() => {
    remember();
    setStep(null);
  }, []);
  const next = useCallback(() => {
    setStep((current) => {
      if (current === null) return null;
      if (current + 1 >= steps) {
        remember();
        return null;
      }
      return current + 1;
    });
  }, [steps]);
  return { step, next, finish };
}
