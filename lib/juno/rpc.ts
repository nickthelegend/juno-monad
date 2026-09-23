/**
 * Surviving a public RPC endpoint.
 *
 * Juno runs against Monad's public RPC unless `MONAD_RPC_URL` names a
 * dedicated one, and a public endpoint rate-limits a burst hard enough to
 * break a demo. viem's own transport retry is switched off (`retryCount: 0` in
 * `lib/juno/client.ts`) so that retrying is this module's job instead, with a
 * budget the caller chooses.
 *
 * Two rules learned the hard way:
 *
 * Only retry what retrying can fix. A 429 or a 503 is a "come back later"; a
 * reverted call or a malformed request is not, and hammering it wastes the
 * exact budget the real failure needs.
 *
 * Never let one failed page discard the pages that succeeded. A partial answer
 * from a rate-limited endpoint is worth more than an empty one, provided the
 * caller can tell the difference — which is why `collect` reports both.
 */

const RETRYABLE =
  /429|Too Many Requests|503|502|504|rate limit|request limit|limit exceeded|timeout|timed out|ETIMEDOUT|ECONNRESET|fetch failed|HTTP request failed/i;

export function isRetryable(error: unknown): boolean {
  if (!error) return false;
  const message = error instanceof Error ? error.message : String(error);
  return RETRYABLE.test(message);
}

export type RetryOptions = {
  /** Total attempts, including the first. */
  attempts?: number;
  /** First backoff, doubled each time. */
  baseDelayMs?: number;
  /** Ceiling on any single backoff. */
  maxDelayMs?: number;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Run an RPC read, retrying only on the errors that a wait can cure.
 *
 * Backoff is exponential with jitter. The jitter is not decoration: several
 * pool reads start together on a page render, and without it they retry in
 * lockstep and re-create the same burst that got them throttled.
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? 3;
  const base = options.baseDelayMs ?? 250;
  const max = options.maxDelayMs ?? 2_000;

  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === attempts - 1) throw error;
      const backoff = Math.min(max, base * 2 ** attempt);
      await sleep(backoff / 2 + Math.random() * (backoff / 2));
    }
  }
  throw lastError;
}

/**
 * Like `withRetry`, but a give-up returns null instead of throwing.
 *
 * For reads whose absence the UI already renders honestly — a holder count
 * that shows as unknown, a chart that says it has no data.
 */
export async function tryRead<T>(
  operation: () => Promise<T>,
  options?: RetryOptions,
): Promise<T | null> {
  try {
    return await withRetry(operation, options);
  } catch {
    return null;
  }
}

export type Collected<T> = {
  items: T[];
  /** True when at least one page failed, so `items` is short of the truth. */
  partial: boolean;
};

/**
 * Run paged reads, keeping whatever came back.
 *
 * Pages run in sequence rather than in parallel. Against an endpoint that
 * throttles bursts, firing every page at once is the reliable way to get none
 * of them.
 */
export async function collect<TPage, TItem>(
  pages: TPage[],
  read: (page: TPage) => Promise<TItem[]>,
  options?: RetryOptions,
): Promise<Collected<TItem>> {
  const items: TItem[] = [];
  let partial = false;

  for (const page of pages) {
    const result = await tryRead(() => read(page), options);
    if (result === null) {
      partial = true;
      continue;
    }
    items.push(...result);
  }

  return { items, partial };
}

/**
 * A value cached for a fixed time, keyed by string.
 *
 * `lib/juno/dbc.ts` already caches pool configs forever and snapshots for five
 * seconds, on the reasoning that a config cannot change and a curve barely
 * does. The same argument applies to swap history and oracle prices, so the
 * mechanism is shared rather than written a third time.
 *
 * In-process and per-instance by design. A shared cache would need a store, and
 * a store is a dependency this does not earn: the worst case is that two server
 * instances each do one read.
 */
export function ttlCache<T>(ttlMs: number) {
  const entries = new Map<string, { at: number; value: T; ttl: number }>();
  /*
   * Reads that have started but not finished.
   *
   * A TTL only de-duplicates callers that arrive *after* one has finished.
   * Two that arrive together both miss, both read, and the endpoint answers
   * one of them and refuses the other — which is how a coin page ended up
   * saying "trade history could not be read" beside an activity list showing
   * four trades. Both sentences were true of their own read. They were reads
   * of the same history.
   *
   * Sharing the in-flight promise makes that contradiction unrepresentable:
   * concurrent callers for one key get one answer, whatever it is.
   */
  const inFlight = new Map<string, Promise<T>>();

  return {
    /**
     * `ttlFor` lets a value choose how long it is trusted.
     *
     * A complete read is worth the full TTL. A short one — the shape a burst of
     * 429s produces — is not, and the two failure modes either side of this are
     * both real. Caching a throttled read for the full minute served an empty
     * feed to everyone without retrying. Refusing to cache it at all sent every
     * subsequent caller straight back at the endpoint that was already
     * refusing, so a coin page showed a four-point chart beside an empty
     * activity list, because the second read of the same history was throttled
     * where the first was not.
     *
     * A brief TTL is the answer to both: retry soon, but not on every request.
     */
    async get(
      key: string,
      load: () => Promise<T>,
      ttlFor: (value: T) => number = () => ttlMs,
    ): Promise<T> {
      const hit = entries.get(key);
      if (hit && Date.now() - hit.at < hit.ttl) return hit.value;

      const pending = inFlight.get(key);
      if (pending) return pending;

      const run = (async () => {
        const value = await load();
        entries.set(key, { at: Date.now(), value, ttl: Math.max(0, ttlFor(value)) });
        return value;
      })();
      inFlight.set(key, run);
      try {
        return await run;
      } finally {
        // Cleared whether it resolved or threw, so a failed read does not
        // pin every later caller to the same rejection.
        inFlight.delete(key);
      }
    },
    invalidate(prefix: string): void {
      for (const key of entries.keys()) {
        if (key.startsWith(prefix)) entries.delete(key);
      }
    },
    clear(): void {
      entries.clear();
      inFlight.clear();
    },
  };
}

/**
 * A gate on how many RPC calls are in flight at once.
 *
 * The public endpoint enforces two different limits and they need two
 * different answers. A per-method refusal ("Too many requests for a specific
 * RPC call") is a policy, and the response is smaller, paced batches. A
 * *connection* refusal ("Connection rate limits exceeded") is about
 * simultaneity — and no amount of retrying fixes it, because every retry is
 * another connection competing with the ones already being refused.
 *
 * Hydrating a coin page fans out into a dozen reads, some of them issued by
 * viem internally (gas estimation, nonce lookups) where no caller can pace
 * them. Gating the transport's own `fetch` is the only place that catches all
 * of them.
 *
 * Four is empirical: enough that a page does not feel serialised, few enough
 * that the endpoint stops refusing.
 */
const MAX_IN_FLIGHT = 4;

let inFlight = 0;
const waiting: Array<() => void> = [];

async function acquire(): Promise<void> {
  if (inFlight < MAX_IN_FLIGHT) {
    inFlight += 1;
    return;
  }
  await new Promise<void>((resolve) => waiting.push(resolve));
  inFlight += 1;
}

function release(): void {
  inFlight -= 1;
  const next = waiting.shift();
  if (next) next();
}

/**
 * `fetch`, with the gate applied. Handed to viem's `http(url, { fetchFn })` so
 * every call the client makes goes through it, whether or not the caller knew
 * it was making one.
 */
export const gatedFetch: typeof fetch = async (input, init) => {
  await acquire();
  try {
    return await fetch(input, {
      ...init,
      /*
       * Next.js instruments global `fetch` with its own caching layer, and an
       * RPC POST is exactly the shape it will happily memoise. That turned a
       * single 429 into a permanent one: the refusal was cached and replayed to
       * every subsequent request, so the coin page stayed broken long after the
       * endpoint had recovered — while the same code in a plain Node process
       * worked fine.
       *
       * Chain state is never cacheable at this layer anyway; the TTL caches in
       * this module are where that decision belongs.
       */
      cache: "no-store",
    });
  } finally {
    release();
  }
};
