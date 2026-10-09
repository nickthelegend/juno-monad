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

/** A coin or a creator that matches what was typed. */
export type SearchHit =
  | { kind: "coin"; coin: Coin; score: number }
  | { kind: "creator"; wallet: string; name: string; posts: number; score: number };

/**
 * Coins by ticker, name or address, and creators by handle, name or wallet.
 * An exact ticker or handle ranks first, then a prefix, then a match anywhere.
 * Under two characters nothing matches: one letter matches everything.
 */
export function searchMarkets(query: string, coins: Coin[], limit = 20): SearchHit[] {
  const q = query.trim().replace(/^\$/, "").toLowerCase();
  if (q.length < 2) return [];
  const rank = (...fields: string[]) => {
    let best = 0;
    for (const field of fields.map((f) => f.toLowerCase())) {
      if (field === q) best = Math.max(best, 3);
      else if (field.startsWith(q)) best = Math.max(best, 2);
      else if (field.includes(q)) best = Math.max(best, 1);
    }
    return best;
  };
  const hits: SearchHit[] = [];
  const creators = new Map<string, { name: string; posts: number; score: number }>();
  for (const coin of coins) {
    const score = rank(coin.symbol, coin.name, coin.address);
    if (score > 0) hits.push({ kind: "coin", coin, score });
    const creator = creators.get(coin.creator.wallet) ?? { name: coin.creator.displayName || coin.creator.handle, posts: 0, score: 0 };
    creator.posts += 1;
    creator.score = Math.max(creator.score, rank(coin.creator.handle, coin.creator.displayName ?? "", coin.creator.wallet));
    creators.set(coin.creator.wallet, creator);
  }
  for (const [wallet, creator] of creators) {
    if (creator.score > 0) hits.push({ kind: "creator", wallet, name: creator.name, posts: creator.posts, score: creator.score });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
