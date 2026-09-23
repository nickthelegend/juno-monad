import { buildPresetParams } from "./curves";
import { sqrtX96ToPrice, type RawSegment } from "./curve-math";
import type { CurvePresetId } from "./types";

/**
 * The shape of a pool's bonding curve, read off its sixteen ranges.
 *
 * Every Juno preset places sixteen ranges with a liquidity weight each, and
 * that shape is the whole substance of the launch. This turns the on-chain
 * `getCurve` result — or a curve that has not been launched yet — into
 * something plottable.
 */

export type CurvePoint = {
  /** Range index, 0-based. */
  index: number;
  /** Price in quote units per base token at this range's upper bound. */
  price: number;
  /** Raw liquidity placed in the range. */
  liquidity: number;
  /** Liquidity as a share of the largest range, 0..1 — the shape. */
  weight: number;
};

export type CurveShape = {
  points: CurvePoint[];
  startPrice: number;
  endPrice: number;
  /** Where the pool is trading now, if known. */
  currentPrice?: number;
};

export function curveShape(params: {
  sqrtStartPriceX96: bigint;
  curve: RawSegment[];
  baseDecimals: number;
  quoteDecimals: number;
  currentSqrtPriceX96?: bigint;
}): CurveShape {
  const { baseDecimals, quoteDecimals } = params;
  const used = params.curve.filter((segment) => segment.liquidity > 0n);
  const liquidities = used.map((segment) => Number(segment.liquidity));
  const maxLiquidity = Math.max(1, ...liquidities);

  const points: CurvePoint[] = used.map((segment, index) => ({
    index,
    price: sqrtX96ToPrice(segment.sqrtPriceX96, baseDecimals, quoteDecimals),
    liquidity: liquidities[index],
    weight: liquidities[index] / maxLiquidity,
  }));

  return {
    points,
    startPrice: sqrtX96ToPrice(params.sqrtStartPriceX96, baseDecimals, quoteDecimals),
    endPrice: points.length ? points[points.length - 1].price : 0,
    currentPrice:
      params.currentSqrtPriceX96 !== undefined
        ? sqrtX96ToPrice(params.currentSqrtPriceX96, baseDecimals, quoteDecimals)
        : undefined,
  };
}

/**
 * The shape a preset would produce, computed locally.
 *
 * The builder is pure maths — no RPC, no pool — so an issuer can see the curve
 * they are about to create before they pay for it.
 */
export function presetShape(params: {
  preset: CurvePresetId;
  initialMarketCap: number;
  migrationMarketCap: number;
  quoteDecimals: number;
}): CurveShape | null {
  try {
    const built = buildPresetParams(params);
    return curveShape({
      sqrtStartPriceX96: built.sqrtStartPriceX96,
      curve: built.curve,
      baseDecimals: 18,
      quoteDecimals: params.quoteDecimals,
    });
  } catch {
    // An invalid valuation pair (migration below initial) throws in the
    // builder; the form surfaces that separately.
    return null;
  }
}
