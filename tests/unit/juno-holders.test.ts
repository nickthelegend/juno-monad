import { describe, it, expect } from "vitest";
import { holdersFromSwaps } from "@/lib/juno/activity";
import type { PoolSwap } from "@/lib/juno/swaps";

/**
 * Holders, rebuilt from fills.
 *
 * On Monad the Holders tab reads each trader's live `balanceOf` in one
 * multicall. When the public RPC refuses that read, the tab falls back to the
 * trades themselves: every buy and sell is a `Trade` event naming the wallet
 * that made it, which is enough to rebuild a net position per wallet.
 *
 * What the fallback cannot see is a transfer, so its figures are "position
 * taken on this pool", not "tokens owned" — the API labels it `fills` — and
 * these tests pin the arithmetic that claim rests on.
 */

let logIndex = 0;

function swap(trader: string, side: "buy" | "sell", baseAmount: number): PoolSwap {
  const index = logIndex++;
  return {
    id: `0x${"ab".repeat(32)}:${index}`,
    txHash: `0x${"ab".repeat(32)}`,
    logIndex: index,
    token: "0x2222222222222222222222222222222222222222",
    side,
    baseAmount,
    quoteAmount: baseAmount * 0.001,
    fee: 0,
    price: 0.001,
    trader,
    timestamp: "2026-09-21T10:00:00.000Z",
    blockNumber: 1,
  };
}

describe("holdersFromSwaps", () => {
  it("nets buys against sells per wallet", () => {
    const rows = holdersFromSwaps([
      swap("alice", "buy", 1000),
      swap("alice", "sell", 400),
      swap("bob", "buy", 250),
    ]);

    expect(rows.map((r) => [r.wallet, r.balance])).toEqual([
      ["alice", 600],
      ["bob", 250],
    ]);
  });

  it("drops a wallet that sold everything — it is not a holder", () => {
    const rows = holdersFromSwaps([
      swap("alice", "buy", 500),
      swap("alice", "sell", 500),
      swap("bob", "buy", 10),
    ]);

    expect(rows.map((r) => r.wallet)).toEqual(["bob"]);
  });

  it("drops a wallet that sold more than the window saw it buy", () => {
    // Its buys predate the walked history. A negative balance is not a holding
    // and must not be rendered as one.
    const rows = holdersFromSwaps([swap("ghost", "sell", 900), swap("bob", "buy", 5)]);
    expect(rows.map((r) => r.wallet)).toEqual(["bob"]);
  });

  it("ranks by size, largest first", () => {
    const rows = holdersFromSwaps([
      swap("small", "buy", 1),
      swap("large", "buy", 999),
      swap("middle", "buy", 50),
    ]);

    expect(rows.map((r) => r.wallet)).toEqual(["large", "middle", "small"]);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it("shares are of what the list accounts for, and sum to one", () => {
    const rows = holdersFromSwaps([swap("a", "buy", 300), swap("b", "buy", 100)]);

    expect(rows[0].share).toBeCloseTo(0.75, 10);
    expect(rows[1].share).toBeCloseTo(0.25, 10);
    expect(rows.reduce((sum, r) => sum + r.share, 0)).toBeCloseTo(1, 10);
  });

  it("returns nothing rather than dividing by zero when every position closed", () => {
    // `share` divides by the list total; an all-sold pool makes that zero.
    const rows = holdersFromSwaps([swap("alice", "buy", 100), swap("alice", "sell", 100)]);
    expect(rows).toEqual([]);
  });

  it("has nothing to say about an unread pool", () => {
    expect(holdersFromSwaps([])).toEqual([]);
  });

  it("sums one wallet's fills into one holder at 100%", () => {
    // Four fills, each its own transaction, stepping up the curve. The page
    // renders one holder at 16,583 tokens and 100% — and it has to keep
    // matching the activity list's own total.
    const wallet = "0x3bd3b2c1a4b9a0d0e2f1f7c8d0c5e6f7a8b9433A";
    const rows = holdersFromSwaps([
      swap(wallet, "buy", 4145.685133),
      swap(wallet, "buy", 4145.703666),
      swap(wallet, "buy", 4145.722199),
      swap(wallet, "buy", 4145.740733),
    ]);

    expect(rows).toHaveLength(1);
    expect(Math.round(rows[0].balance)).toBe(16583);
    expect(rows[0].share).toBe(1);
    // The actor is derived from the wallet: a short handle and an avatar.
    expect(rows[0].wallet).toBe(wallet);
    expect(rows[0].actor.handle).toBe("0x3b…433A");
  });
});
