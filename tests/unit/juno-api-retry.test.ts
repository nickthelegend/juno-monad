import { describe, expect, it, vi } from "vitest";

import { isRpcBusy, junoRead, retryWhenBusy } from "@/lib/juno/api";

describe("retryWhenBusy", () => {
  it("waits out an RPC refusal and returns the answer", async () => {
    const run = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("HTTP request failed. Status: 429"))
      .mockResolvedValueOnce("ok");
    await expect(retryWhenBusy(run, [1, 1])).resolves.toBe("ok");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("does not retry an error that is not the RPC being busy", async () => {
    const run = vi.fn<() => Promise<string>>().mockRejectedValue(new Error("execution reverted: Slippage"));
    await expect(retryWhenBusy(run, [1, 1])).rejects.toThrow("Slippage");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("gives up after its budget and surfaces the refusal", async () => {
    const run = vi.fn<() => Promise<string>>().mockRejectedValue(new Error("Too Many Requests"));
    await expect(retryWhenBusy(run, [1, 1])).rejects.toThrow("Too Many Requests");
    expect(run).toHaveBeenCalledTimes(3);
  });
});

describe("junoRead", () => {
  it("answers 503 with a sentence only once the retries are spent", async () => {
    // Millisecond waits: the production pauses (1.2 s, 2.5 s) slept for real
    // here, against this test's own timeout.
    let calls = 0;
    const response = await junoRead(() => {
      calls++;
      return Promise.reject(new Error("rate limit"));
    }, [1, 1]);
    expect(calls).toBe(3);
    expect(response.status).toBe(503);
    expect((await response.json()).error).toMatch(/rate-limiting/);
  });

  it("classifies refusals, not faults", () => {
    expect(isRpcBusy(new Error("Connection rate limits exceeded"))).toBe(true);
    expect(isRpcBusy(new Error("duplicate key value violates unique constraint"))).toBe(false);
  });
});
