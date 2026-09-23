import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";

import {
  Q96,
  baseDelta,
  baseForQuoteAt,
  curveTotals,
  quoteDelta,
  sqrtX96ToPrice,
  type RawSegment,
} from "@/lib/juno/curve-math";

/**
 * `CurveMath.sol` in bigint.
 *
 * The launchpad validates a curve with this arithmetic, so the port has to
 * agree with it to the wei — including *which way it rounds*. A curve that
 * rounds the other way from the contract can pass here and revert on-chain by
 * a single unit of supply. These tests pin the rounding against an 80-digit
 * reference, and the identities any correct implementation satisfies.
 */

const D = Decimal.clone({ precision: 80 });
const q96 = new D(Q96.toString());

/** Exact base held between two prices: L · (√b − √a) / (√a · √b), in Q96. */
function exactBase(a: bigint, b: bigint, liquidity: bigint): Decimal {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return new D(liquidity.toString())
    .mul(q96)
    .mul(new D((hi - lo).toString()))
    .div(new D(lo.toString()).mul(new D(hi.toString())));
}

/** Exact quote held between two prices: L · (√b − √a) / Q96. */
function exactQuote(a: bigint, b: bigint, liquidity: bigint): Decimal {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return new D(liquidity.toString()).mul(new D((hi - lo).toString())).div(q96);
}

/** Price pairs spanning the ranges real curves use, from dust to large. */
const CASES: Array<[bigint, bigint, bigint]> = [
  [Q96, 2n * Q96, 10n ** 18n],
  [Q96 / 1_000n, Q96 / 999n, 123_456_789_012_345_678_901n],
  [79_228_162_514_264n, 81_234_567_890_123n, 987_654_321_987_654_321_987n],
  [1n << 32n, (1n << 32n) + 12_345n, 10n ** 30n],
  [Q96 * 7n, Q96 * 7n + 3n, 5n * 10n ** 26n],
  [3_141_592_653_589_793n, 2_718_281_828_459_045_235n, 42n * 10n ** 20n],
];

describe("baseDelta / quoteDelta", () => {
  it("pins the textbook case exactly", () => {
    // Price 1 → price 4 with L = 1e18: base = L·(1 − ½) and quote = L·(2 − 1).
    expect(baseDelta(Q96, 2n * Q96, 10n ** 18n, false)).toBe(5n * 10n ** 17n);
    expect(baseDelta(Q96, 2n * Q96, 10n ** 18n, true)).toBe(5n * 10n ** 17n);
    expect(quoteDelta(Q96, 2n * Q96, 10n ** 18n, false)).toBe(10n ** 18n);
    expect(quoteDelta(Q96, 2n * Q96, 10n ** 18n, true)).toBe(10n ** 18n);
  });

  it.each(CASES)("is symmetric in its price arguments (%s, %s)", (a, b, liquidity) => {
    for (const roundUp of [false, true]) {
      expect(baseDelta(a, b, liquidity, roundUp)).toBe(baseDelta(b, a, liquidity, roundUp));
      expect(quoteDelta(a, b, liquidity, roundUp)).toBe(quoteDelta(b, a, liquidity, roundUp));
    }
  });

  it.each(CASES)("rounds down below and up above the exact value (%s, %s)", (a, b, liquidity) => {
    const base = exactBase(a, b, liquidity);
    const downBase = new D(baseDelta(a, b, liquidity, false).toString());
    const upBase = new D(baseDelta(a, b, liquidity, true).toString());
    expect(downBase.lte(base)).toBe(true);
    expect(upBase.gte(base)).toBe(true);
    // Two divisions, each off by at most one.
    expect(upBase.minus(downBase).lte(2)).toBe(true);

    const quote = exactQuote(a, b, liquidity);
    const downQuote = new D(quoteDelta(a, b, liquidity, false).toString());
    const upQuote = new D(quoteDelta(a, b, liquidity, true).toString());
    expect(downQuote.lte(quote)).toBe(true);
    expect(upQuote.gte(quote)).toBe(true);
    expect(upQuote.minus(downQuote).lte(1)).toBe(true);
  });

  it("is zero across an empty range", () => {
    expect(baseDelta(Q96, Q96, 10n ** 24n, true)).toBe(0n);
    expect(quoteDelta(Q96, Q96, 10n ** 24n, true)).toBe(0n);
  });

  it("is zero, not rounded up to one, with no liquidity", () => {
    expect(baseDelta(Q96, 2n * Q96, 0n, true)).toBe(0n);
    expect(quoteDelta(Q96, 2n * Q96, 0n, true)).toBe(0n);
  });

  it("splits a range into parts that add back up, within rounding", () => {
    const [a, b, c, liquidity] = [Q96, (Q96 * 3n) / 2n, 2n * Q96, 10n ** 24n];
    const whole = baseDelta(a, c, liquidity, true);
    const parts = baseDelta(a, b, liquidity, true) + baseDelta(b, c, liquidity, true);
    // Rounding up per part can only add, and by at most one per division.
    expect(parts >= whole).toBe(true);
    expect(parts - whole <= 4n).toBe(true);
  });

  it("prices a thin range at its own price", () => {
    // Over a sliver of range, quote / base is the price itself.
    const sqrt = Q96 * 3n;
    const liquidity = 10n ** 30n;
    const quote = quoteDelta(sqrt, sqrt + 10n ** 12n, liquidity, false);
    const base = baseDelta(sqrt, sqrt + 10n ** 12n, liquidity, false);
    expect(Number(quote) / Number(base)).toBeCloseTo(9, 6);
  });
});

describe("baseForQuoteAt", () => {
  it("values quote in base at the given price", () => {
    // Price 4: a quote amount buys a quarter as much base.
    expect(baseForQuoteAt(4n * 10n ** 18n, 2n * Q96)).toBe(10n ** 18n);
    // Price 1: one for one.
    expect(baseForQuoteAt(123_456n, Q96)).toBe(123_456n);
  });

  it.each(CASES)("rounds down, never granting base the quote does not cover (%s)", (sqrt, _b, quote) => {
    const exact = new D(quote.toString()).mul(q96).mul(q96).div(new D(sqrt.toString()).pow(2));
    const got = new D(baseForQuoteAt(quote, sqrt).toString());
    expect(got.lte(exact)).toBe(true);
    // Two floors, the first scaled by the second multiplication: the shortfall
    // is under Q96/√P + 1, and a whole unit or less at any price ≥ 1.
    const bound = q96.div(new D(sqrt.toString())).add(1);
    expect(exact.minus(got).lt(bound)).toBe(true);
  });

  it("is zero for zero quote", () => {
    expect(baseForQuoteAt(0n, Q96)).toBe(0n);
  });
});

describe("curveTotals", () => {
  const start = Q96;
  const curve: RawSegment[] = [
    { sqrtPriceX96: (Q96 * 3n) / 2n, liquidity: 10n ** 21n },
    { sqrtPriceX96: 2n * Q96, liquidity: 2n * 10n ** 21n },
  ];

  it("sums each range from the previous upper bound, rounding up", () => {
    const totals = curveTotals(start, curve);
    expect(totals.curveBase).toBe(
      baseDelta(start, curve[0].sqrtPriceX96, curve[0].liquidity, true) +
        baseDelta(curve[0].sqrtPriceX96, curve[1].sqrtPriceX96, curve[1].liquidity, true),
    );
    expect(totals.threshold).toBe(
      quoteDelta(start, curve[0].sqrtPriceX96, curve[0].liquidity, true) +
        quoteDelta(curve[0].sqrtPriceX96, curve[1].sqrtPriceX96, curve[1].liquidity, true),
    );
  });

  it("prices the AMM's reserve at the curve's top", () => {
    const totals = curveTotals(start, curve);
    expect(totals.migrationBase).toBe(baseForQuoteAt(totals.threshold, curve[1].sqrtPriceX96));
  });

  it("is all zeros for an empty curve", () => {
    expect(curveTotals(start, [])).toEqual({ curveBase: 0n, threshold: 0n, migrationBase: 0n });
  });
});

describe("sqrtX96ToPrice", () => {
  it("reads a Q96 square root as a UI price, adjusting for decimals", () => {
    expect(sqrtX96ToPrice(Q96, 18, 18)).toBe(1);
    expect(sqrtX96ToPrice(2n * Q96, 18, 18)).toBe(4);
    // A raw price of 1e-12 USDC-wei per token-wei is one USDC per token.
    expect(sqrtX96ToPrice(Q96 / 1_000_000n, 18, 6)).toBeCloseTo(1, 9);
  });
});
