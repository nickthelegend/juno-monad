import { describe, expect, it } from "vitest";

import {
  BASE_DECIMALS,
  CURVE_PRESETS,
  CURVE_PRESET_LIST,
  CURVE_SEGMENTS,
  DEFAULT_TOTAL_SUPPLY,
  FEE_PERIODS,
  MAX_FEE_BPS,
  MIN_FEE_BPS,
  PRESET_INDEX,
  buildPresetParams,
  feeDecayWad,
  presetFromIndex,
  validateCurveParams,
  type CurveParams,
} from "@/lib/juno/curves";
import { curveTotals, sqrtX96ToPrice } from "@/lib/juno/curve-math";
import type { CurvePresetId } from "@/lib/juno/types";

/**
 * The presets are the substance of a Juno launch, so they are tested against
 * the launchpad's own rules rather than eyeballed. `validateCurveParams` is
 * `JunoLaunchpad.launch`'s validation restated, and `curveTotals` is
 * `_checkCurve`'s arithmetic bit for bit — a curve that passes here is one the
 * contract accepts, and one that would revert fails here first, before anyone
 * signs anything.
 */

/**
 * The two quote tokens a launch can use, at the valuation the app opens them
 * at. The graduation valuation is each preset's own range above that.
 */
const QUOTES = [
  { label: "MON", quoteDecimals: 18, initialMarketCap: 40_000 },
  { label: "USDC", quoteDecimals: 6, initialMarketCap: 1_000 },
] as const;

/** The launchpad's fixed supply, in raw units: 1e27. */
const SUPPLY = BigInt(DEFAULT_TOTAL_SUPPLY) * 10n ** BigInt(BASE_DECIMALS);

const CASES = CURVE_PRESET_LIST.flatMap((preset) =>
  QUOTES.map((quote) => ({
    preset: preset.id,
    ...quote,
    migrationMarketCap: quote.initialMarketCap * preset.defaultCapMultiple,
  })),
);

function build(c: (typeof CASES)[number]): CurveParams {
  return buildPresetParams({
    preset: c.preset,
    initialMarketCap: c.initialMarketCap,
    migrationMarketCap: c.migrationMarketCap,
    quoteDecimals: c.quoteDecimals,
  });
}

describe("curve presets × quote tokens", () => {
  it.each(CASES)("$preset in $label builds a curve the launchpad accepts", (c) => {
    expect(validateCurveParams(build(c))).toBeNull();
  });

  it.each(CASES)("$preset in $label has sixteen strictly increasing ranges above the start", (c) => {
    const params = build(c);
    expect(params.curve).toHaveLength(CURVE_SEGMENTS);
    let lower = params.sqrtStartPriceX96;
    for (const segment of params.curve) {
      expect(segment.sqrtPriceX96 > lower).toBe(true);
      expect(segment.liquidity > 0n).toBe(true);
      expect(segment.liquidity < 1n << 128n).toBe(true);
      lower = segment.sqrtPriceX96;
    }
  });

  it.each(CASES)("$preset in $label uses the supply without exceeding it", (c) => {
    const { totals } = build(c);
    const used = totals.curveBase + totals.migrationBase;
    // Never more than the fixed supply, or `launch` reverts with SupplyExceeded.
    expect(used <= SUPPLY).toBe(true);
    // And not much less: the builder solves for 99%, with a hair of rounding.
    // A curve that sold far less would strand supply in the burned leftover.
    expect(used * 1000n >= SUPPLY * 989n).toBe(true);
    expect(totals.threshold > 0n).toBe(true);
  });

  it.each(CASES)("$preset in $label reports the totals the contract will compute", (c) => {
    const params = build(c);
    expect(curveTotals(params.sqrtStartPriceX96, params.curve)).toEqual(params.totals);
  });

  it.each(CASES)("$preset in $label opens and graduates at the valuations it was given", (c) => {
    const params = build(c);
    const openCap = sqrtX96ToPrice(params.sqrtStartPriceX96, BASE_DECIMALS, c.quoteDecimals) * DEFAULT_TOTAL_SUPPLY;
    const top = params.curve[params.curve.length - 1].sqrtPriceX96;
    const closeCap = sqrtX96ToPrice(top, BASE_DECIMALS, c.quoteDecimals) * DEFAULT_TOTAL_SUPPLY;
    expect(openCap / c.initialMarketCap).toBeCloseTo(1, 6);
    expect(closeCap / c.migrationMarketCap).toBeCloseTo(1, 6);
  });

  it.each(CASES)("$preset in $label seeds the AMM at the price the curve finished on", (c) => {
    // Graduation is continuous: the reserved base, priced at the curve's top,
    // is worth exactly the quote the curve raised.
    const params = build(c);
    const topPrice = sqrtX96ToPrice(params.curve[params.curve.length - 1].sqrtPriceX96, BASE_DECIMALS, c.quoteDecimals);
    const raised = Number(params.totals.threshold) / 10 ** c.quoteDecimals;
    const reserved = Number(params.totals.migrationBase) / 10 ** BASE_DECIMALS;
    expect((reserved * topPrice) / raised).toBeCloseTo(1, 6);
  });

  it.each(CASES)("$preset in $label carries the preset's id and fees", (c) => {
    const params = build(c);
    const preset = CURVE_PRESETS[c.preset];
    expect(params.preset).toBe(PRESET_INDEX[c.preset]);
    expect(params.startFeeBps).toBe(preset.startingFeeBps);
    expect(params.endFeeBps).toBe(preset.endingFeeBps);
    expect(params.feeDecaySeconds).toBe(preset.feeDecaySeconds);
    expect(params.feeDecayWad).toBe(feeDecayWad(preset.startingFeeBps, preset.endingFeeBps));
  });
});

describe("preset shapes", () => {
  it("uses all sixteen segments so the weights actually shape the curve", () => {
    for (const preset of CURVE_PRESET_LIST) {
      expect(preset.weights).toHaveLength(CURVE_SEGMENTS);
      expect(preset.weights.every((w) => w > 0)).toBe(true);
    }
  });

  it("decays fees from an anti-snipe opening to an equity-like spread", () => {
    for (const preset of CURVE_PRESET_LIST) {
      expect(preset.startingFeeBps).toBeGreaterThan(preset.endingFeeBps);
      expect(preset.endingFeeBps).toBeGreaterThanOrEqual(MIN_FEE_BPS);
      expect(preset.startingFeeBps).toBeLessThanOrEqual(MAX_FEE_BPS);
    }
  });

  it("shapes each preset the way its description claims", () => {
    const first = (id: CurvePresetId) => CURVE_PRESETS[id].weights[0];
    const last = (id: CurvePresetId) => CURVE_PRESETS[id].weights[CURVE_SEGMENTS - 1];
    const mid = (id: CurvePresetId) => CURVE_PRESETS[id].weights[CURVE_SEGMENTS / 2];

    // Content back-loads liquidity: cheap early, steep late.
    expect(last("content")).toBeGreaterThan(first("content"));

    // A thin name front-loads it, for depth at the issue price.
    expect(first("thin-name")).toBeGreaterThan(last("thin-name"));

    // An IPO book is deep at both ends and thin through discovery.
    expect(first("ipo-book")).toBeGreaterThan(mid("ipo-book"));
    expect(last("ipo-book")).toBeGreaterThan(mid("ipo-book"));

    // Tight NAV is flat: uniform liquidity everywhere.
    expect(new Set(CURVE_PRESETS["tight-nav"].weights).size).toBe(1);
  });

  it("carries the weights through to the on-chain liquidity, in proportion", () => {
    for (const preset of CURVE_PRESET_LIST) {
      const params = buildPresetParams({
        preset: preset.id,
        ...QUOTES[1],
        migrationMarketCap: QUOTES[1].initialMarketCap * preset.defaultCapMultiple,
      });
      const ratio = Number(params.curve[CURVE_SEGMENTS - 1].liquidity) / Number(params.curve[0].liquidity);
      expect(ratio).toBeCloseTo(preset.weights[CURVE_SEGMENTS - 1] / preset.weights[0], 4);
    }
  });

  it("maps every preset to a distinct on-chain id and back", () => {
    const ids = Object.values(PRESET_INDEX);
    expect(new Set(ids).size).toBe(CURVE_PRESET_LIST.length);
    for (const preset of CURVE_PRESET_LIST) {
      expect(presetFromIndex(PRESET_INDEX[preset.id])).toBe(preset.id);
    }
    // An id the app does not know reads back as the default rather than crashing a page.
    expect(presetFromIndex(99)).toBe("content");
  });
});

describe("feeDecayWad", () => {
  /** The contract's decay, in WAD integer maths: fee(n) = start · (1 − decay)ⁿ. */
  function feeAfter(startBps: number, wad: bigint, periods: number): number {
    const one = 10n ** 18n;
    let fee = BigInt(startBps) * one;
    for (let i = 0; i < periods; i++) fee = (fee * (one - wad)) / one;
    return Number(fee) / 1e18;
  }

  it.each(CURVE_PRESET_LIST.map((p) => [p.id, p.startingFeeBps, p.endingFeeBps] as const))(
    "%s decays from %i bps to %i bps over the full schedule",
    (_id, start, end) => {
      const wad = feeDecayWad(start, end);
      expect(wad > 0n && wad < 10n ** 18n).toBe(true);
      const final = feeAfter(start, wad, FEE_PERIODS);
      expect(final).toBeCloseTo(end, 6);
      // Floored decay never undershoots the floor the preset promises.
      expect(final).toBeGreaterThanOrEqual(end - 1e-9);
      // And it really is decaying: halfway is strictly between the two.
      const half = feeAfter(start, wad, FEE_PERIODS / 2);
      expect(half).toBeLessThan(start);
      expect(half).toBeGreaterThan(end);
    },
  );

  it("is zero for a flat fee", () => {
    expect(feeDecayWad(100, 100)).toBe(0n);
  });
});

describe("invalid inputs", () => {
  const good = { preset: "content" as const, initialMarketCap: 1_000, migrationMarketCap: 25_000, quoteDecimals: 6 };

  it("refuses a graduation valuation at or below the opening one", () => {
    expect(() => buildPresetParams({ ...good, migrationMarketCap: 1_000 })).toThrow(/above the opening/);
    expect(() => buildPresetParams({ ...good, migrationMarketCap: 500 })).toThrow(/above the opening/);
  });

  it("refuses a zero, negative or non-numeric opening valuation", () => {
    expect(() => buildPresetParams({ ...good, initialMarketCap: 0 })).toThrow();
    expect(() => buildPresetParams({ ...good, initialMarketCap: -5 })).toThrow();
    expect(() => buildPresetParams({ ...good, initialMarketCap: Number.NaN })).toThrow();
  });

  it("refuses a tight-nav range wider than it stays flat over", () => {
    expect(() =>
      buildPresetParams({ ...good, preset: "tight-nav", migrationMarketCap: 25_000 }),
    ).toThrow(/near-flat only up to 3x/);
    // Its own default, and its maximum, are fine.
    expect(validateCurveParams(buildPresetParams({ ...good, preset: "tight-nav", migrationMarketCap: 1_500 }))).toBeNull();
    expect(validateCurveParams(buildPresetParams({ ...good, preset: "tight-nav", migrationMarketCap: 3_000 }))).toBeNull();
  });

  it("refuses an unknown preset", () => {
    expect(() => buildPresetParams({ ...good, preset: "moonshot" as CurvePresetId })).toThrow(/Unknown preset/);
  });

  it("refuses an opening valuation too small to price", () => {
    // Below the launchpad's MIN_SQRT_PRICE the start price rounds to nothing.
    expect(() => buildPresetParams({ ...good, initialMarketCap: 1e-20, migrationMarketCap: 1 })).toThrow(/too small/);
  });
});

describe("validateCurveParams catches what the contract would revert on", () => {
  const params = buildPresetParams({ preset: "ipo-book", initialMarketCap: 1_000, migrationMarketCap: 25_000, quoteDecimals: 6 });

  it("the wrong number of ranges", () => {
    expect(validateCurveParams({ ...params, curve: params.curve.slice(1) })).toMatch(/16 ranges/);
  });

  it("fees outside the contract's bounds, or rising", () => {
    expect(validateCurveParams({ ...params, startFeeBps: MAX_FEE_BPS + 1 })).toMatch(/maximum/);
    expect(validateCurveParams({ ...params, endFeeBps: MIN_FEE_BPS - 1 })).toMatch(/minimum/);
    expect(validateCurveParams({ ...params, endFeeBps: params.startFeeBps + 1 })).toMatch(/above the launch fee/);
    expect(validateCurveParams({ ...params, feeDecayWad: 10n ** 18n })).toMatch(/decay/);
  });

  it("a start price below the minimum", () => {
    expect(validateCurveParams({ ...params, sqrtStartPriceX96: 1n })).toMatch(/Start price/);
  });

  it("ranges that do not strictly increase", () => {
    const curve = params.curve.map((s) => ({ ...s }));
    curve[5] = { ...curve[5], sqrtPriceX96: curve[4].sqrtPriceX96 };
    expect(validateCurveParams({ ...params, curve })).toMatch(/strictly increase/);
  });

  it("an empty or overflowing range", () => {
    const empty = params.curve.map((s, i) => (i === 3 ? { ...s, liquidity: 0n } : s));
    expect(validateCurveParams({ ...params, curve: empty })).toMatch(/needs liquidity/);
    const huge = params.curve.map((s, i) => (i === 3 ? { ...s, liquidity: 1n << 128n } : s));
    expect(validateCurveParams({ ...params, curve: huge })).toMatch(/uint128/);
  });

  it("a curve that needs more than the fixed supply", () => {
    const doubled = params.curve.map((s) => ({ ...s, liquidity: s.liquidity * 2n }));
    expect(validateCurveParams({ ...params, curve: doubled })).toMatch(/fixed supply/);
  });
});
