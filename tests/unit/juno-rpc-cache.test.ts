import { describe, expect, it, vi } from "vitest";

import { collect, isRetryable, tryRead, ttlCache, withRetry } from "../../lib/juno/rpc";

/**
 * The read cache in front of every chain call.
 *
 * The TTL half is ordinary. The half worth a test is what happens to callers
 * that arrive *together*, because that is where the coin page's two halves
 * started disagreeing with each other: the chart and the activity list both
 * wanted the same pool's swap history, both missed an empty cache at the same
 * moment, both read, and the endpoint served one and refused the other. The
 * page then said "trade history could not be read" directly above four trades.
 *
 * Neither sentence was wrong about its own read. Sharing the in-flight promise
 * is what makes them the same read.
 */

/** Resolves only when `release()` is called, so overlap is deterministic. */
function gate<T>() {
  let release!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe("ttlCache", () => {
  it("gives concurrent callers one read, not one each", async () => {
    const cache = ttlCache<string>(60_000);
    const first = gate<string>();
    const load = vi.fn(() => first.promise);

    const a = cache.get("pool", load);
    const b = cache.get("pool", load);
    const c = cache.get("pool", load);

    expect(load).toHaveBeenCalledTimes(1);

    first.release("history");
    expect(await Promise.all([a, b, c])).toEqual(["history", "history", "history"]);
  });

  it("serves the cached value once the read has landed", async () => {
    const cache = ttlCache<number>(60_000);
    const load = vi.fn(async () => 7);

    expect(await cache.get("k", load)).toBe(7);
    expect(await cache.get("k", load)).toBe(7);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("re-reads after the entry's own TTL, which the value chooses", async () => {
    vi.useFakeTimers();
    try {
      const cache = ttlCache<{ partial: boolean }>(60_000);
      let call = 0;
      const load = async () => ({ partial: ++call === 1 });
      // A short read is trusted for a moment; a complete one for the full TTL.
      const ttlFor = (value: { partial: boolean }) => (value.partial ? 1_000 : 60_000);

      expect(await cache.get("k", load, ttlFor)).toEqual({ partial: true });
      vi.setSystemTime(Date.now() + 1_500);
      expect(await cache.get("k", load, ttlFor)).toEqual({ partial: false });
      vi.setSystemTime(Date.now() + 1_500);
      // The complete read is still inside its own, longer TTL.
      expect(await cache.get("k", load, ttlFor)).toEqual({ partial: false });
      expect(call).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not pin later callers to a failed read", async () => {
    const cache = ttlCache<string>(60_000);
    let call = 0;
    const load = async () => {
      if (++call === 1) throw new Error("429");
      return "ok";
    };

    await expect(cache.get("k", load)).rejects.toThrow("429");
    // The in-flight entry has to be cleared on rejection too, or every
    // subsequent request for this key replays the same failure forever.
    await expect(cache.get("k", load)).resolves.toBe("ok");
  });

  it("shares in flight per key, not across keys", async () => {
    const cache = ttlCache<string>(60_000);
    const load = vi.fn(async (): Promise<string> => "v");

    await Promise.all([cache.get("a", load), cache.get("b", load)]);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("drops what `invalidate` names and keeps the rest", async () => {
    const cache = ttlCache<number>(60_000);
    let call = 0;
    const load = async () => ++call;

    await cache.get("pool:one", load);
    await cache.get("other:one", load);
    cache.invalidate("pool:");

    expect(await cache.get("pool:one", load)).toBe(3);
    expect(await cache.get("other:one", load)).toBe(2);
  });
});

/**
 * Retrying only what a wait can cure.
 *
 * Monad's public RPC answers a burst with 429s, which a backoff fixes. A
 * reverted `eth_call` is the chain's answer and retrying it only spends the
 * budget the real failure needs.
 */
describe("withRetry", () => {
  const fast = { attempts: 3, baseDelayMs: 1, maxDelayMs: 2 };

  it("retries a rate limit and returns the eventual answer", async () => {
    let call = 0;
    const result = await withRetry(async () => {
      if (++call < 3) throw new Error("HTTP request failed. Status: 429");
      return "ok";
    }, fast);
    expect(result).toBe("ok");
    expect(call).toBe(3);
  });

  it("does not retry a revert", async () => {
    let call = 0;
    await expect(
      withRetry(async () => {
        call++;
        throw new Error('The contract function "buy" reverted with the following reason: Slippage');
      }, fast),
    ).rejects.toThrow(/Slippage/);
    expect(call).toBe(1);
  });

  it("gives up after its budget with the last error", async () => {
    let call = 0;
    await expect(
      withRetry(async () => {
        call++;
        throw new Error(`503 attempt ${call}`);
      }, fast),
    ).rejects.toThrow("503 attempt 3");
    expect(call).toBe(3);
  });

  it("classifies the refusals a public endpoint actually sends", () => {
    for (const message of ["429 Too Many Requests", "request limit reached", "fetch failed", "ECONNRESET", "The request timed out."]) {
      expect(isRetryable(new Error(message)), message).toBe(true);
    }
    for (const message of ["execution reverted", "insufficient funds for gas", "nonce too low"]) {
      expect(isRetryable(new Error(message)), message).toBe(false);
    }
    expect(isRetryable(null)).toBe(false);
  });
});

describe("tryRead and collect", () => {
  it("turns a give-up into null rather than a throw", async () => {
    await expect(tryRead(async () => { throw new Error("execution reverted"); })).resolves.toBeNull();
    await expect(tryRead(async () => 5)).resolves.toBe(5);
  });

  it("keeps the pages that succeeded and says the read was partial", async () => {
    const result = await collect([1, 2, 3], async (page) => {
      if (page === 2) throw new Error("execution reverted");
      return [page * 10];
    });
    expect(result).toEqual({ items: [10, 30], partial: true });
  });

  it("is complete when every page answers", async () => {
    expect(await collect([1, 2], async (page) => [page])).toEqual({ items: [1, 2], partial: false });
  });
});
