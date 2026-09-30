import { parseAbi, type Address } from "viem";

import { publicClient } from "./client";
import { kuruMarketOf, readKuruBook, type KuruBook } from "./kuru";
import { NATIVE } from "./network";
import { ttlCache, withRetry } from "./rpc";
import type { PoolSnapshot } from "./launchpad";

/**
 * What a coin is worth right now, in its quote token.
 *
 * On the curve that is the curve's price. After graduation the curve is
 * frozen at its top and the coin trades somewhere else, so the price is read
 * from there: the Uniswap v2 pair's reserves, or the midpoint of the coin's
 * Kuru book (which includes the market's own AMM vault). Marking a graduated
 * coin at the curve's top would value every holding at the moment it left,
 * however the market has moved since.
 */
export type Mark = {
  /** Quote per token, UI units. */
  price: number;
  source: "curve" | "uniswap-v2" | "kuru";
  /** The top of the Kuru book, when the source is Kuru. */
  book?: KuruBook;
  /** The venue the price came from, after graduation. */
  venue?: Address;
};

const pairAbi = parseAbi([
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function token0() view returns (address)",
]);

const marks = ttlCache<Mark>(5_000);

/**
 * A read that fails, fails. There is no fallback to the curve's price: that
 * would value a graduated coin at the moment it left the curve, which is the
 * wrong number this module exists to avoid, and it would do it silently.
 * Callers say what they could not read (a coin missing from a list, a
 * portfolio or leaderboard marked partial).
 */
export function markPrice(snapshot: PoolSnapshot): Promise<Mark> {
  if (!snapshot.curve.graduated) return Promise.resolve({ price: snapshot.price, source: "curve" });
  return marks.get(snapshot.token, () => graduatedMark(snapshot));
}

/** The same read, uncached: for a caller that just traded and wants the price its trade left. */
export function freshMarkPrice(snapshot: PoolSnapshot): Promise<Mark> {
  if (!snapshot.curve.graduated) return Promise.resolve({ price: snapshot.price, source: "curve" });
  return graduatedMark(snapshot);
}

async function graduatedMark(snapshot: PoolSnapshot): Promise<Mark> {
  if (snapshot.venue === "kuru") {
    const market = await kuruMarketOf(snapshot.token);
    if (!market) throw new Error(`${snapshot.token} graduated into Kuru, but its market cannot be found`);
    const book = await readKuruBook(market);
    // `mid` is the midpoint, or whichever side exists; null only for an empty book.
    if (!book.mid) throw new Error(`The Kuru book for ${snapshot.token} is empty: there is no price to mark at`);
    return { price: book.mid, source: "kuru", book, venue: market };
  }

  const pair = snapshot.pool.venue;
  if (pair === NATIVE) throw new Error(`${snapshot.token} graduated but names no pair`);
  const client = publicClient();
  const [[reserve0, reserve1], token0] = await Promise.all([
    withRetry(() => client.readContract({ address: pair, abi: pairAbi, functionName: "getReserves" })),
    withRetry(() => client.readContract({ address: pair, abi: pairAbi, functionName: "token0" })),
  ]);
  const baseIsToken0 = token0.toLowerCase() === snapshot.token.toLowerCase();
  const baseReserve = baseIsToken0 ? reserve0 : reserve1;
  const quoteReserve = baseIsToken0 ? reserve1 : reserve0;
  if (baseReserve === 0n) throw new Error(`The pair for ${snapshot.token} holds none of it: there is no price to mark at`);
  const price =
    Number(quoteReserve) / 10 ** snapshot.quoteDecimals / (Number(baseReserve) / 10 ** snapshot.baseDecimals);
  return { price, source: "uniswap-v2", venue: pair };
}
