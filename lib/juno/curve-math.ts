/**
 * `contracts/src/libraries/CurveMath.sol`, in bigint.
 *
 * The same rounding in the same places, so a curve built here is validated
 * exactly the way the launchpad will validate it — a launch that would revert
 * on-chain fails here first, before anyone signs anything.
 *
 * Prices are square roots in Q64.96 of the raw price (quote wei per base wei).
 */

export const Q96 = 1n << 96n;

function mulDiv(a: bigint, b: bigint, denominator: bigint, roundUp = false): bigint {
  const product = a * b;
  const quotient = product / denominator;
  return roundUp && product % denominator !== 0n ? quotient + 1n : quotient;
}

function ceilDiv(a: bigint, b: bigint): bigint {
  return a === 0n ? 0n : (a - 1n) / b + 1n;
}

/** Base tokens held between two prices. */
export function baseDelta(sqrtA: bigint, sqrtB: bigint, liquidity: bigint, roundUp: boolean): bigint {
  if (sqrtA > sqrtB) [sqrtA, sqrtB] = [sqrtB, sqrtA];
  if (sqrtA === sqrtB) return 0n;
  const numerator1 = liquidity << 96n;
  const numerator2 = sqrtB - sqrtA;
  return roundUp
    ? ceilDiv(mulDiv(numerator1, numerator2, sqrtB, true), sqrtA)
    : mulDiv(numerator1, numerator2, sqrtB) / sqrtA;
}

/** Quote tokens held between two prices. */
export function quoteDelta(sqrtA: bigint, sqrtB: bigint, liquidity: bigint, roundUp: boolean): bigint {
  if (sqrtA > sqrtB) [sqrtA, sqrtB] = [sqrtB, sqrtA];
  return mulDiv(liquidity, sqrtB - sqrtA, Q96, roundUp);
}

/** Base worth `quoteAmount` at `sqrtP` — the migration reserve's base side. */
export function baseForQuoteAt(quoteAmount: bigint, sqrtP: bigint): bigint {
  return mulDiv(mulDiv(quoteAmount, Q96, sqrtP), Q96, sqrtP);
}

export type RawSegment = { sqrtPriceX96: bigint; liquidity: bigint };

export type CurveTotals = {
  /** Supply the curve sells from start to top. */
  curveBase: bigint;
  /** Quote the curve holds at its top: the migration threshold. */
  threshold: bigint;
  /** Base reserved for the AMM, priced at the top. */
  migrationBase: bigint;
};

/** What `JunoLaunchpad._checkCurve` computes, bit for bit. */
export function curveTotals(sqrtStart: bigint, curve: RawSegment[]): CurveTotals {
  let lower = sqrtStart;
  let curveBase = 0n;
  let threshold = 0n;
  for (const segment of curve) {
    curveBase += baseDelta(lower, segment.sqrtPriceX96, segment.liquidity, true);
    threshold += quoteDelta(lower, segment.sqrtPriceX96, segment.liquidity, true);
    lower = segment.sqrtPriceX96;
  }
  const top = curve[curve.length - 1]?.sqrtPriceX96 ?? sqrtStart;
  return { curveBase, threshold, migrationBase: baseForQuoteAt(threshold, top) };
}

/**
 * A raw Q96 square-root price as a UI price: quote per whole base token.
 *
 * Float maths on purpose — this is for display and charts, where fifteen
 * significant digits are more than anyone reads.
 */
export function sqrtX96ToPrice(sqrtPriceX96: bigint, baseDecimals: number, quoteDecimals: number): number {
  const sqrt = Number(sqrtPriceX96) / 2 ** 96;
  return sqrt * sqrt * 10 ** (baseDecimals - quoteDecimals);
}
