import { describe, expect, it } from "vitest";

import type { Coin } from "../../juno-expo/lib/api";
import { earningsOf } from "../../juno-expo/lib/earnings";

/** A creator's earnings: summed honestly, per currency, with unknowns kept unknown. */
const coin = (over: Partial<Coin>): Coin =>
  ({
    address: over.symbol ?? "0x1",
    symbol: "A",
    marketCapCurrency: "USD",
    creatorRewards: 0,
    creatorRewardsClaimed: 0,
    totalVolume: 0,
    holders: 0,
    tradeCount: 0,
    ...over,
  }) as Coin;

describe("earningsOf", () => {
  it("adds claimable and claimed into lifetime earnings, ranked", () => {
    const e = earningsOf([
      coin({ symbol: "A", creatorRewards: 1, creatorRewardsClaimed: 2, totalVolume: 100, holders: 3, tradeCount: 5 }),
      coin({ symbol: "B", creatorRewards: 4, creatorRewardsClaimed: 0, totalVolume: 50, holders: 2, tradeCount: 1 }),
    ]);
    expect(e.currency).toBe("USD");
    expect(e.earned).toBe(7);
    expect(e.claimable).toBe(5);
    expect(e.claimed).toBe(2);
    expect(e.rows.map((row) => row.coin.symbol)).toEqual(["B", "A"]);
    expect([e.volume, e.holders, e.fills]).toEqual([150, 5, 6]);
    expect(e.owed.map((row) => row.coin.symbol)).toEqual(["B", "A"]);
  });

  it("does not add MON to dollars", () => {
    expect(earningsOf([coin({ symbol: "A" }), coin({ symbol: "B", marketCapCurrency: "MON" })]).currency).toBeNull();
  });

  it("keeps a count unknown when any coin could not read it", () => {
    const e = earningsOf([coin({ symbol: "A", holders: null, tradeCount: null, totalVolume: null }), coin({ symbol: "B" })]);
    expect([e.volume, e.holders, e.fills]).toEqual([null, null, null]);
  });

  it("owes nothing when every pool's fees are claimed", () => {
    expect(earningsOf([coin({ symbol: "A", creatorRewards: 0, creatorRewardsClaimed: 3 })]).owed).toEqual([]);
  });
});
