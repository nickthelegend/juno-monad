import { describe, expect, it } from "vitest";

import { quickBuySizes } from "../../juno-expo/lib/quick-sizes";

/**
 * The buy sheet's quick sizes. The first trade of a newcomer is the case
 * that matters: Juno's faucet gives 0.5 MON, worth about a cent on testnet,
 * so a "$2" pill could only ever say "Not enough MON".
 */
describe("quickBuySizes", () => {
  it("offers dollars when the wallet covers all of them", () => {
    const sizes = quickBuySizes({ spendable: 5_000, rate: 0.026, symbol: "MON" });
    expect(sizes.map((s) => s.label)).toEqual(["$2", "$20", "$50", "Max"]);
    expect(sizes[0].amount).toBeCloseTo(2 / 0.026, 9);
  });

  it("switches to shares of what is spendable when a dollar size would not fit", () => {
    const sizes = quickBuySizes({ spendable: 0.4, rate: 0.026, symbol: "MON" });
    expect(sizes.map((s) => s.label)).toEqual(["0.1 MON", "0.2 MON", "0.3 MON", "Max"]);
    expect(sizes.every((s) => s.amount !== null && s.amount <= 0.4)).toBe(true);
  });

  it("disables everything when nothing is spendable, rather than offering a size", () => {
    const sizes = quickBuySizes({ spendable: -0.1, rate: 0.026, symbol: "MON" });
    expect(sizes.map((s) => s.label)).toEqual(["25%", "50%", "75%", "Max"]);
    expect(sizes.every((s) => s.amount === null)).toBe(true);
  });

  it("keeps the fixed sizes before a balance is known (no wallet yet)", () => {
    expect(quickBuySizes({ spendable: null, rate: 0.026, symbol: "MON" }).map((s) => s.label)).toEqual(["$2", "$20", "$50", "Max"]);
  });

  it("falls back to quote units without a USD rate, under the same rule", () => {
    expect(quickBuySizes({ spendable: 10, rate: null, symbol: "USDC" }).map((s) => s.label)).toEqual(["0.1 USDC", "0.25 USDC", "0.5 USDC", "Max"]);
    expect(quickBuySizes({ spendable: 0.2, rate: null, symbol: "USDC" }).map((s) => s.label)).toEqual(["0.05 USDC", "0.1 USDC", "0.15 USDC", "Max"]);
  });
});
