/**
 * The quick sizes on a buy: the pills under the amount.
 *
 * Dollars when a feed gives a rate (people think in "$20", not "0.175 MON"),
 * quote units without one. Never a size the wallet cannot pay for: a faucet's
 * 0.5 MON is about a cent at testnet prices, so "$2" was a first tap that
 * could only answer "Not enough MON". When the fixed sizes do not all fit the
 * spendable balance, the pills become 25 / 50 / 75% of it, written in the
 * quote token to two significant figures. The fourth pill is Max. A pill whose
 * amount is null is shown disabled.
 */
export type QuickSize = { label: string; amount: number | null; share: number | null };

export const QUICK_USD = [2, 20, 50];
export const QUICK_QUOTE = [0.1, 0.25, 0.5];
export const QUICK_SHARE = [0.25, 0.5, 0.75];

export function quickBuySizes(input: {
  /** Spendable quote balance after any gas held back; null when unknown (no wallet yet, or a failed read). */
  spendable: number | null;
  /** USD per quote token; null or 0 when no feed answered. */
  rate: number | null;
  symbol: string;
}): QuickSize[] {
  const { spendable, rate, symbol } = input;
  const max: QuickSize = { label: "Max", amount: spendable !== null && spendable > 0 ? spendable : null, share: null };
  const sizes: QuickSize[] =
    rate === null || rate <= 0
      ? QUICK_QUOTE.map((size) => ({ label: `${size} ${symbol}`, amount: size, share: null }))
      : QUICK_USD.map((dollars) => ({ label: `$${dollars}`, amount: dollars / rate, share: null }));
  if (spendable !== null && sizes.some((size) => (size.amount ?? 0) > spendable)) {
    return [
      ...QUICK_SHARE.map((share) => {
        const amount = spendable > 0 ? spendable * share : null;
        return { label: amount === null ? `${share * 100}%` : `${Number(amount.toPrecision(2))} ${symbol}`, amount, share: null };
      }),
      max,
    ];
  }
  return [...sizes, max];
}
