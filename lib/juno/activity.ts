import "server-only";

import { getAddress, zeroAddress, type Address } from "viem";

import { junoTokenAbi } from "./abi";
import { envioConfigured, envioHolders } from "./envio";
import { publicClient } from "./client";
import { identicon } from "./identicon";
import { shortAddress } from "./format";
import { fetchPoolSnapshot } from "./launchpad";
import { launchpadAddress } from "./network";
import { tryRead } from "./rpc";
import { listSwapHistory, type PoolSwap } from "./swaps";
import type { Activity, Holder } from "./types";

/**
 * Trade history and holders.
 *
 * Every row here is a `Trade` event the launchpad emitted — see
 * `lib/juno/swaps.ts` — so it reports the side and size the contract stated
 * rather than something inferred.
 */

function actorFor(wallet: string): Activity["actor"] {
  return {
    handle: shortAddress(wallet, 4, 4),
    avatarUrl: identicon(wallet),
  };
}

export function activityFromSwap(swap: PoolSwap, quoteUsdRate: number): Activity {
  return {
    id: swap.id,
    side: swap.side,
    actor: actorFor(swap.trader),
    wallet: swap.trader,
    amount: swap.baseAmount,
    valueUsd: swap.quoteAmount * quoteUsdRate,
    timestamp: swap.timestamp,
    txHash: swap.txHash,
  };
}

/**
 * Recent trades against the pool, newest first.
 *
 * `quoteUsdRate` converts the quote leg into the unit the row is labelled in.
 * Pass 1 for a pool quoted in a stablecoin, or when no USD price is available —
 * the caller is the one that knows whether it can honestly say "dollars", and
 * `Coin.marketCapCurrency` is how that is carried to the UI.
 */
export async function listPoolActivity(token: string, quoteUsdRate = 1, limit = 20): Promise<Activity[]> {
  const history = await listSwapHistory(token);
  return history.swaps.slice(0, limit).map((swap) => activityFromSwap(swap, quoteUsdRate));
}

/**
 * Who holds this coin, and how that was worked out.
 *
 * `source` is part of the answer rather than an implementation detail, because
 * the two routes measure different things and the UI has to say which one it
 * is showing.
 */
export type HolderBook = {
  holders: Holder[];
  /**
   * `balances` — the live `balanceOf` of every wallet that has traded this
   * coin, read in one multicall. Exact for those wallets; a wallet that only
   * ever received tokens by transfer is not in the candidate set.
   *
   * `fills` — net position per wallet, rebuilt from its trades. Used when the
   * balance read is refused; it cannot see transfers at all.
   *
   * `indexer` — the Envio indexer's positions, built from every `Transfer` the
   * token has emitted. Complete: a wallet that only ever received tokens by
   * transfer is in it, which neither of the other two can say.
   */
  source: "indexer" | "balances" | "fills";
};

/**
 * Holders among the wallets that traded this coin.
 *
 * On an EVM chain a balance belongs to the wallet itself, so once the fills
 * name the candidates, one multicall of `balanceOf` gives each one's real
 * holding — including anything they sold or passed on since. The launchpad
 * and the AMM pair are contracts, not holders, and are excluded.
 *
 * Null only when neither route produced anything. Callers that publish a count
 * still need that distinction, because "nobody holds this" and "nobody could
 * read it" are different claims.
 */
export async function listPoolHolders(token: string, swaps?: PoolSwap[] | null): Promise<HolderBook | null> {
  // The venue the pool graduates into holds the liquidity, not a person: the
  // Uniswap pair, or for Kuru the MarginAccount that custodies its vault.
  const venue = (await fetchPoolSnapshot(token).catch(() => null))?.pool.venue ?? zeroAddress;
  if (envioConfigured()) {
    const indexed = await envioHolders(token).catch(() => null);
    // An empty answer while the fills say someone bought means the indexer has
    // not caught up yet — fall through rather than report nobody.
    if (indexed && (indexed.length > 0 || !swaps || swaps.length === 0)) {
      const exclude = new Set<string>([zeroAddress, launchpadAddress() ?? zeroAddress, getAddress(venue)]);
      const held = indexed.filter((entry) => !exclude.has(entry.wallet));
      const total = held.reduce((sum, entry) => sum + entry.balance, 0);
      return {
        source: "indexer",
        holders: held.map((entry, index) => ({
          rank: index + 1,
          actor: actorFor(entry.wallet),
          wallet: entry.wallet,
          balance: entry.balance,
          share: total > 0 ? entry.balance / total : 0,
        })),
      };
    }
  }
  if (!swaps || swaps.length === 0) return null;
  const address = getAddress(token);
  const exclude = new Set<string>([zeroAddress, launchpadAddress() ?? zeroAddress, getAddress(venue)]);
  const candidates = [...new Set(swaps.map((swap) => swap.trader))].filter((wallet) => !exclude.has(wallet));

  const balances = await tryRead(() =>
    publicClient().multicall({
      contracts: candidates.map((wallet) => ({
        address: address,
        abi: junoTokenAbi,
        functionName: "balanceOf" as const,
        args: [wallet as Address] as const,
      })),
      allowFailure: false,
    }),
  );

  if (balances) {
    const held = candidates
      .map((wallet, index) => ({ wallet, balance: Number(balances[index] as bigint) / 1e18 }))
      .filter((entry) => entry.balance > 0)
      .sort((a, b) => b.balance - a.balance);
    const total = held.reduce((sum, entry) => sum + entry.balance, 0);
    return {
      source: "balances",
      holders: held.map((entry, index) => ({
        rank: index + 1,
        actor: actorFor(entry.wallet),
        wallet: entry.wallet,
        balance: entry.balance,
        share: total > 0 ? entry.balance / total : 0,
      })),
    };
  }

  const derived = holdersFromSwaps(swaps);
  if (derived.length > 0) return { source: "fills", holders: derived };

  // Null, not []. An empty list would render "No holders yet" for a pool that
  // plainly has them.
  return null;
}

/**
 * Net position per wallet, from this pool's own trades.
 *
 * Buys add, sells subtract, and anything that nets to zero or below is gone —
 * a wallet that sold everything is not a holder. Ranked by size.
 */
export function holdersFromSwaps(swaps: PoolSwap[]): Holder[] {
  const net = new Map<string, number>();
  for (const swap of swaps) {
    const delta = swap.side === "buy" ? swap.baseAmount : -swap.baseAmount;
    net.set(swap.trader, (net.get(swap.trader) ?? 0) + delta);
  }

  const held = [...net.entries()].filter(([, balance]) => balance > 0).sort((a, b) => b[1] - a[1]);

  // Share is of what this list accounts for, not of circulating supply, which
  // these fills cannot see.
  const total = held.reduce((sum, [, balance]) => sum + balance, 0);

  return held.map(([wallet, balance], index) => ({
    rank: index + 1,
    actor: actorFor(wallet),
    wallet,
    balance,
    share: total > 0 ? balance / total : 0,
  }));
}
