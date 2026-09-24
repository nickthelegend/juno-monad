import { useFocusEffect } from "expo-router";
import { useCallback, useRef } from "react";

/**
 * Re-read a tab's data when someone comes back to it.
 *
 * Tabs stay mounted, so a screen kept whatever it loaded first: post a reel,
 * go to Reels, and it still said "No reels yet"; sell on a coin page, go to
 * Profile, and the old holding was still there. The first focus is skipped —
 * the screen's own load already covers it — and a return within
 * `minIntervalMs` of the last read is left alone, so flicking between tabs is
 * not a burst of requests.
 */
export function useRefreshOnFocus(refresh: () => void, minIntervalMs = 15_000) {
  const first = useRef(true);
  const last = useRef(Date.now());
  const latest = useRef(refresh);
  latest.current = refresh;

  useFocusEffect(
    useCallback(() => {
      if (first.current) {
        first.current = false;
        last.current = Date.now();
        return;
      }
      if (Date.now() - last.current < minIntervalMs) return;
      last.current = Date.now();
      latest.current();
    }, [minIntervalMs]),
  );
}
