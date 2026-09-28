/**
 * Juno's bonding-curve presets, and the builder that turns one into the exact
 * arguments `JunoLaunchpad.launch` takes.
 *
 * This is the part of Juno that is not a memecoin launchpad. A Juno curve is a
 * start price and sixteen ranges above it, each holding its own liquidity, and
 * the weights across those ranges are what give a launch its character:
 *
 *   more liquidity in a range  →  more supply absorbed per unit of price
 *                             →  a flatter stretch of curve
 *
 * A memecoin launch back-loads its weights: nearly free at the start, near
 * vertical at the end, graduate as fast as possible. An equity-like launch
 * wants the opposite properties in different places — a deep book near the
 * issue price so early size does not gap the print, real price discovery in
 * the middle, and a flattening near the target cap so the pool does not moon
 * away from the underlying before it graduates.
 *
 * ## The solve
 *
 * Given a start and end valuation and sixteen weights, the builder places the
 * range boundaries geometrically between the two prices and then solves for
 * the one liquidity scale at which
 *
 *     supply sold on the curve + supply reserved for the AMM = 99% of supply
 *
 * where the AMM's share is the quote the curve raises, priced at the curve's
 * top. That last clause is what makes graduation continuous: the pair opens at
 * exactly the price the curve finished on. The remaining 1% is a rounding
 * buffer the launchpad burns at graduation.
 *
 * This is the same solve Meteora's `buildCurveWithLiquidityWeights` performs
 * for its Dynamic Bonding Curve — Juno ran on DBC before it ran on Monad, and
 * the four presets below are unchanged. What changed is who enforces it: the
 * curve is now checked by Juno's own contract (`contracts/src/JunoLaunchpad.sol`),
 * and `curveTotals` below runs the contract's arithmetic so a curve that
 * would revert fails here first.
 */

import Decimal from "decimal.js";

import { Q96, curveTotals, type CurveTotals, type RawSegment } from "./curve-math";
import type { CurvePresetId } from "./types";

/** The launchpad takes exactly sixteen ranges. */
export const CURVE_SEGMENTS = 16;

/** One billion tokens, fixed by the launchpad. */
export const DEFAULT_TOTAL_SUPPLY = 1_000_000_000;

/** Every Juno token has 18 decimals, like the native MON it usually trades against. */
export const BASE_DECIMALS = 18;

/** Fees decay over this many steps, as in the contract. */
export const FEE_PERIODS = 60;

/** Bounds the contract enforces on the launch and resting fees. */
export const MAX_FEE_BPS = 9_900;
export const MIN_FEE_BPS = 25;

/** Share of supply reserved as the builder's rounding buffer. */
const LEFTOVER_RATIO = 0.01;

/** Smallest start price the contract accepts: 2^32 in Q96. */
const MIN_SQRT_PRICE = 1n << 32n;

export type CurvePreset = {
  id: CurvePresetId;
  label: string;
  /** One line, shown under the preset in the launch form. */
  tagline: string;
  /** Why an issuer would pick this, shown on the detail panel. */
  rationale: string;
  /** Sixteen liquidity weights — the shape of the curve. */
  weights: number[];
  /** Fee at launch, decaying to `endingFeeBps` over `feeDecaySeconds`. */
  startingFeeBps: number;
  endingFeeBps: number;
  feeDecaySeconds: number;
  /**
   * Equity presets hold the curve price to a band around a reference feed.
   * Advisory in the UI — the on-chain graduation trigger is still the curve
   * reaching its top — but it is what makes the launch equity-like.
   */
  navBandBps?: number;
  /**
   * Graduation valuation over opening valuation, when the issuer does not
   * choose one.
   *
   * The weights decide where liquidity sits inside the price range; the caps
   * decide how wide that range is. No weighting makes a 25x run flat, so a
   * preset that promises flatness has to own its range too —
   * `scripts/juno-compare-presets.ts` measures the difference.
   */
  defaultCapMultiple: number;
  /** The widest range this preset still behaves as described in. */
  maxCapMultiple?: number;
};

/**
 * Geometric weights. `ratio > 1` back-loads liquidity (flat late, steep
 * early); `ratio < 1` front-loads it (deep near the issue price).
 */
function geometric(ratio: number, segments = CURVE_SEGMENTS): number[] {
  return Array.from({ length: segments }, (_, i) => Number(Math.pow(ratio, i).toFixed(6)));
}

/**
 * A book-shaped curve: a deep flat stretch to absorb the opening auction, a
 * thin middle where price is actually discovered, then depth again near the
 * target cap so the last buyers do not pay a vertical.
 */
function bookShaped(segments = CURVE_SEGMENTS): number[] {
  const mid = (segments - 1) / 2;
  return Array.from({ length: segments }, (_, i) => {
    // Parabola in [0,1]: 1 at the edges, ~0.25 in the middle.
    const t = (i - mid) / mid;
    return Number((0.25 + 0.75 * t * t).toFixed(6));
  });
}

export const CURVE_PRESETS: Record<CurvePresetId, CurvePreset> = {
  /**
   * The default for a Juno post. Closest to a conventional content coin:
   * cheap to mint into, graduates on modest volume.
   */
  content: {
    id: "content",
    label: "Content",
    tagline: "Default for posts. Cheap entry, graduates on modest volume.",
    rationale:
      "Back-loaded liquidity so early collectors get in cheaply and the curve steepens as the post finds an audience. Fees start high to blunt snipers in the first few minutes, then settle to 1%.",
    weights: geometric(1.2),
    startingFeeBps: 900,
    endingFeeBps: 100,
    feeDecaySeconds: 600,
    defaultCapMultiple: 25,
  },

  /**
   * A newly tokenized, thinly traded name. The failure mode here is a single
   * $500 order gapping the print 40%, so liquidity is front-loaded hard.
   */
  "thin-name": {
    id: "thin-name",
    label: "Thin name",
    tagline: "Newly tokenized, low float. Deep at the issue price.",
    rationale:
      "Front-loaded liquidity gives a deep book at the issue price, so early size fills without gapping the print — the main risk for a name with no existing market. Price only starts moving once real demand clears the opening depth.",
    weights: geometric(0.82),
    startingFeeBps: 500,
    endingFeeBps: 60,
    feeDecaySeconds: 900,
    defaultCapMultiple: 25,
    navBandBps: 500,
  },

  /**
   * Book-building: depth at the opening, discovery in the middle, depth again
   * at the target cap. The shape of an IPO order book, not a memecoin.
   */
  "ipo-book": {
    id: "ipo-book",
    label: "IPO book",
    tagline: "Deep open, real discovery mid-curve, flat near the target cap.",
    rationale:
      "A book-shaped curve: depth at the open to absorb the initial auction, a thin middle where price is genuinely discovered, then depth again approaching the target cap so the pool does not moon into nonsense before it graduates.",
    weights: bookShaped(),
    startingFeeBps: 400,
    endingFeeBps: 50,
    feeDecaySeconds: 900,
    defaultCapMultiple: 25,
    navBandBps: 400,
  },

  /**
   * Near-constant price. For a token that is supposed to track an underlying,
   * a curve that runs away from NAV is a bug, not a feature.
   */
  "tight-nav": {
    id: "tight-nav",
    label: "Tight NAV",
    tagline: "Near-flat curve for assets that should track an underlying.",
    rationale:
      "Uniform liquidity across all sixteen ranges keeps the curve close to flat, so the pool price stays near the reference feed instead of drifting off it. Paired with the tightest fee, this behaves like a spread rather than a launch.",
    weights: Array.from({ length: CURVE_SEGMENTS }, () => 1),
    startingFeeBps: 200,
    endingFeeBps: MIN_FEE_BPS,
    feeDecaySeconds: 300,
    defaultCapMultiple: 1.5,
    // At 1.5x a 1% move costs within 1.22x the same anywhere on the curve
    // (sqrt 1.5). At 25x it varied 5x and "near-flat" was not true.
    maxCapMultiple: 3,
    navBandBps: 200,
  },
};

export const CURVE_PRESET_LIST: CurvePreset[] = Object.values(CURVE_PRESETS);

/**
 * The preset's on-chain id. Stored in the pool and emitted in `Launched`, so a
 * pool read back from the chain says which shape it was built with.
 */
export const PRESET_INDEX: Record<CurvePresetId, number> = {
  content: 0,
  "thin-name": 1,
  "ipo-book": 2,
  "tight-nav": 3,
};

export function presetFromIndex(index: number): CurvePresetId {
  const found = (Object.keys(PRESET_INDEX) as CurvePresetId[]).find((id) => PRESET_INDEX[id] === index);
  return found ?? "content";
}

export type BuildPresetOptions = {
  preset: CurvePresetId;
  /** Fully diluted valuation at the first trade, in quote-token units. */
  initialMarketCap: number;
  /** FDV at which the curve completes and graduates. */
  migrationMarketCap: number;
  /** Decimals of the quote token — 18 for MON, 6 for USDC. */
  quoteDecimals: number;
  /** Total supply in UI units. Must match the launchpad's fixed supply. */
  totalTokenSupply?: number;
};

/** Exactly what `JunoLaunchpad.launch` takes, minus the metadata. */
export type CurveParams = {
  preset: number;
  sqrtStartPriceX96: bigint;
  curve: RawSegment[];
  startFeeBps: number;
  endFeeBps: number;
  feeDecaySeconds: number;
  /** Per-period decay in WAD: fee(n) = start * (1 - decay)^n. */
  feeDecayWad: bigint;
  /** What the contract will compute from `curve`, for display and checks. */
  totals: CurveTotals;
};

const WAD = new Decimal(10).pow(18);

/** fee(60) = end, so the per-period factor is (end/start)^(1/60). */
export function feeDecayWad(startBps: number, endBps: number): bigint {
  if (startBps === endBps) return 0n;
  const factor = new Decimal(endBps).div(startBps).pow(new Decimal(1).div(FEE_PERIODS));
  return BigInt(new Decimal(1).minus(factor).mul(WAD).floor().toFixed());
}

/**
 * Turn a preset into the curve the launchpad will accept.
 *
 * Throws on an input the contract would reject — a migration cap at or below
 * the initial one, a start price too small to trade on, or a curve that would
 * need more than the fixed supply.
 */
export function buildPresetParams(opts: BuildPresetOptions): CurveParams {
  const preset = CURVE_PRESETS[opts.preset];
  if (!preset) throw new Error(`Unknown preset "${opts.preset}"`);
  if (!(opts.initialMarketCap > 0) || !(opts.migrationMarketCap > opts.initialMarketCap)) {
    throw new Error("The graduation valuation must be above the opening valuation");
  }
  const multiple = opts.migrationMarketCap / opts.initialMarketCap;
  if (preset.maxCapMultiple !== undefined && multiple > preset.maxCapMultiple * (1 + 1e-9)) {
    throw new Error(
      `${preset.label} stays near-flat only up to ${preset.maxCapMultiple}x from opening to graduation; this asks for ${multiple.toFixed(1)}x`,
    );
  }

  const D = Decimal.clone({ precision: 80 });
  const totalSupply = opts.totalTokenSupply ?? DEFAULT_TOTAL_SUPPLY;
  const q96 = new D(Q96.toString());

  // Raw price = UI price scaled by the decimals difference: quote wei per base wei.
  const decimalsScale = new D(10).pow(opts.quoteDecimals - BASE_DECIMALS);
  const sqrtAt = (cap: number) => new D(cap).div(totalSupply).mul(decimalsScale).sqrt();

  const sMin = sqrtAt(opts.initialMarketCap);
  const sMax = sqrtAt(opts.migrationMarketCap);
  const ratio = sMax.div(sMin).pow(new D(1).div(CURVE_SEGMENTS));
  const s = Array.from({ length: CURVE_SEGMENTS + 1 }, (_, i) =>
    i === CURVE_SEGMENTS ? sMax : sMin.mul(ratio.pow(i)),
  );

  // Per unit of liquidity in range i: base the curve sells there, plus the
  // base the AMM will need for the quote that range raises, at the top price.
  const target = new D(totalSupply)
    .mul(1 - LEFTOVER_RATIO)
    .mul(new D(10).pow(BASE_DECIMALS));
  let sumFactor = new D(0);
  for (let i = 0; i < CURVE_SEGMENTS; i++) {
    const lo = s[i];
    const hi = s[i + 1];
    const sold = hi.minus(lo).div(lo.mul(hi));
    const reserved = hi.minus(lo).div(sMax.mul(sMax));
    sumFactor = sumFactor.add(new D(preset.weights[i]).mul(sold.add(reserved)));
  }
  const unit = target.div(sumFactor);

  const toX96 = (value: Decimal) => BigInt(value.mul(q96).floor().toFixed());
  const sqrtStartPriceX96 = toX96(sMin);
  if (sqrtStartPriceX96 < MIN_SQRT_PRICE) {
    throw new Error("The opening valuation is too small to price in this quote token");
  }

  let curve: RawSegment[] = s.slice(1).map((value, i) => ({
    sqrtPriceX96: toX96(value),
    liquidity: BigInt(unit.mul(preset.weights[i]).floor().toFixed()),
  }));

  // Rounding up on every range can nudge the total a hair over; shave it.
  const limit = BigInt(totalSupply) * 10n ** BigInt(BASE_DECIMALS);
  let totals = curveTotals(sqrtStartPriceX96, curve);
  for (let attempt = 0; totals.curveBase + totals.migrationBase > limit && attempt < 8; attempt++) {
    curve = curve.map((segment) => ({ ...segment, liquidity: (segment.liquidity * 9_999n) / 10_000n }));
    totals = curveTotals(sqrtStartPriceX96, curve);
  }
  if (totals.curveBase + totals.migrationBase > limit) {
    throw new Error("This curve needs more than the fixed supply");
  }
  if (curve.some((segment) => segment.liquidity <= 0n)) {
    throw new Error("A range of this curve rounds to zero liquidity");
  }

  return {
    preset: PRESET_INDEX[preset.id],
    sqrtStartPriceX96,
    curve,
    startFeeBps: preset.startingFeeBps,
    endFeeBps: preset.endingFeeBps,
    feeDecaySeconds: preset.feeDecaySeconds,
    feeDecayWad: feeDecayWad(preset.startingFeeBps, preset.endingFeeBps),
    totals,
  };
}

/**
 * The contract's own validation, restated, for tests and the launch form.
 * Returns the first reason a launch would revert, or null.
 */
export function validateCurveParams(params: CurveParams): string | null {
  if (params.curve.length !== CURVE_SEGMENTS) return `Expected ${CURVE_SEGMENTS} ranges`;
  if (params.startFeeBps > MAX_FEE_BPS) return "Launch fee above the maximum";
  if (params.endFeeBps < MIN_FEE_BPS) return "Resting fee below the minimum";
  if (params.endFeeBps > params.startFeeBps) return "Resting fee above the launch fee";
  if (params.feeDecayWad >= 10n ** 18n) return "Fee decay must be below 100% per period";
  if (params.sqrtStartPriceX96 < MIN_SQRT_PRICE) return "Start price too small";

  let lower = params.sqrtStartPriceX96;
  for (const segment of params.curve) {
    if (segment.sqrtPriceX96 <= lower) return "Range prices must strictly increase";
    if (segment.liquidity <= 0n) return "Every range needs liquidity";
    if (segment.liquidity >= 1n << 128n) return "Range liquidity overflows uint128";
    lower = segment.sqrtPriceX96;
  }

  const totals = curveTotals(params.sqrtStartPriceX96, params.curve);
  const limit = BigInt(DEFAULT_TOTAL_SUPPLY) * 10n ** BigInt(BASE_DECIMALS);
  if (totals.threshold === 0n || totals.curveBase === 0n) return "The curve raises nothing";
  if (totals.curveBase + totals.migrationBase > limit) return "The curve needs more than the fixed supply";
  return null;
}
