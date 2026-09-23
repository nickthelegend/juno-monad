import { BigDecimal } from "envio";

/**
 * Unit conversion and pricing, kept free of handler state so it can be tested
 * on its own.
 *
 * Amounts arrive as the contract's integers. Everything stored for display is a
 * `BigDecimal` made by shifting the decimal point, which is exact; the only
 * divisions (prices, average cost) are done in integers and truncated, the way
 * the contract itself rounds.
 */

/** Every Juno token has 18 decimals. */
export const BASE_DECIMALS = 18;

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export const ZERO = new BigDecimal(0);

const Q192 = 1n << 192n;

/** Significant digits kept by `ratio`. Prices on a young curve can be 1e-12 or smaller. */
const SIGNIFICANT_DIGITS = 30;

const pow10 = (n: number) => 10n ** BigInt(n);

const digits = (value: bigint) => (value < 0n ? -value : value).toString().length;

/** A raw integer amount in display units. */
export function toUnits(raw: bigint, decimals: number): BigDecimal {
  return new BigDecimal(raw.toString()).shiftedBy(-decimals);
}

/** Display units back to the raw integer, truncating anything finer than one raw unit. */
export function toRaw(value: BigDecimal, decimals: number): bigint {
  return BigInt(value.shiftedBy(decimals).integerValue(BigDecimal.ROUND_DOWN).toFixed(0));
}

/** `num / den` to at least `SIGNIFICANT_DIGITS` significant digits, truncated. */
export function ratio(num: bigint, den: bigint): BigDecimal {
  if (num === 0n || den === 0n) return ZERO;
  const shift = Math.max(0, SIGNIFICANT_DIGITS + digits(den) - digits(num));
  return new BigDecimal(((num * pow10(shift)) / den).toString()).shiftedBy(-shift);
}

/** A trade's realised price: quote per whole token, i.e. quoteAmount / baseAmount in display units. */
export function tradePrice(baseRaw: bigint, quoteRaw: bigint, quoteDecimals: number): BigDecimal {
  return ratio(quoteRaw * pow10(BASE_DECIMALS), baseRaw * pow10(quoteDecimals));
}

/**
 * The curve's marginal price from its Q64.96 square root. The contract prices
 * in raw units (quote wei per base wei), base as token0.
 */
export function spotPrice(sqrtPriceX96: bigint, quoteDecimals: number): BigDecimal {
  return ratio(sqrtPriceX96 * sqrtPriceX96 * pow10(BASE_DECIMALS), Q192 * pow10(quoteDecimals));
}

/** The creator's part of a fee, given the pool's protocol share. Mirrors `JunoLaunchpad._accrue`. */
export function splitFee(feeRaw: bigint, protocolShareBps: number): { protocol: bigint; creator: bigint } {
  const protocol = (feeRaw * BigInt(protocolShareBps)) / 10_000n;
  return { protocol, creator: feeRaw - protocol };
}

/** Average-cost basis, in raw units: the tokens it covers and the quote paid for them. */
export type Basis = { base: bigint; cost: bigint };

/**
 * Apply a sell to an average-cost basis. The same policy as the app's
 * `basisFromSwaps` (lib/juno/portfolio.ts): a sell releases cost pro rata, and
 * tokens sold beyond the tracked quantity (acquired by transfer, or before the
 * indexer's start) have no cost to match, so their proceeds are not counted.
 */
export function sellAgainstBasis(
  basis: Basis,
  soldRaw: bigint,
  proceedsRaw: bigint,
): { basis: Basis; realizedRaw: bigint } {
  const matched = soldRaw < basis.base ? soldRaw : basis.base;
  if (matched <= 0n || soldRaw <= 0n) return { basis, realizedRaw: 0n };
  const cost = matched === basis.base ? basis.cost : (basis.cost * matched) / basis.base;
  const proceeds = matched === soldRaw ? proceedsRaw : (proceedsRaw * matched) / soldRaw;
  return {
    basis: { base: basis.base - matched, cost: basis.cost - cost },
    realizedRaw: proceeds - cost,
  };
}
