import { useCallback, useEffect, useRef, useState } from "react";

/**
 * An image address that asks again when the image fails to load.
 *
 * An image that fails once stays blank for the life of the screen: the
 * component does not retry, and the browser keeps the failure. A photo posted
 * a second earlier was the common case, while public IPFS gateways did not have
 * it yet. The server now answers those from memory, but a gateway can still
 * hiccup, so a failed load is retried a few times, a little later each time,
 * with a query the IPFS route ignores and the browser treats as a new request.
 */
export function useRetryingUri(uri: string | null | undefined, attempts = 3) {
  const [attempt, setAttempt] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new uri starts the retries over
  useEffect(() => {
    setAttempt(0);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [uri]);

  const onError = useCallback(() => {
    if (timer.current) return;
    setAttempt((current) => {
      if (current >= attempts) return current;
      timer.current = setTimeout(() => {
        timer.current = null;
        setAttempt(current + 1);
      }, 1_500 * (current + 1));
      return current;
    });
  }, [attempts]);

  const retryable = !!uri && /^https?:/i.test(uri);
  const current =
    uri && retryable && attempt > 0 ? `${uri}${uri.includes("?") ? "&" : "?"}retry=${attempt}` : (uri ?? null);
  return { uri: current, onError };
}
