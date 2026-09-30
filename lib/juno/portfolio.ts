import "server-only";

import { getAddress, isAddress, type Address } from "viem";

import { junoTokenAbi } from "./abi";
import { publicClient } from "./client";
import { markPrice } from "./mark";
import { fetchPoolSnapshot } from "./launchpad";
import { quoteTokenUsdPrice } from "./pyth";
import { listPools } from "./registry";
import { tryRead } from "./rpc";
import { CallerError } from "./api";
import { envioConfigured, envioKuruTrades, envioPairTrades, envioPositions, envioTrades } from "./envio";
import { listSwapHistory } from "./swaps";
import type { JunoPoolRow } from "./registry";

/**
 * What a wallet holds, and what it paid.
 *
 * The balance is read from each token's `balanceOf` — that is the truth about
 * ownership. The *cost* is not on the balance anywhere, so it is derived
 * from the same decoded swap history that drives the charts: every buy this
 * wallet made against a Juno pool added tokens at a known price, every sell
 * removed them.
 *
 * ## Average cost, and why
 *
 * Realised P&L needs a lot matching policy, and the honest ones disagree with
 * each other — FIFO and average cost give different answers for the same
 * trades. This uses **average cost**: a sell reduces the position and the cost
 * basis proportionally, leaving the average unchanged.
 *
 * That choice matters because it is the one that cannot mislead here. FIFO
 * would let a creator realise a gain by selling their earliest, cheapest tokens
 * while the position is underwater overall — a number that is technically true
 * and tells the holder the opposite of their actual situation.
 *
 * ## What this cannot see
 *
 * Tokens acquired any way other than a swap against the pool — an airdrop, a
 * transfer from a friend, a buy made before the visible history window — are
 * held but have no recorded cost. Those are reported with a null cost basis
 * rather than a zero, because a zero cost implies the entire holding is profit.
 */

export type Position = {
  /** The coin's token address. */
  token: string;
  name: string;
  symbol: string;
  mediaUrl: string | null;
  mediaMime: string | null;
  curvePreset: string;
  /** Tokens held right now, in UI units. */
  balance: number;
  /** Current price, one token in `currency`. */
  price: number;
  /** `balance * price`. */
  value: number;
  /**
   * Average price paid per token, or null when this wallet's acquisition is not
   * in the visible swap history.
   */
  averageCost: number | null;
  /** `value - (balance * averageCost)`, or null when cost is unknown. */
  unrealisedPnl: number | null;
  /** As a signed ratio, or null when cost is unknown. */
  unrealisedPnlPct: number | null;
  /** Profit already taken, from sells matched against average cost. */
  realisedPnl: number;
  /** What the figures above are denominated in — "USD" or the quote symbol. */
  currency: string;
  graduated: boolean;
  /**
   * This wallet's own trades against the pool, oldest first. Kept so the
   * portfolio's value over time can be rebuilt without re-reading the chain.
   */
  trades: Array<{
    t: string;
    side: "buy" | "sell";
    base: number;
    /** The mark right after the trade — what a value-over-time chart plots. */
    price: number;
    /** What was paid (buy, fee included) or received (sell), in `currency`. */
    quote: number;
  }>;
};

export type Portfolio = {
  wallet: string;
  positions: Position[];
  /**
   * Sum of position values, in USD where every position could be priced in USD.
   *
   * Null when the walk did not finish and found nothing: a wallet holding
   * nothing really is worth zero and should say so, but a wallet nobody could
   * read is not, and "$0" there is a number the app did not measure.
   */
  totalValue: number | null;
  /** Null when any held position has no recorded cost, or nothing was measured. */
  totalPnl: number | null;
  totalPnlPct: number | null;
  currency: string;
  /**
   * True when some pool's history could not be fully read, so cost figures may
   * be incomplete. The UI says so rather than presenting a partial basis as
   * final.
   */
  partial: boolean;
  /**
   * What this wallet was worth over time, oldest first.
   *
   * Nothing stores this, and nothing needs to: every position's balance history
   * is implied by its trades, and every price is implied by the trade that set
   * it. Replaying both together reconstructs the total at each moment something
   * actually happened.
   *
   * The series therefore has a point per *trade*, not per interval — a flat
   * stretch means nobody traded, which is the truth, rather than a smoothed
   * line through prices nobody paid.
   */
  history: Array<{ t: string; value: number }>;
};

type Basis = {
  /** Tokens acquired and still held, per average-cost accounting. */
  quantity: number;
  /** Total quote paid for `quantity`. */
  cost: number;
  realised: number;
  /** True when at least one buy by this wallet was seen. */
  seen: boolean;
};

/**
 * Walk this wallet's trades oldest-first, maintaining an average-cost basis.
 *
 * A sell is matched against the running average, which is what keeps realised
 * and unrealised P&L consistent with each other.
 */
export function basisFromSwaps(
  swaps: Array<{
    side: "buy" | "sell";
    baseAmount: number;
    quoteAmount: number;
    blockNumber: number;
    logIndex?: number;
  }>,
): Basis {
  const ordered = [...swaps].sort(
    (a, b) => a.blockNumber - b.blockNumber || (a.logIndex ?? 0) - (b.logIndex ?? 0),
  );
  const basis: Basis = { quantity: 0, cost: 0, realised: 0, seen: false };

  for (const swap of ordered) {
    if (swap.side === "buy") {
      basis.quantity += swap.baseAmount;
      basis.cost += swap.quoteAmount;
      basis.seen = true;
      continue;
    }

    // Selling more than the tracked position means part of it was acquired
    // outside the visible history. Only the tracked part has a cost to match.
    const matched = Math.min(swap.baseAmount, basis.quantity);
    if (basis.quantity > 0 && matched > 0) {
      const average = basis.cost / basis.quantity;
      const proceeds = swap.quoteAmount * (matched / swap.baseAmount);
      basis.realised += proceeds - average * matched;
      basis.quantity -= matched;
      basis.cost -= average * matched;
    }
  }

  // Floating-point drift on a fully closed position leaves a residue that
  // would otherwise divide into an absurd average.
  if (basis.quantity < 1e-9) {
    basis.quantity = 0;
    basis.cost = 0;
  }

  return basis;
}

/** Tokens this wallet holds of one coin, in UI units, or null when refused. */
async function balanceOf(wallet: Address, token: string): Promise<number | null> {
  const raw = await tryRead(() =>
    publicClient().readContract({
      address: getAddress(token),
      abi: junoTokenAbi,
      functionName: "balanceOf",
      args: [wallet],
    }),
  );
  return raw === null ? null : Number(raw) / 1e18;
}

/**
 * Every Juno coin this wallet holds, in one multicall — or null if it was
 * refused.
 *
 * Asking each pool separately would be forty reads to learn, usually, "no"
 * thirty-nine times. One `eth_call` to Multicall3 answers the question for
 * every pool at once, and a refusal is reported as a refusal rather than
 * turning a real holding into nothing.
 */
async function heldBalances(wallet: Address, rows: JunoPoolRow[]): Promise<Map<string, number> | null> {
  if (rows.length === 0) return new Map();
  const results = await tryRead(() =>
    publicClient().multicall({
      contracts: rows.map((row) => ({
        address: getAddress(row.token),
        abi: junoTokenAbi,
        functionName: "balanceOf" as const,
        args: [wallet] as const,
      })),
      allowFailure: false,
    }),
  );
  if (!results) return null;
  const held = new Map<string, number>();
  rows.forEach((row, index) => held.set(row.token, Number(results[index] as bigint) / 1e18));
  return held;
}

async function positionFor(
  wallet: Address,
  row: JunoPoolRow,
  known?: number,
): Promise<{ position: Position | null; partial: boolean }> {
  const read = known ?? (await balanceOf(wallet, row.token));
  if (read === null) return { position: null, partial: true };
  const balance = read;

  const quoteUsd = await quoteTokenUsdPrice(row.quoteToken).catch(() => null);
  const rate = quoteUsd ?? 1;

  const snapshot = await fetchPoolSnapshot(row.token, rate, row.launchpad);
  if (!snapshot) return { position: null, partial: false };
  const currency = quoteUsd === null ? snapshot.quote.symbol : "USD";

  // History is only worth reading for a pool this wallet actually holds.
  const history = balance > 0 ? await listSwapHistory(row.token) : null;
  const mine = (history?.swaps ?? []).filter((swap) => swap.trader === wallet);
  const basis = basisFromSwaps(mine);

  if (balance <= 0 && basis.realised === 0) return { position: null, partial: false };

  const price = (await markPrice(snapshot)).price * rate;
  const value = balance * price;

  // Only claim a cost when this wallet's buys are actually in the history.
  const averageCost =
    basis.seen && basis.quantity > 0 ? (basis.cost / basis.quantity) * rate : null;
  const unrealisedPnl = averageCost === null ? null : value - balance * averageCost;
  const unrealisedPnlPct =
    averageCost === null || averageCost <= 0 || balance <= 0
      ? null
      : (price - averageCost) / averageCost;

  return {
    position: {
      token: row.token,
      name: row.name,
      symbol: row.symbol,
      mediaUrl: row.mediaUrl,
      mediaMime: row.mediaMime,
      curvePreset: row.curvePreset,
      balance,
      price,
      value,
      averageCost,
      unrealisedPnl,
      unrealisedPnlPct,
      realisedPnl: basis.realised * rate,
      currency,
      graduated: snapshot.curve.graduated,
      trades: [...mine]
        .sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex)
        .map((swap) => ({
          t: swap.timestamp,
          side: swap.side,
          base: swap.baseAmount,
          price: swap.price * rate,
          quote: swap.quoteAmount * rate,
        })),
    },
    partial: history?.partial ?? false,
  };
}

/**
 * Everything this wallet holds across Juno pools.
 *
 * Held pools are walked a few at a time. Each position costs a pool snapshot
 * and a swap history, and firing all of them at once is the burst a public
 * endpoint answers with 429s.
 */
export async function loadPortfolio(
  wallet: string,
  options: { poolLimit?: number; width?: number } = {},
): Promise<Portfolio> {
  // Validate before any RPC work: a malformed address cannot own anything.
  if (!isAddress(wallet)) throw new CallerError("Not a Monad address");
  const owner = getAddress(wallet);

  const rows = await listPools(options.poolLimit ?? 40);

  /*
   * Walk only the pools this wallet holds. `positionFor` reads history only
   * for a held pool, so a pool at zero balance could never produce a position
   * — reading its price and snapshot anyway would be pure cost. If the balance
   * read itself is refused, fall back to asking pool by pool.
   */
  // With the indexer, the whole portfolio is one query: every position this
  // wallet has taken, with real balances (transfers included), average cost
  // and realised P&L already worked out, plus its trades for the chart.
  if (envioConfigured()) {
    const indexed = await portfolioFromIndexer(owner, rows).catch(() => null);
    if (indexed) {
      const totals = totalsFor(indexed, false);
      return {
        wallet: owner,
        positions: indexed,
        history: valueOverTime(indexed, totals.sum),
        ...totals.portfolio,
        partial: false,
      };
    }
  }

  const held = await heldBalances(owner, rows);

  if (held && (await provablyUntouched(owner, held))) {
    return {
      wallet: owner,
      positions: [],
      history: [],
      ...totalsFor([], false).portfolio,
      partial: false,
    };
  }

  const walk = held ? rows.filter((row) => (held.get(row.token) ?? 0) > 0) : rows;

  const positions: Position[] = [];
  let partial = false;
  let cursor = 0;

  async function worker() {
    while (cursor < walk.length) {
      const row = walk[cursor++];
      const result = await positionFor(owner, row, held?.get(row.token)).catch(() => ({
        position: null,
        partial: true,
      }));
      if (result.position) positions.push(result.position);
      if (result.partial) partial = true;
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(options.width ?? 3, walk.length) }, worker),
  );

  positions.sort((a, b) => b.value - a.value);

  const totals = totalsFor(positions, partial);

  return {
    wallet: owner,
    positions,
    history: valueOverTime(positions, totals.sum),
    ...totals.portfolio,
    partial,
  };
}

/**
 * The portfolio as the Envio indexer has it, or null when it cannot answer.
 *
 * Positions come with the indexer's own average-cost basis, computed with the
 * same rule as `basisFromSwaps`. Only coins this app lists are shown — a
 * position in some other token the launchpad sold has no name or media here.
 */
async function portfolioFromIndexer(owner: Address, rows: JunoPoolRow[]): Promise<Position[] | null> {
  const [indexed, curveTrades, kuruTrades, pairTrades] = await Promise.all([
    envioPositions(owner),
    envioTrades({ trader: owner, limit: 1_000 }),
    // After a graduation the same position keeps trading, on Kuru or the v2 pair.
    envioKuruTrades({ trader: owner, limit: 1_000 }),
    envioPairTrades({ trader: owner, limit: 1_000 }),
  ]);
  const trades = [...curveTrades, ...kuruTrades, ...pairTrades];
  const byToken = new Map(rows.map((row) => [row.token, row]));
  const positions: Position[] = [];
  for (const entry of indexed) {
    if (!(entry.balance > 0) && entry.realizedPnl === 0) continue;
    const row = byToken.get(entry.token);
    if (!row) continue;
    const quoteUsd = await quoteTokenUsdPrice(row.quoteToken).catch(() => null);
    const rate = quoteUsd ?? 1;
    // A read that fails throws, and the whole portfolio is walked on-chain
    // instead, where an unread position marks it partial. Only a pool that is
    // not on this launchpad (null) is skipped here.
    const snapshot = await fetchPoolSnapshot(row.token, rate, row.launchpad);
    if (!snapshot) continue;

    const price = (await markPrice(snapshot)).price * rate;
    const value = entry.balance * price;
    // A cost is only claimed for tokens the indexer saw bought; tokens that
    // arrived by transfer have none, and the average is not stretched over them.
    const averageCost = entry.basisBase > 0 ? (entry.costBasis / entry.basisBase) * rate : null;
    const covered = entry.basisBase >= entry.balance * 0.999_999;
    const unrealisedPnl = averageCost !== null && covered ? value - entry.balance * averageCost : null;
    const mine = trades.filter((trade) => trade.token === entry.token);

    positions.push({
      token: row.token,
      name: row.name,
      symbol: row.symbol,
      mediaUrl: row.mediaUrl,
      mediaMime: row.mediaMime,
      curvePreset: row.curvePreset,
      balance: entry.balance,
      price,
      value,
      averageCost: covered ? averageCost : null,
      unrealisedPnl,
      unrealisedPnlPct:
        unrealisedPnl === null || averageCost === null || averageCost <= 0 || entry.balance <= 0
          ? null
          : (price - averageCost) / averageCost,
      realisedPnl: entry.realizedPnl * rate,
      currency: quoteUsd === null ? snapshot.quote.symbol : "USD",
      graduated: snapshot.curve.graduated,
      trades: [...mine]
        .sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex)
        .map((swap) => ({
          t: swap.timestamp,
          side: swap.side,
          base: swap.baseAmount,
          price: swap.price * rate,
          quote: swap.quoteAmount * rate,
        })),
    });
  }
  return positions.sort((a, b) => b.value - a.value);
}

/**
 * True when this wallet can be shown to hold nothing and never to have traded
 * — so "nothing held" is a measurement, not a shrug.
 *
 * Two facts, both cheap: it holds none of any Juno coin (the multicall above
 * already answered that), and it has never sent a transaction — a nonce of
 * zero. A sell is a transaction the seller sends, so a wallet that has never
 * sent one has no realised P&L to report either.
 *
 * Any doubt — a refused read, a single sent transaction — returns false and
 * the full walk runs.
 */
async function provablyUntouched(wallet: Address, held: Map<string, number>): Promise<boolean> {
  for (const balance of held.values()) if (balance > 0) return false;
  const nonce = await tryRead(() => publicClient().getTransactionCount({ address: wallet }));
  return nonce === 0;
}

/**
 * The headline figures, and which of them this read actually earned.
 *
 * Pure, and separated from the walk above, because the rule it encodes is the
 * one that keeps getting this wrong and it needs a test that does not need a
 * network. Three distinct "no":
 *
 * - **A complete walk that found nothing.** The wallet holds nothing. `$0` and
 *   a zero P&L are real measurements and are reported as such.
 * - **A partial walk that found nothing.** Some pool refused, so nobody knows
 *   what this wallet holds. Summing an empty list gives zero, and zero reads
 *   as "flat" — a measurement nobody took. Both totals are null.
 * - **A holding with no recorded cost.** Its acquisition is outside visible
 *   history, so P&L is unknowable even though the value is not. Value stands;
 *   P&L is null.
 *
 * A partial walk that *did* find positions reports their totals as a floor,
 * and `partial` tells the caller so.
 */
export function totalsFor(
  positions: Position[],
  partial: boolean,
): {
  sum: number;
  portfolio: Pick<Portfolio, "totalValue" | "totalPnl" | "totalPnlPct" | "currency">;
} {
  const sum = positions.reduce((total, p) => total + p.value, 0);
  // A total is only meaningful when every part of it is in the same unit.
  const currencies = new Set(positions.map((p) => p.currency));
  const currency = currencies.size === 1 ? [...currencies][0] : "mixed";

  const nothingMeasured = partial && positions.length === 0;
  const anyUnknownCost = positions.some((p) => p.balance > 0 && p.unrealisedPnl === null);

  const totalPnl =
    anyUnknownCost || nothingMeasured
      ? null
      : positions.reduce((total, p) => total + (p.unrealisedPnl ?? 0) + p.realisedPnl, 0);

  const totalCost = positions.reduce(
    (total, p) => total + (p.averageCost === null ? 0 : p.averageCost * p.balance),
    0,
  );

  return {
    sum,
    portfolio: {
      totalValue: nothingMeasured ? null : sum,
      totalPnl,
      totalPnlPct: totalPnl === null || totalCost <= 0 ? null : totalPnl / totalCost,
      currency,
    },
  };
}


/**
 * Rebuild what the wallet was worth at each moment it traded.
 *
 * Walks every position's trades in one merged, time-ordered pass, carrying a
 * running balance and last-seen price per position. At each event the total is
 * the sum of `balance × lastPrice` across everything held — which is the only
 * honest reconstruction available, because no price was observed between
 * trades and inventing one would draw a line through numbers nobody paid.
 *
 * The final point is the live total, so the chart ends where the headline says
 * it does.
 */
export function valueOverTime(
  positions: Position[],
  liveTotal: number,
): Array<{ t: string; value: number }> {
  type Event = { at: number; token: string; side: "buy" | "sell"; base: number; price: number };

  const events: Event[] = [];
  for (const position of positions) {
    for (const trade of position.trades) {
      const at = Date.parse(trade.t);
      if (Number.isFinite(at)) {
        events.push({ at, token: position.token, side: trade.side, base: trade.base, price: trade.price });
      }
    }
  }
  if (events.length === 0) return [];

  events.sort((a, b) => a.at - b.at);

  const balance = new Map<string, number>();
  const price = new Map<string, number>();
  const series: Array<{ t: string; value: number }> = [];

  for (const event of events) {
    const held = balance.get(event.token) ?? 0;
    balance.set(event.token, event.side === "buy" ? held + event.base : Math.max(0, held - event.base));
    price.set(event.token, event.price);

    let total = 0;
    for (const [token, amount] of balance) total += amount * (price.get(token) ?? 0);
    series.push({ t: new Date(event.at).toISOString(), value: total });
  }

  // End on the live figure rather than on the last trade's mark.
  series.push({ t: new Date().toISOString(), value: liveTotal });
  return series;
}
