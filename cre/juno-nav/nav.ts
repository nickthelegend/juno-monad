/**
 * The arithmetic of a tracker coin's NAV, in integers.
 *
 * Every value that reaches the chain is a bigint with 18 decimals, so every
 * node of the DON computes the same bytes from the same inputs (no floats).
 * Mirrors `lib/juno/chain.ts` (`navFor`) and `lib/juno/curve-math.ts`
 * (`sqrtX96ToPrice`) in Juno's server, which do the same in floats for display.
 */

import { type Address, encodeAbiParameters, type Hex, parseAbiParameters } from "viem";

export const E18 = 10n ** 18n;
const Q192 = 2n ** 192n;

/** A Q96 square-root price as quote per whole base token, 18 decimals. */
export function curvePriceE18(sqrtPriceX96: bigint, baseDecimals: number, quoteDecimals: number): bigint {
  const shift = 18 + baseDecimals - quoteDecimals;
  const squared = sqrtPriceX96 * sqrtPriceX96;
  return shift >= 0 ? (squared * 10n ** BigInt(shift)) / Q192 : squared / (Q192 * 10n ** BigInt(-shift));
}

/** A Pyth price (`price × 10^expo`) as 18 decimals. */
export function pythToE18(price: bigint, expo: number): bigint {
  const shift = 18 + expo;
  return shift >= 0 ? price * 10n ** BigInt(shift) : price / 10n ** BigInt(-shift);
}

/** A Chainlink data feed answer with `decimals` as 18 decimals. */
export function feedToE18(answer: bigint, decimals: number): bigint {
  return decimals <= 18 ? answer * 10n ** BigInt(18 - decimals) : answer / 10n ** BigInt(decimals - 18);
}

/**
 * The curve's price restated per unit of the underlying, USD, 18 decimals:
 * a token is `unitsPerTokenE18 / 1e18` of the underlying, so one unit costs
 * `price ÷ units`.
 */
export function impliedUsdE18(curveQuoteE18: bigint, quoteUsdE18: bigint, unitsPerTokenE18: bigint): bigint {
  if (unitsPerTokenE18 <= 0n) throw new Error("unitsPerToken must be positive");
  return (curveQuoteE18 * quoteUsdE18) / unitsPerTokenE18;
}

/** (implied − nav) / nav in basis points, rounded toward zero. */
export function premiumBps(implied: bigint, nav: bigint): bigint {
  if (nav <= 0n) throw new Error("NAV must be positive");
  return ((implied - nav) * 10_000n) / nav;
}

export function withinBand(premium: bigint, bandBps: number): boolean {
  return (premium < 0n ? -premium : premium) <= BigInt(bandBps);
}

/** What `JunoNavOracle._processReport` decodes: `(uint64 observedAt, NavPoint[] points)`. */
export const navPointParams = parseAbiParameters(
  "uint64 observedAt, (address token, bytes32 feedId, uint256 navUsdE18, uint64 navPublishTime, uint256 impliedUsdE18, int256 premiumBps, uint16 bandBps)[] points",
);

export type NavPoint = {
  token: Address;
  feedId: Hex;
  navUsdE18: bigint;
  navPublishTime: bigint;
  impliedUsdE18: bigint;
  premiumBps: bigint;
  bandBps: number;
};

export function encodeReport(observedAt: bigint, points: NavPoint[]): Hex {
  return encodeAbiParameters(navPointParams, [observedAt, points]);
}

/** A USD figure from an API (Tessera's mark, a float) as 18 decimals, rounded to a millionth of a dollar. */
export function usdToE18(value: number): bigint {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`not a price: ${value}`);
  return BigInt(Math.round(value * 1e6)) * 10n ** 12n;
}
