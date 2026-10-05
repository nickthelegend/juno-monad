import { describe, expect, it } from "vitest";

import type { MarketRisk } from "@/lib/juno/perpl";
import { DEFAULT_CONFIG, decide, exitReason, type BotConfig, type BotPosition } from "@/lib/juno/perpl-bot";

function market(overrides: Partial<MarketRisk> = {}): MarketRisk {
  return {
    id: 16,
    symbol: "BTC",
    mark: 85_000,
    premium: 0,
    fundingRate: 0,
    fundingAnnualized: 0,
    funding24h: [],
    fundingCost24hPer1kLong: 0,
    volatility: 0.3,
    high24h: null,
    low24h: null,
    openInterestUsd: 1e6,
    volume24hUsd: 1e6,
    maxLeverage: 15,
    ...overrides,
  };
}

function position(overrides: Partial<BotPosition> = {}): BotPosition {
  return {
    perpId: 16,
    symbol: "BTC",
    side: "short",
    notional: 50,
    equity: 25,
    effectiveLeverage: 2,
    liquidationPrice: 120_000,
    liquidationDistance: 0.4,
    health: 10,
    fundingPerDay: 0.01,
    pnlAt10PctAdverse: -5,
    collateral: 25,
    pnl: 0,
    ownedByBot: true,
    ...overrides,
  };
}

const config: BotConfig = { ...DEFAULT_CONFIG, markets: [] };
const input = (over: Partial<Parameters<typeof decide>[0]> = {}) => ({
  markets: [market()],
  positions: [],
  freeCollateral: 100,
  lossToday: 0,
  halted: false,
  ...over,
});

describe("perpl bot — carry entries", () => {
  it("shorts a market whose longs pay enough, longs one whose shorts pay", () => {
    const actions = decide(input({ markets: [market({ fundingAnnualized: 0.5 }), market({ id: 32, symbol: "ETH", fundingAnnualized: -0.4 })] }), config);
    expect(actions).toEqual([
      expect.objectContaining({ kind: "open", perpId: 16, side: "short", collateral: 25, leverage: 2 }),
      expect.objectContaining({ kind: "open", perpId: 32, side: "long" }),
    ]);
  });

  it("holds when funding is under the entry line", () => {
    expect(decide(input({ markets: [market({ fundingAnnualized: 0.2 })] }), config)).toEqual([{ kind: "hold", reason: "nothing to do" }]);
  });

  it("respects the caps: free collateral, positions, notional, volatility, stale marks", () => {
    const hot = [market({ fundingAnnualized: 0.9 }), market({ id: 32, symbol: "ETH", fundingAnnualized: 0.8 }), market({ id: 48, symbol: "SOL", fundingAnnualized: 0.7 })];
    expect(decide(input({ markets: hot }), { ...config, maxPositions: 1 }).filter((a) => a.kind === "open")).toHaveLength(1);
    expect(decide(input({ markets: hot, freeCollateral: 30 }), config).filter((a) => a.kind === "open")).toHaveLength(1);
    expect(decide(input({ markets: hot }), { ...config, maxNotional: 60 }).filter((a) => a.kind === "open")).toHaveLength(1);
    expect(decide(input({ markets: [market({ fundingAnnualized: 0.9, volatility: 2 })] }), config)[0].kind).toBe("hold");
    expect(decide(input({ markets: [market({ fundingAnnualized: 0.9 })], staleMarkets: new Set([16]) }), config)[0].kind).toBe("hold");
  });

  it("caps leverage at the market's own limit", () => {
    const [open] = decide(input({ markets: [market({ id: 64, symbol: "MON", fundingAnnualized: 0.9, maxLeverage: 3 })] }), { ...config, leverage: 5 });
    expect(open).toMatchObject({ kind: "open", leverage: 3 });
  });

  it("stops opening after the daily loss limit, and halts on the kill switch", () => {
    expect(decide(input({ markets: [market({ fundingAnnualized: 0.9 })], lossToday: 25 }), config)[0].kind).toBe("hold");
    expect(decide(input({ markets: [market({ fundingAnnualized: 0.9 })], positions: [position({ pnl: -20 })], halted: true }), config)).toEqual([
      { kind: "hold", reason: "halted: the kill switch is on" },
    ]);
  });

  it("only trades the markets it was given", () => {
    expect(decide(input({ markets: [market({ fundingAnnualized: 0.9 })] }), { ...config, markets: ["ETH"] })[0].kind).toBe("hold");
  });
});

describe("perpl bot — exits", () => {
  it("guards any position: stop-loss, take-profit, liquidation buffer", () => {
    expect(exitReason(position({ pnl: -7, ownedByBot: false }), market(), config)).toMatch(/^stop-loss/);
    expect(exitReason(position({ pnl: 13, ownedByBot: false }), market(), config)).toMatch(/^take-profit/);
    expect(exitReason(position({ liquidationDistance: 0.1, ownedByBot: false }), market(), config)).toMatch(/^liquidation/);
    expect(exitReason(position({ ownedByBot: false }), market(), config)).toBeNull();
  });

  it("closes the bot's carry when funding fades or turns, and leaves a person's position alone", () => {
    expect(exitReason(position(), market({ fundingAnnualized: 0.05 }), config)).toMatch(/^funding faded/);
    expect(exitReason(position(), market({ fundingAnnualized: -0.3 }), config)).toMatch(/^funding turned/);
    expect(exitReason(position(), market({ fundingAnnualized: 0.4 }), config)).toBeNull();
    expect(exitReason(position({ ownedByBot: false }), market({ fundingAnnualized: -0.3 }), config)).toBeNull();
  });

  it("never flips a market in one pass: it closes, and opens the other side once the close has settled", () => {
    const turned = market({ fundingAnnualized: -0.5 });
    expect(decide(input({ markets: [turned], positions: [position()] }), config)).toEqual([
      expect.objectContaining({ kind: "close", perpId: 16 }),
    ]);
    expect(decide(input({ markets: [turned], positions: [] }), config)[0]).toMatchObject({ kind: "open", perpId: 16, side: "long" });
  });

  it("in guard-only mode opens nothing", () => {
    expect(decide(input({ markets: [market({ fundingAnnualized: 0.9 })] }), { ...config, carry: false })).toEqual([{ kind: "hold", reason: "guarding: nothing to close" }]);
  });
});
