import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError } from "./api";

/**
 * One async read, with the three states a screen actually has to draw.
 *
 * Deliberately not react-query. This app makes a handful of calls from a
 * handful of screens, and a cache library would be more configuration than the
 * problem has — while still leaving the same three states to render.
 *
 * `refreshing` is separate from `loading` because they mean different things on
 * screen. A first load has nothing to show and gets a skeleton; a pull to
 * refresh already has content, and replacing it with a skeleton throws away
 * what the user was reading and makes the app feel like it lost its place.
 */
export type AsyncState<T> = {
  data: T | null;
  error: string | null;
  /**
   * The HTTP status behind `error`, when there was one. A 404 is "this does
   * not exist" and wants a way out, not a Try again that can never work.
   */
  errorStatus: number | null;
  loading: boolean;
  refreshing: boolean;
  refresh: () => void;
  /**
   * Reload without saying so: no spinner, and a failed read keeps what is on
   * screen rather than replacing it with an error. For figures that are meant
   * to stay current on their own — a mark, a funding rate.
   */
  poll: () => void;
};

export function useApi<T>(
  load: () => Promise<T>,
  deps: React.DependencyList = [],
): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // A screen that unmounts mid-request must not set state afterwards, and a
  // slow first response must not overwrite a newer one.
  const generation = useRef(0);

  const run = useCallback(
    async (mode: "load" | "refresh" | "poll") => {
      const mine = ++generation.current;
      if (mode === "refresh") setRefreshing(true);
      else if (mode === "load") setLoading(true);
      if (mode !== "poll") {
        setError(null);
        setErrorStatus(null);
      }

      try {
        const result = await load();
        if (generation.current !== mine) return;
        setData(result);
        setError(null);
        setErrorStatus(null);
      } catch (caught) {
        if (generation.current !== mine) return;
        // A background read that failed says nothing new about what is shown.
        if (mode === "poll") return;
        setErrorStatus(caught instanceof ApiError && caught.status > 0 ? caught.status : null);
        setError(
          caught instanceof ApiError
            ? caught.message
            : caught instanceof Error
              ? caught.message
              : "Something went wrong",
        );
      } finally {
        if (generation.current === mine) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    // The caller's deps stand for whatever `load` reads; `load` itself is a new closure each render.
    // biome-ignore lint/correctness/useExhaustiveDependencies: the caller's deps are the dependency list
    deps,
  );

  useEffect(
    () => {
      run("load");
      return () => {
        // Invalidate anything in flight.
        generation.current += 1;
      };
    },
    // biome-ignore lint/correctness/useExhaustiveDependencies: the caller's deps are the dependency list
    deps,
  );

  // Stable while the deps are, so a screen can list them in its own effects.
  const refresh = useCallback(() => run("refresh"), [run]);
  const poll = useCallback(() => run("poll"), [run]);
  return { data, error, errorStatus, loading, refreshing, refresh, poll };
}

/*
 * Re-exported so every call site keeps working.
 *
 * The formatters themselves live in `./format`, which imports nothing — see
 * the note there.
 */
export { bookPrice, money, since, sum, tokens } from "./format";
