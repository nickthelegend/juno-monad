import type { Coin } from "./api";

/**
 * Ranking for the desktop rails and the no-wallet profile, kept apart from
 * the screens so it can be tested.
 */

/** A trade as the feed records it: which coin, when, and its dollar value. */
export type TradeMark = { coin: string; timestamp: string; valueUsd: number };

/**
 * The coins traded most in the last day, from the recorded trades: by number
 * of trades, then by their dollar value. A coin with no trade in the window
 * is left out rather than ranked at zero.
 */
export function trendingOf(posts: Coin[], trades: TradeMark[], now = Date.now(), limit = 6) {
  const byCoin = new Map<string, { trades: number; valueUsd: number }>();
  for (const trade of trades) {
    if (now - Date.parse(trade.timestamp) > 24 * 3600_000) continue;
    const key = trade.coin.toLowerCase();
    const entry = byCoin.get(key) ?? { trades: 0, valueUsd: 0 };
    entry.trades += 1;
    entry.valueUsd += trade.valueUsd;
    byCoin.set(key, entry);
  }
  return posts
    .flatMap((coin) => {
      const stats = byCoin.get(coin.address.toLowerCase());
      return stats ? [{ coin, ...stats }] : [];
    })
    .sort((a, b) => b.trades - a.trades || b.valueUsd - a.valueUsd)
    .slice(0, limit);
}

/** The newest launches first. */
export function newestOf(posts: Coin[], limit = 4): Coin[] {
  return [...posts].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, limit);
}

/** The creator with the most posts, with their own figures: the example a new visitor can open. */
export function topCreatorOf(posts: Coin[]) {
  const byWallet = new Map<string, Coin[]>();
  for (const coin of posts) byWallet.set(coin.creator.wallet, [...(byWallet.get(coin.creator.wallet) ?? []), coin]);
  const [wallet, coins] = [...byWallet.entries()].sort((a, b) => b[1].length - a[1].length)[0] ?? [];
  if (!wallet || !coins) return null;
  const creator = coins[0].creator;
  return {
    wallet,
    name: creator.displayName || creator.handle,
    avatarUrl: creator.avatarUrl,
    posts: coins.length,
    holders: coins.reduce((total, coin) => total + (coin.holders ?? 0), 0),
    coins,
  };
}
