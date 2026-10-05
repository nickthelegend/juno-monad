import { describe, expect, it } from "vitest";

import { positionRisk, type MarketRisk, type PerpPosition } from "@/lib/juno/perpl";

const market: MarketRisk = {
  id: 16,
  symbol: "BTC",
  mark: 80_000,
  premium: 0,
  fundingRate: 0.0001,
  fundingAnnualized: 0.0001 * 12_264,
  funding24h: [],
  fundingCost24hPer1kLong: 0,
  volatility: 0.3,
  high24h: 81_000,
  low24h: 79_000,
  openInterestUsd: 1e6,
  volume24hUsd: 1e6,
  maxLeverage: 15,
};

function position(overrides: Partial<PerpPosition> = {}): PerpPosition {
  return {
    perpId: 16,
    symbol: "BTC",
    side: "long",
    size: 0.01,
    entryPrice: 80_000,
    markPrice: 80_000,
    collateral: 200,
    pnl: 0,
    funding: 0,
    liquidationPrice: 60_000,
    markValid: true,
    ...overrides,
  };
}

describe("positionRisk", () => {
  const hourly = new Map([[16, 3_600]]);

  it("measures a long: leverage on equity, distance to liquidation, a 10% adverse move", () => {
    const [risk] = positionRisk([position()], [market], hourly);
    expect(risk.notional).toBe(800);
    expect(risk.equity).toBe(200);
    expect(risk.effectiveLeverage).toBe(4);
    // Liquidation at 60,000 from a mark of 80,000: a 25% fall.
    expect(risk.liquidationDistance).toBeCloseTo(-0.25, 12);
    expect(risk.pnlAt10PctAdverse).toBeCloseTo(-80, 12);
    // Positive funding: a long pays 0.01% of 800 every hour.
    expect(risk.fundingPerDay).toBeCloseTo(-0.0001 * 24 * 800, 12);
  });

  it("measures a short: liquidation above the mark, funding received", () => {
    const [risk] = positionRisk([position({ side: "short", liquidationPrice: 100_000 })], [market], hourly);
    expect(risk.liquidationDistance).toBeCloseTo(0.25, 12);
    expect(risk.fundingPerDay).toBeGreaterThan(0);
  });

  it("counts losses against equity, and says nothing it cannot know", () => {
    const [risk] = positionRisk([position({ pnl: -250, liquidationPrice: null })], [market], hourly);
    expect(risk.equity).toBe(-50);
    expect(risk.effectiveLeverage).toBeNull();
    expect(risk.liquidationDistance).toBeNull();
    // No maintenance fraction has been read in this process.
    expect(risk.health).toBeNull();
  });
});
