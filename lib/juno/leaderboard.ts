import "server-only";

import { envioAllTrades, envioConfigured, envioKuruTrades, envioPairTrades } from "./envio";
import { basisFromSwaps } from "./portfolio";
import { fetchPoolSnapshot } from "./launchpad";
import { markPrice } from "./mark";
import { quoteTokenUsdPrice } from "./pyth";
import { listSwapHistory, type PoolSwap, type SwapHistory } from "./swaps";
import { listPools } from "./registry";
import { ttlCache } from "./rpc";
import type { JunoPoolRow } from "./registry";

/**
 * Who is actually good at this.
 *
 * Every fill on every Juno pool is already decoded from vault deltas, and every
 * fill carries the wallet that signed it. Grouping those by trader and running
 * the same average-cost basis the portfolio uses turns a list of transactions
 * into a ranking — with no indexer, no new table, and no number that was not
 * read from the chain.
 *
 * ## What is being ranked, precisely
 *
 * **Realised** profit only: quote received on a sell minus the average cost of
 * the tokens sold. Unrealised gains are deliberately excluded from the rank.
 * A wallet that bought and never sold has taken no risk off the table, and a
 * leaderboard that counts paper gains ranks whoever bought earliest rather
 * than whoever traded well. Unrealised is reported beside the rank so the
 * picture is complete, but it does not decide the order.
 *
 * ## Where the fills come from
 *
 * With the Envio indexer, every fill on every pool — curve trades and, after a
 * graduation into Kuru, the coin's Kuru fills — arrives in a few paginated
 * queries, complete from the launchpad's first block. Without it, each pool's
 * history is walked from the receipt record and the log tail.
 *
 * ## What this cannot see
 *
 * Only fills inside the walked history window. A wallet whose buys predate it
 * shows a sell with no matching cost, and `basisFromSwaps` correctly refuses to
 * invent one — those proceeds are skipped rather than counted as pure profit.
 * `partial` says when that happened, and the route passes it through, because
 * a leaderboard that quietly omits half the trades is worse than one that says
 * it is short.
 */

export type TraderRow = {
  wallet: string;
  /** Quote-denominated profit already taken, converted to USD where possible. */
  realised: number;
  /** Still open, at the current curve price. Reported, never ranked on. */
  unrealised: number | null;
  /** Fills this wallet signed inside the window. */
  trades: number;
  /** Distinct pools touched — breadth, not just one lucky coin. */
  coins: number;
  /** Sells that came out ahead, over sells with a cost to compare against. */
  winRate: number | null;
  /** The single best realised exit. */
  bestExit: number | null;
  /** Position still held, in USD, across every pool. */
  holding: number;
  /** True when this wallet launched at least one of the pools it traded. */
  isCreator: boolean;
};

export type Leaderboard = {
  traders: TraderRow[];
  /**
   * The rank is short of something.
   *
   * True when a pool's history came back incomplete *or* when the registry
   * holds more pools than this walk covered. The second case used to report
   * clean: reading twelve of fourteen and announcing a complete board is the
   * same dishonesty as an empty chart claiming an empty market, and it hid
   * every trader whose only fills were on an older pool.
   */
  partial: boolean;
  /** How many pools were walked to build this. */
  poolsRead: number;
  /** How many the registry holds, so `poolsRead` can be read against something. */
  poolsTotal: number;
};

const board = ttlCache<Leaderboard>(90_000);

/**
 * Walk the registry, decode every fill, rank the signers.
 *
 * Bounded concurrency for the same reason every other walk here has it: the
 * public endpoint answers a burst with 429s, and a leaderboard is not worth
 * making the rest of the app unusable for.
 */
export async function leaderboard(poolLimit = 60, width = 2): Promise<Leaderboard> {
  /*
   * Every pool, not the newest dozen.
   *
   * Trades are decoded once and kept, so a pool already on record costs a
   * query rather than a crawl, and there is no reason to rank only part of the
   * network.
   */
  const total = (await listPools(200)).length;
  const rows = await listPools(poolLimit);
  return board.get(
    rows.map((row) => row.token).join(","),
    async () => build(rows, width, total),
    // A short read is not worth trusting for long; a complete one is.
    (value) => (value.partial ? 15_000 : 90_000),
  );
}

/**
 * Every fill the indexer has, grouped by coin: one source for the whole board.
 * Null when the indexer is not configured or will not answer, so the caller
 * walks pool by pool instead.
 */
async function indexedHistories(): Promise<Map<string, SwapHistory> | null> {
  if (!envioConfigured()) return null;
  try {
    // Every page of a post-graduation venue's trades, oldest first.
    const everyPage = async (read: typeof envioKuruTrades) => {
      const out: PoolSwap[] = [];
      for (let offset = 0; offset < 10_000; offset += 1_000) {
        const page = await read({ limit: 1_000, offset, oldestFirst: true });
        out.push(...page);
        if (page.length < 1_000) break;
      }
      return out;
    };
    const [curve, kuru, pair] = await Promise.all([
      envioAllTrades(),
      everyPage(envioKuruTrades),
      everyPage(envioPairTrades).catch(() => [] as PoolSwap[]),
    ]);
    const byToken = new Map<string, SwapHistory>();
    for (const swap of [...curve.swaps, ...kuru, ...pair]) {
      const entry = byToken.get(swap.token) ?? { swaps: [], partial: !curve.complete };
      entry.swaps.push(swap);
      byToken.set(swap.token, entry);
    }
    return byToken;
  } catch {
    return null;
  }
}

async function build(
  rows: JunoPoolRow[],
  width: number,
  poolsTotal: number,
): Promise<Leaderboard> {
  const indexed = await indexedHistories();
  type Acc = {
    realised: number;
    unrealised: number;
    unrealisedKnown: boolean;
    trades: number;
    coins: Set<string>;
    wins: number;
    decided: number;
    bestExit: number | null;
    holding: number;
  };
  const byWallet = new Map<string, Acc>();
  const creators = new Set(rows.map((row) => row.creatorWallet));

  let partial = false;
  let poolsRead = 0;
  let cursor = 0;

  const acc = (wallet: string): Acc => {
    let found = byWallet.get(wallet);
    if (!found) {
      found = {
        realised: 0,
        unrealised: 0,
        unrealisedKnown: true,
        trades: 0,
        coins: new Set(),
        wins: 0,
        decided: 0,
        bestExit: null,
        holding: 0,
      };
      byWallet.set(wallet, found);
    }
    return found;
  };

  async function worker() {
    while (cursor < rows.length) {
      const row = rows[cursor++];

      const rate = (await quoteTokenUsdPrice(row.quoteToken).catch(() => null)) ?? 1;
      const snapshot = await fetchPoolSnapshot(row.token, rate, row.launchpad).catch(() => null);
      if (!snapshot) {
        partial = true;
        continue;
      }

      const history = indexed
        ? (indexed.get(row.token) ?? { swaps: [], partial: false })
        : await listSwapHistory(row.token).catch(() => null);
      if (history === null) {
        partial = true;
        continue;
      }
      if (history.partial) partial = true;
      poolsRead += 1;
      const mark = (await markPrice(snapshot)).price;

      // One basis per wallet per pool — average cost is a per-asset idea, and
      // pooling two different coins into one basis would produce a number that
      // means nothing.
      const perTrader = new Map<string, typeof history.swaps>();
      for (const swap of history.swaps) {
        const list = perTrader.get(swap.trader) ?? [];
        list.push(swap);
        perTrader.set(swap.trader, list);
      }

      for (const [wallet, swaps] of perTrader) {
        const entry = acc(wallet);
        entry.trades += swaps.length;
        entry.coins.add(row.token);

        const basis = basisFromSwaps(swaps);
        entry.realised += basis.realised * rate;

        // Open position, marked where the coin trades now: the curve, or its
        // venue after graduation.
        if (basis.quantity > 0) {
          const value = basis.quantity * mark * rate;
          entry.holding += value;
          if (basis.seen) entry.unrealised += value - basis.cost * rate;
          // A position whose buys are outside the window has no cost to mark
          // against, so this wallet's unrealised total becomes unknowable
          // rather than understated.
          else entry.unrealisedKnown = false;
        }

        /*
         * Win rate and best exit, in one pass.
         *
         * Same average-cost rule as `basisFromSwaps`, walked incrementally so
         * each sell's own contribution is visible — which the aggregate figure
         * cannot give you, since it returns one total. A sell into a position
         * acquired outside the window has no cost to compare against and is
         * counted as neither a win nor a loss: it is unmeasured, and rounding
         * it to one or the other is exactly the kind of invented number this
         * app refuses everywhere else.
         */
        let quantity = 0;
        let cost = 0;
        for (const swap of [...swaps].sort(
          (a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex,
        )) {
          if (swap.side === "buy") {
            quantity += swap.baseAmount;
            cost += swap.quoteAmount;
            continue;
          }
          if (quantity <= 0) continue;

          const matched = Math.min(swap.baseAmount, quantity);
          const average = cost / quantity;
          const proceeds = swap.quoteAmount * (matched / swap.baseAmount);
          const delta = (proceeds - average * matched) * rate;

          quantity -= matched;
          cost -= average * matched;

          entry.decided += 1;
          if (delta > 0) entry.wins += 1;
          if (entry.bestExit === null || delta > entry.bestExit) entry.bestExit = delta;
        }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(width, rows.length) }, worker));

  const traders = [...byWallet.entries()]
    .map(([wallet, entry]): TraderRow => ({
      wallet,
      realised: entry.realised,
      unrealised: entry.unrealisedKnown ? entry.unrealised : null,
      trades: entry.trades,
      coins: entry.coins.size,
      winRate: entry.decided > 0 ? entry.wins / entry.decided : null,
      bestExit: entry.bestExit,
      holding: entry.holding,
      isCreator: creators.has(wallet),
    }))
    // Realised first, then breadth, then volume: a wallet that made the same
    // money across three coins traded better than one that got lucky on one.
    .sort((a, b) => b.realised - a.realised || b.coins - a.coins || b.trades - a.trades);

  return {
    traders,
    // Short if any walk was short, *or* if the registry holds pools this rank
    // never looked at.
    partial: partial || poolsRead < poolsTotal,
    poolsRead,
    poolsTotal,
  };
}
