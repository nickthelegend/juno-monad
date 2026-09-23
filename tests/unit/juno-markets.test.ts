import { describe, expect, it, vi } from "vitest";

// `lib/markets` imports the API client for `loadMarkets`, which pulls in Expo
// modules that do not load under Node. The helpers tested here never call it.
vi.mock("../../juno-expo/lib/api", () => ({ juno: {} }));

import type { Coin } from "../../juno-expo/lib/api";
import { bigMoney, count, marketKind, progressLabel } from "../../juno-expo/lib/markets";

const coin = (over: Partial<Coin>): Coin => ({ address: "A", name: "Something", ...over }) as Coin;

/**
 * Sorting coins into Juno's two products, and the labels the lists print.
 */
describe("marketKind", () => {
  it("trusts the server's reference when it sends one", () => {
    expect(marketKind(coin({ reference: null }))).toBe("post");
    expect(marketKind(coin({ reference: { source: "tessera", id: "T-OpenAI" } }))).toBe("preipo");
    expect(marketKind(coin({ reference: { source: "pyth", id: "Equity.US.AAPL/USD" } }))).toBe("stock");
  });

  it("falls back to Tessera's market list, then the issuance name, for an older server", () => {
    expect(marketKind(coin({ address: "X" }), new Set(["X"]))).toBe("preipo");
    expect(marketKind(coin({ name: "AAPLx Issuance" }))).toBe("stock");
    expect(marketKind(coin({ name: "Night Market" }))).toBe("post");
  });

  it("does not let a name that merely contains the word decide", () => {
    expect(marketKind(coin({ name: "Issuance day at the market" }))).toBe("post");
  });
});

describe("progressLabel", () => {
  it("never prints a started curve as 0.00%", () => {
    expect(progressLabel(0)).toBe("0%");
    expect(progressLabel(0.004)).toBe("<0.01%");
    expect(progressLabel(0.42)).toBe("0.42%");
    expect(progressLabel(37.9)).toBe("37%");
  });
});

describe("count and bigMoney", () => {
  it("compacts without inventing precision", () => {
    expect(count(999)).toBe("999");
    expect(count(1000)).toBe("1K");
    expect(count(29_800)).toBe("29.8K");
    expect(count(null)).toBe("");
    expect(bigMoney(950_000_000_000)).toBe("$950B");
    expect(bigMoney(14_000_000_000)).toBe("$14B");
    expect(bigMoney(null)).toBe("—");
  });
});
