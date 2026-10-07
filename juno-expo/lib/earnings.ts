import type { Coin } from "./api";

/**
 * A creator's earnings across their coins, from each coin's chain reads.
 * Totals are summed only within one currency (`currency` is null when the
 * coins are priced in different ones), and a count that any coin could not
 * read is null rather than a short total.
 */
export type EarningsRow = { coin: Coin; claimable: number; claimed: number; earned: number };

export function earningsOf(coins: Coin[]) {
  const rows: EarningsRow[] = coins
    .map((coin) => {
      const claimable = coin.creatorRewards;
      const claimed = coin.creatorRewardsClaimed ?? 0;
      return { coin, claimable, claimed, earned: claimable + claimed };
    })
    .sort((a, b) => b.earned - a.earned);
  const currencies = new Set(coins.map((coin) => coin.marketCapCurrency));
  const sum = (pick: (row: EarningsRow) => number) => rows.reduce((total, row) => total + pick(row), 0);
  const all = <T,>(read: (coin: Coin) => T | null | undefined) => coins.every((coin) => typeof read(coin) === "number");
  return {
    rows,
    currency: currencies.size === 1 ? [...currencies][0] : null,
    earned: sum((row) => row.earned),
    claimable: sum((row) => row.claimable),
    claimed: sum((row) => row.claimed),
    volume: all((coin) => coin.totalVolume) ? coins.reduce((total, coin) => total + (coin.totalVolume ?? 0), 0) : null,
    holders: all((coin) => coin.holders) ? coins.reduce((total, coin) => total + (coin.holders ?? 0), 0) : null,
    fills: all((coin) => coin.tradeCount) ? coins.reduce((total, coin) => total + (coin.tradeCount ?? 0), 0) : null,
    owed: rows.filter((row) => row.claimable > 0),
  };
}
