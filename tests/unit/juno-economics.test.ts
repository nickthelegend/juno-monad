import { describe, expect, it } from "vitest";

import { CURVE_PRESETS, CURVE_PRESET_LIST, DEFAULT_TOTAL_SUPPLY, FEE_PERIODS, buildPresetParams, feeDecayWad } from "@/lib/juno/curves";
import { feeSchedule, tokenomics, type FeeFields } from "@/lib/juno/economics";

/**
 * The economics a pool was launched with, as the coin page shows them.
 *
 * Both halves are promises a trader cannot otherwise check: that the opening
 * fee really decays to the preset's resting spread, and where the fixed supply
 * actually goes. They are computed from the pool's on-chain fields, so these
 * tests feed them the fields a real launch would have.
 */

const LAUNCHED_AT = 1_790_000_000;

function fieldsFor(presetIndex: number): FeeFields {
  const preset = CURVE_PRESET_LIST[presetIndex];
  return {
    startFeeBps: preset.startingFeeBps,
    endFeeBps: preset.endingFeeBps,
    feeDecaySeconds: preset.feeDecaySeconds,
    feeDecayWad: feeDecayWad(preset.startingFeeBps, preset.endingFeeBps),
    launchedAt: LAUNCHED_AT,
  };
}

describe("feeSchedule", () => {
  it.each(CURVE_PRESET_LIST.map((preset, index) => [preset.id, index] as const))(
    "%s: the plotted points fall monotonically from the launch fee to the resting one",
    (_id, index) => {
      const fields = fieldsFor(index);
      const schedule = feeSchedule(fields, LAUNCHED_AT)!;
      const points = schedule.points;

      expect(points[0]).toEqual({ period: 0, bps: fields.startFeeBps });
      expect(points[points.length - 1].period).toBe(FEE_PERIODS);
      expect(points[points.length - 1].bps).toBeCloseTo(fields.endFeeBps, 6);

      for (let i = 1; i < points.length; i++) {
        expect(points[i].period).toBeGreaterThanOrEqual(points[i - 1].period);
        expect(points[i].bps).toBeLessThanOrEqual(points[i - 1].bps);
        // Never below the floor the preset promises.
        expect(points[i].bps).toBeGreaterThanOrEqual(fields.endFeeBps);
      }
    },
  );

  it("charges the launch fee at launch and the resting fee once decayed", () => {
    const fields = fieldsFor(0);
    const atLaunch = feeSchedule(fields, LAUNCHED_AT)!;
    expect(atLaunch.currentBps).toBe(fields.startFeeBps);
    expect(atLaunch.period).toBe(0);
    expect(atLaunch.secondsRemaining).toBe(fields.feeDecaySeconds);

    const later = feeSchedule(fields, LAUNCHED_AT + fields.feeDecaySeconds + 60)!;
    expect(later.currentBps).toBe(fields.endFeeBps);
    expect(later.period).toBe(FEE_PERIODS);
    expect(later.secondsRemaining).toBe(0);
  });

  it("is part-way down part-way through", () => {
    const fields = fieldsFor(0);
    const half = feeSchedule(fields, LAUNCHED_AT + fields.feeDecaySeconds / 2)!;
    expect(half.period).toBe(FEE_PERIODS / 2);
    expect(half.currentBps).toBeLessThan(fields.startFeeBps);
    expect(half.currentBps).toBeGreaterThan(fields.endFeeBps);
  });

  it("does not run backwards on clock skew", () => {
    const fields = fieldsFor(0);
    const early = feeSchedule(fields, LAUNCHED_AT - 500)!;
    expect(early.period).toBe(0);
    expect(early.currentBps).toBe(fields.startFeeBps);
  });

  it("is flat when the fee does not decay", () => {
    const flat = feeSchedule({ ...fieldsFor(0), startFeeBps: 100, endFeeBps: 100, feeDecayWad: 0n }, LAUNCHED_AT)!;
    expect(new Set(flat.points.map((p) => p.bps))).toEqual(new Set([100]));
  });

  it("has nothing to say about a pool with no fee fields", () => {
    expect(feeSchedule({ ...fieldsFor(0), startFeeBps: 0 }, LAUNCHED_AT)).toBeNull();
  });
});

describe("tokenomics", () => {
  const SUPPLY = BigInt(DEFAULT_TOTAL_SUPPLY) * 10n ** 18n;

  it.each(CURVE_PRESET_LIST.map((preset) => preset.id))("%s: the three parts sum to the fixed supply", (id) => {
    const params = buildPresetParams({
      preset: id,
      initialMarketCap: 1_000,
      migrationMarketCap: 1_000 * CURVE_PRESETS[id].defaultCapMultiple,
      quoteDecimals: 6,
    });
    const split = tokenomics({
      sqrtStartPriceX96: params.sqrtStartPriceX96,
      curve: params.curve,
      totalSupply: SUPPLY,
      baseDecimals: 18,
    })!;

    expect(split.totalSupply).toBe(DEFAULT_TOTAL_SUPPLY);
    expect(split.curveAmount + split.migrationAmount + split.leftoverAmount).toBeCloseTo(DEFAULT_TOTAL_SUPPLY, 0);
    expect(split.curvePct + split.migrationPct + split.leftoverPct).toBeCloseTo(1, 12);

    // The builder aims for a 1% rounding buffer; it must never go negative.
    expect(split.leftoverAmount).toBeGreaterThanOrEqual(0);
    expect(split.leftoverPct).toBeLessThan(0.011);
    // Both real destinations get a meaningful share.
    expect(split.curvePct).toBeGreaterThan(0.1);
    expect(split.migrationPct).toBeGreaterThan(0.01);
  });

  it("has nothing to say about a token with no supply", () => {
    const params = buildPresetParams({ preset: "content", initialMarketCap: 1_000, migrationMarketCap: 25_000, quoteDecimals: 6 });
    expect(
      tokenomics({ sqrtStartPriceX96: params.sqrtStartPriceX96, curve: params.curve, totalSupply: 0n, baseDecimals: 18 }),
    ).toBeNull();
  });
});
