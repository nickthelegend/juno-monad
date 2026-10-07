import { describe, expect, it } from "vitest";

import { EMPTYING_WINDOW_MS, reserveCheck } from "../../juno-expo/lib/reserve";

/**
 * Monad's reserve balance rule (docs.monad.xyz, developer essentials: reserve
 * balance) applied to a buy: what is allowed, and what would be included and
 * revert on chain.
 */
describe("reserveCheck", () => {
  it("passes a spend that keeps 10 MON", () => {
    expect(reserveCheck({ balance: 25, value: 10, lastSentAt: null })).toEqual({ ok: true, rule: "above-reserve" });
  });

  it("passes a transaction that sends no MON, whatever the balance", () => {
    expect(reserveCheck({ balance: 0.2, value: 0, lastSentAt: Date.now() })).toEqual({ ok: true, rule: "no-value" });
  });

  it("allows a small wallet to dip below once, the emptying exception", () => {
    const check = reserveCheck({ balance: 0.5, value: 0.1, lastSentAt: null });
    expect(check).toMatchObject({ ok: true, rule: "emptying-allowed" });
  });

  it("refuses a second dip within 3 blocks, which Monad would include and revert", () => {
    const now = 1_000_000;
    expect(reserveCheck({ balance: 0.5, value: 0.1, lastSentAt: now - 400, now })).toMatchObject({ ok: false, rule: "too-soon" });
    expect(reserveCheck({ balance: 0.5, value: 0.1, lastSentAt: now - EMPTYING_WINDOW_MS - 1, now })).toMatchObject({ ok: true, rule: "emptying-allowed" });
  });

  it("refuses ending below 10 MON from a 7702-delegated wallet, which never gets the exception", () => {
    expect(reserveCheck({ balance: 12, value: 5, lastSentAt: null, delegated: true })).toMatchObject({ ok: false, rule: "delegated" });
    expect(reserveCheck({ balance: 30, value: 5, lastSentAt: null, delegated: true })).toEqual({ ok: true, rule: "above-reserve" });
  });
});
